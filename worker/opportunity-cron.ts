// worker/opportunity-cron.ts — opportunity notification scanner (plan Task
// 15, spec §10.3). Runs on the */15 cron with an EXPLICIT db + clock + sender
// (tests inject stubs; production wraps web-push). Guarantees:
//   - one job per (user, delivery_key): UNIQUE + ON CONFLICT DO NOTHING
//     dedupes across scans and concurrent workers
//   - lease claim via conditional UPDATE ... RETURNING, ≤50 jobs per pass,
//     120s leases; expired leases are reclaimable
//   - send-time re-verification: the event is rebuilt from CURRENT data, so
//     changed deadlines, unlinked cards, dismissed/snoozed events or dead
//     accounts cancel the job instead of pushing stale advice
//   - quiet hours postpone the scheduled slot at creation time (DST-aware)
//   - zero accepted sends never record 'sent'; partial sends record 'partial'
//     and the next pass retries ONLY the failed subscriptions
//   - 404/410 subscriptions are deleted, deliveries recorded 'gone'
//
// No real push endpoints are contacted in tests.

import webpush from 'web-push'
import { addDays, localDateInZone } from '../lib/opportunities/dates'
import { parseRules } from '../lib/opportunities/catalog.server'
import {
  buildCycleCalendarEvents,
  mergeOpportunityReminderConfig,
  reminderDeliveryKey,
  reminderTag,
  resolveDeliveryInstant,
  type OpportunityCalendarEvent,
  type OpportunityReminderConfig,
} from '../lib/opportunities/reminders'

export interface OpportunityCronEnv {
  DB: D1Database
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface SendOutcome {
  ok: boolean
  /** Push service reported the subscription gone (404/410). */
  gone?: boolean
  error?: string
}

export type PushSender = (sub: PushSubscriptionRow, payload: string) => Promise<SendOutcome>

export interface ScanDeps {
  db: D1Database
  now: Date
  sender: PushSender
  /** Jobs claimed per pass (spec: 50). */
  batchSize?: number
  /** Lease seconds (spec: 120). */
  leaseSeconds?: number
}

export interface ScanReport {
  jobs_created: number
  jobs_claimed: number
  sent: number
  partial: number
  failed: number
  cancelled: number
  skipped_no_subscription: number
  subscriptions_deleted: number
}

const DEFAULT_BATCH = 50
const DEFAULT_LEASE_SECONDS = 120
const MAX_ATTEMPTS = 4

/**
 * RFC3339 UTC WITHOUT milliseconds. Job rows and the scanner clock must share
 * one format: '...:00Z' vs '...:00.000Z' mis-order in string comparisons
 * ('Z' > '.'), which silently hides due jobs from the lease query.
 */
function toRfc3339Utc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface AccountWorld {
  account_id: string
  holder_id: string
  definition_id: string
  version_id: string
  rules_json: string
  verification: string
}

interface CycleRow {
  id: string
  account_id: string
  allocation_kind: string
  usable_start_on: string
  usable_end_before: string | null
}

interface UserWorld {
  user_id: string
  /** Holders this user may be notified about (server-side rule, §10.3). */
  holderIds: Set<string>
  config: OpportunityReminderConfig
  quiet: { quiet_hours_start?: string; quiet_hours_end?: string } | undefined
  webPushGloballyEnabled: boolean
}

interface EventWorld {
  events: OpportunityCalendarEvent[]
  holderId: string
}

/** Every active account's events, keyed by account id (batched queries only). */
async function loadAllEvents(deps: ScanDeps): Promise<Map<string, EventWorld>> {
  const { results: accounts } = await deps.db
    .prepare(
      `SELECT a.id AS account_id, a.holder_id, a.definition_id, v.id AS version_id,
              v.rules_json, v.verification
       FROM opportunity_accounts a
       JOIN opportunity_definitions d ON d.id = a.definition_id AND d.status = 'active'
       LEFT JOIN opportunity_rule_versions v
         ON v.definition_id = d.id
        AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2
                          WHERE v2.definition_id = d.id)`,
    )
    .all<AccountWorld>()

  const { results: cycles } = await deps.db
    .prepare(
      `SELECT id, account_id, allocation_kind, usable_start_on, usable_end_before
       FROM opportunity_cycles`,
    )
    .all<CycleRow>()

  const byAccount = new Map<string, EventWorld>()
  for (const account of accounts) {
    if (!account.rules_json) continue
    let rules
    try {
      rules = parseRules(account.rules_json)
    } catch {
      continue
    }
    const events: OpportunityCalendarEvent[] = []
    for (const cycle of cycles) {
      if (cycle.account_id !== account.account_id) continue
      events.push(
        ...(await buildCycleCalendarEvents({
          account_id: account.account_id,
          cycle_id: cycle.id,
          title: rules.title,
          time_zone: rules.time_zone,
          usable_start_on: cycle.usable_start_on,
          usable_end_before: cycle.usable_end_before,
          next_reset_on:
            cycle.allocation_kind === 'regular' &&
            rules.cycle.kind !== 'one_time' &&
            cycle.usable_end_before !== null
              ? cycle.usable_end_before
              : null,
          claim_window: rules.claim_window,
          version_id: account.version_id,
          verification: (account.verification ?? 'unverified') as
            | 'unverified' | 'user_confirmed' | 'official_verified',
        })),
      )
    }
    byAccount.set(account.account_id, { events, holderId: account.holder_id })
  }
  return byAccount
}

/** Users + holder universe + merged opportunity preferences (batched). */
async function loadUsers(db: D1Database): Promise<UserWorld[]> {
  const { results: holderRows } = await db
    .prepare('SELECT id, created_by, managed_by, auth_user_id FROM card_holders')
    .all<{ id: string; created_by: string; managed_by: string | null; auth_user_id: string | null }>()
  const { results: prefRows } = await db
    .prepare('SELECT user_id, reminder_config FROM user_preferences')
    .all<{ user_id: string; reminder_config: string }>()
  const prefByUser = new Map(prefRows.map((p) => [p.user_id, p.reminder_config]))

  const holdersByUser = new Map<string, Set<string>>()
  for (const holder of holderRows) {
    const owners = new Set<string>([holder.created_by])
    if (holder.managed_by) owners.add(holder.managed_by)
    if (holder.auth_user_id) owners.add(holder.auth_user_id)
    for (const userId of owners) {
      const set = holdersByUser.get(userId) ?? new Set<string>()
      set.add(holder.id)
      holdersByUser.set(userId, set)
    }
  }

  const { results: userRows } = await db.prepare('SELECT id FROM users').all<{ id: string }>()
  return userRows.map((u) => {
    let config: OpportunityReminderConfig
    let legacy: Record<string, unknown> = {}
    const raw = prefByUser.get(u.id)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          opportunities?: unknown
          quiet_hours_start?: string
          quiet_hours_end?: string
          enabled_channels?: string[]
        }
        config = mergeOpportunityReminderConfig(parsed.opportunities ?? null)
        legacy = parsed
      } catch {
        config = mergeOpportunityReminderConfig(null)
      }
    } else {
      config = mergeOpportunityReminderConfig(null)
    }
    const channels = (legacy.enabled_channels as string[] | undefined) ?? ['web_push']
    return {
      user_id: u.id,
      holderIds: holdersByUser.get(u.id) ?? new Set<string>(),
      config,
      quiet: {
        quiet_hours_start: legacy.quiet_hours_start as string | undefined,
        quiet_hours_end: legacy.quiet_hours_end as string | undefined,
      },
      webPushGloballyEnabled: channels.includes('web_push'),
    }
  })
}

interface DueDelivery {
  user_id: string
  holder_id: string
  event: OpportunityCalendarEvent
  delivery_key: string
  scheduled_at: string
}

/** Every due (user, event, step) delivery for this scan instant. */
async function buildDueDeliveries(deps: ScanDeps): Promise<DueDelivery[]> {
  const worlds = await loadAllEvents(deps)
  const users = await loadUsers(deps.db)
  const due: DueDelivery[] = []

  for (const user of users) {
    if (!user.config.enabled) continue
    for (const world of worlds.values()) {
      if (!user.holderIds.has(world.holderId)) continue
      for (const event of world.events) {
        if (event.needs_review) continue // 未核实数据不催用
        // “今天”以该事件的规则时区评估（§10.3：不依赖主机 locale）
        const todayOn = localDateInZone(deps.now, event.time_zone)

        const steps: string[] = []
        if (event.local_date_on === todayOn) {
          steps.push(
            event.kind === 'cycle_reset' ? 'reset'
              : event.kind === 'claim_window_open' ? 'open'
                : 'd0',
          )
        }
        // Threshold day-nodes apply ONLY to deadline-driven events; reset and
        // window-open are on-the-day nodes and never fan out dN variants.
        if (
          event.deadline_before !== null &&
          (event.kind === 'cycle_expiry' || event.kind === 'claim_window_deadline')
        ) {
          // Thresholds count back from the LAST USABLE day: a cycle's deadline
          // (usable_end_before) is exclusive, so d1 on the final evening would
          // otherwise double-fire with d0.
          const base =
            event.kind === 'cycle_expiry' ? addDays(event.deadline_before, -1) : event.deadline_before
          const daysLeft = Math.round(
            (Date.parse(`${base}T00:00:00Z`) - Date.parse(`${todayOn}T00:00:00Z`)) / 86_400_000,
          )
          const daySets =
            event.kind === 'claim_window_deadline'
              ? user.config.claim_days_before
              : user.config.expiry_days_before
          for (const n of daySets) {
            if (daysLeft === n && n !== 0) steps.push(`d${n}`)
          }
        }

        for (const step of steps) {
          const scheduled = resolveDeliveryInstant(
            event.local_date_on,
            user.config.local_time,
            user.config.time_zone,
            user.quiet,
          )
          due.push({
            user_id: user.user_id,
            holder_id: world.holderId,
            event,
            delivery_key: reminderDeliveryKey(event.event_key, step),
            scheduled_at: scheduled.utc,
          })
        }
      }
    }
  }
  return due
}

interface JobRow {
  id: string
  user_id: string
  event_key: string
  delivery_key: string
  object_kind: string
  object_id: string
  business_version: string
  scheduled_at: string
  expires_at: string | null
  attempt_count: number
}

/**
 * One scan pass: create due jobs (idempotent), cancel expired ones, claim a
 * batch under lease, re-verify against current state, send, and record
 * per-subscription deliveries. Every step uses the injected clock.
 */
export async function scanOpportunityNotifications(deps: ScanDeps): Promise<ScanReport> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const db = deps.db
  const nowIso = toRfc3339Utc(deps.now)
  const report: ScanReport = {
    jobs_created: 0, jobs_claimed: 0, sent: 0, partial: 0, failed: 0,
    cancelled: 0, skipped_no_subscription: 0, subscriptions_deleted: 0,
  }

  // 1. Create due jobs — UNIQUE(user_id, delivery_key) dedupes scans/workers.
  const due = await buildDueDeliveries(deps)
  for (const delivery of due) {
    const expiresAt = delivery.event.deadline_before
      ? `${delivery.event.deadline_before}T23:59:59Z`
      : null
    const { results } = await db
      .prepare(
        `INSERT INTO opportunity_notification_jobs
           (id, user_id, holder_id, event_key, delivery_key, object_kind, object_id,
            business_version, scheduled_at, expires_at, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)
         ON CONFLICT(user_id, delivery_key) DO NOTHING
         RETURNING id`,
      )
      .bind(
        `onj_${crypto.randomUUID()}`, delivery.user_id, delivery.holder_id, delivery.event.event_key,
        delivery.delivery_key, 'account', delivery.event.account_id,
        `${delivery.event.deadline_before ?? 'none'}|${delivery.event.event_key}`,
        delivery.scheduled_at, expiresAt, nowIso, nowIso,
      )
      .all<{ id: string }>()
    report.jobs_created += results.length
  }

  // 2. Cancel jobs past their expiry (expired pressure never resurrects).
  const { results: cancelledExpired } = await db
    .prepare(
      `UPDATE opportunity_notification_jobs
       SET status = 'cancelled', updated_at = ?
       WHERE status IN ('pending', 'leased') AND expires_at IS NOT NULL AND expires_at < ?
       RETURNING id`,
    )
    .bind(nowIso, nowIso)
    .all<{ id: string }>()
  report.cancelled += cancelledExpired.length

  // 3. Claim a batch: the conditional UPDATE ... RETURNING is the lease.
  const claimCutoff = toRfc3339Utc(new Date(deps.now.getTime() - leaseSeconds * 1000))
  const { results: claimed } = await db
    .prepare(
      `UPDATE opportunity_notification_jobs
       SET status = 'leased', lease_until = ?, attempt_count = attempt_count + 1, updated_at = ?
       WHERE id IN (
         SELECT id FROM opportunity_notification_jobs
         WHERE (status IN ('pending', 'partial') AND scheduled_at <= ?)
            OR (status = 'leased' AND lease_until IS NOT NULL AND lease_until < ?)
         ORDER BY scheduled_at ASC
         LIMIT ?
       )
       RETURNING id, user_id, event_key, delivery_key, object_kind, object_id,
                 business_version, scheduled_at, expires_at, attempt_count`,
    )
    .bind(nowIso, nowIso, nowIso, claimCutoff, batchSize)
    .all<JobRow>()
  report.jobs_claimed = claimed.length

  const worlds = await loadAllEvents(deps)

  for (const job of claimed) {
    // 4. Re-verify against CURRENT state before any send.
    if (!(await reverify(deps, job, worlds, nowIso))) {
      await db
        .prepare(`UPDATE opportunity_notification_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`)
        .bind(nowIso, job.id)
        .run()
      report.cancelled += 1
      continue
    }

    // 5. Subscriptions — none means in-app only (jobs are push side effects).
    const { results: subs } = await db
      .prepare('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(job.user_id)
      .all<PushSubscriptionRow>()
    if (subs.length === 0) {
      await db
        .prepare(
          `UPDATE opportunity_notification_jobs SET status = 'skipped', last_error = 'no_subscription', updated_at = ? WHERE id = ?`,
        )
        .bind(nowIso, job.id)
        .run()
      report.skipped_no_subscription += 1
      continue
    }

    // 6. Send. Already-accepted devices are never re-sent (§10.3: 成功设备
    // 不重试) — the retry window covers ONLY the failed subscriptions.
    const { results: priorDeliveries } = await db
      .prepare('SELECT subscription_id, status FROM opportunity_notification_deliveries WHERE job_id = ?')
      .bind(job.id)
      .all<{ subscription_id: string; status: string }>()
    const acceptedSubs = new Set(
      priorDeliveries.filter((d) => d.status === 'accepted').map((d) => d.subscription_id),
    )
    const pendingSubs = subs.filter((sub) => !acceptedSubs.has(sub.id))

    const body = await buildBody(deps, job)
    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      url: body.url,
      tag: reminderTag(job.delivery_key),
    })
    let accepted = 0
    let failures = 0
    for (const sub of pendingSubs) {
      let outcome: SendOutcome
      try {
        outcome = await deps.sender(sub, payload)
      } catch (err) {
        outcome = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (outcome.ok) {
        accepted += 1
      } else if (outcome.gone) {
        report.subscriptions_deleted += 1
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
      } else {
        failures += 1
      }
      await db
        .prepare(
          `INSERT INTO opportunity_notification_deliveries (id, job_id, subscription_id, status, accepted_at, last_error, attempt_count)
           VALUES (?,?,?,?,?,?,1)
           ON CONFLICT(job_id, subscription_id) DO UPDATE SET
             status = excluded.status,
             accepted_at = COALESCE(excluded.accepted_at, opportunity_notification_deliveries.accepted_at),
             last_error = excluded.last_error,
             attempt_count = opportunity_notification_deliveries.attempt_count + 1`,
        )
        .bind(
          `ond_${crypto.randomUUID()}`, job.id, sub.id,
          outcome.ok ? 'accepted' : outcome.gone ? 'gone' : 'failed',
          outcome.ok ? nowIso : null,
          outcome.ok ? null : (outcome.error ?? 'send failed'),
        )
        .run()
    }

    // 7. Terminal status: zero accepted NEVER records sent (§10.3). Accepted
    // devices are never retried (their delivery rows are 'accepted').
    let status: 'sent' | 'partial' | 'failed' | 'pending'
    if (accepted > 0 && failures === 0) status = 'sent'
    else if (accepted > 0) status = 'partial'
    else if (job.attempt_count >= MAX_ATTEMPTS) status = 'failed'
    else status = 'pending' // retry the failed devices on a later pass
    await db
      .prepare(
        `UPDATE opportunity_notification_jobs
         SET status = ?, lease_until = NULL, updated_at = ?, last_error = ?
         WHERE id = ?`,
      )
      .bind(status, nowIso, failures > 0 ? `${failures} 台设备发送失败` : null, job.id)
      .run()
    if (status === 'sent') report.sent += 1
    else if (status === 'partial') report.partial += 1
    else if (status === 'failed') report.failed += 1
  }

  return report
}

async function buildBody(deps: ScanDeps, job: JobRow): Promise<{ title: string; body: string; url: string }> {
  const row = await deps.db
    .prepare(
      `SELECT v.rules_json FROM opportunity_accounts a
       JOIN opportunity_rule_versions v ON v.definition_id = a.definition_id
        AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2 WHERE v2.definition_id = a.definition_id)
       WHERE a.id = ?`,
    )
    .bind(job.object_id)
    .first<{ rules_json: string }>()
  const fallback = { title: '权益提醒', body: '请查看今天的权益待办', url: '/benefits' }
  if (!row) return fallback
  try {
    const rules = parseRules(row.rules_json)
    const url = job.delivery_key.includes('claim') ? '/promos' : '/benefits'
    return { title: `权益提醒：${rules.title}`, body: '请查看今天的权益待办', url }
  } catch {
    return fallback
  }
}

/**
 * Send-time re-verification: the event must still exist for this account with
 * the same key (deadline + version changes produce a NEW key, so a missing key
 * means the old advice is stale), the account must stay active with an active
 * linked card, and the user must not have dismissed or snoozed the event.
 */
async function reverify(
  deps: ScanDeps,
  job: JobRow,
  worlds: Map<string, EventWorld>,
  nowIso: string,
): Promise<boolean> {
  const world = worlds.get(job.object_id)
  if (!world || !world.events.some((e) => e.event_key === job.event_key)) return false

  const alive = await deps.db
    .prepare(
      `SELECT 1 AS ok
       FROM opportunity_accounts a
       WHERE a.id = ? AND a.status = 'active'
         AND EXISTS (SELECT 1 FROM opportunity_account_cards ac
                     JOIN credit_cards cc ON cc.id = ac.card_id
                     WHERE ac.account_id = a.id AND ac.retired_at IS NULL AND cc.status = 'active')`,
    )
    .bind(job.object_id)
    .first<{ ok: number }>()
  if (!alive) return false

  const state = await deps.db
    .prepare(
      'SELECT dismissed_at, snooze_until FROM opportunity_reminder_states WHERE user_id = ? AND event_key = ?',
    )
    .bind(job.user_id, job.event_key)
    .first<{ dismissed_at: string | null; snooze_until: string | null }>()
  if (state && state.dismissed_at !== null) return false
  if (state && state.snooze_until !== null && state.snooze_until > nowIso) return false
  return true
}

// ---------------------------------------------------------------------------
// Cron dispatch (worker/index.ts routes by expression) + production sender
// ---------------------------------------------------------------------------

/** Pure cron routing: the two crons own disjoint duties (spec §10.3). */
export function routeOpportunityCron(cron: string): 'opportunities' | 'bills' | null {
  if (cron === '*/15 * * * *') return 'opportunities'
  if (cron === '0 9 * * *') return 'bills'
  return null
}

/** Production sender wrapping web-push; tests never use this. */
export function webPushSender(env: OpportunityCronEnv): PushSender {
  return async (sub, payload) => {
    const publicKey = env.VAPID_PUBLIC_KEY
    const privateKey = env.VAPID_PRIVATE_KEY
    if (!publicKey || !privateKey) {
      return { ok: false, error: 'VAPID keys not configured (npx wrangler secret put VAPID_PRIVATE_KEY)' }
    }
    webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@worldcredit.app', publicKey, privateKey)
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 },
      )
      return { ok: true }
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      const message = err instanceof Error ? err.message : String(err)
      if (status === 404 || status === 410) return { ok: false, gone: true, error: message }
      return { ok: false, error: message }
    }
  }
}
