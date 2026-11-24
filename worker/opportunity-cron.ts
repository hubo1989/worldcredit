import webpush from 'web-push'
import { addDays, isValidIanaTimeZone, localDateInZone } from '../lib/opportunities/dates'
import { sendApnsToUser, type SendPushOptions } from '../lib/apns.server'
import { currencySymbol } from '../lib/fx'
import { parseRules } from '../lib/opportunities/catalog.server'
import {
  buildBookingCalendarEvents,
  buildCycleCalendarEvents,
  buildTaskCalendarEvents,
  localWallTimeToInstant,
  mergeOpportunityReminderConfig,
  reminderDeliveryKey,
  reminderTag,
  resolveDeliveryInstant,
  type OpportunityCalendarEvent,
  type OpportunityReminderConfig,
} from '../lib/opportunities/reminders'
import {
  isInQuietHours,
  isOpportunitySwitchEnabled,
  isWebPushChannelEnabled,
  type OpportunitySwitchKey,
} from '../lib/notifications.shared'
import { evaluateTask, parseTaskConditions, type ManualProgress } from '../lib/opportunities/tasks'
import type { RuleSnapshotV1 } from '../lib/opportunities/types'
import type { UserReminderConfig } from '../lib/types'

export interface OpportunityCronEnv {
  DB: D1Database
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  APNS_KEY_P8?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_BUNDLE_ID?: string
  APNS_ENVIRONMENT?: string
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

export type PushSender = (
  sub: PushSubscriptionRow, payload: string, ttlSeconds: number,
) => Promise<SendOutcome>

export interface DeviceTokenRow {
  id: string
  user_id: string
  token: string
}

export type ApnsBatchSender = (
  userId: string,
  devices: DeviceTokenRow[],
  options: SendPushOptions,
) => Promise<Map<string, SendOutcome>>

export interface ScanDeps {
  db: D1Database
  now: Date
  sender: PushSender
  apnsSender?: ApnsBatchSender
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
  skipped_web_push_disabled: number
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

type ObjectKind = 'account' | 'task' | 'fulfillment'

interface AccountRow {
  id: string
  holder_id: string
  holder_name: string
  definition_kind: string
  version_id: string
  rules_json: string
  verification: 'unverified' | 'user_confirmed' | 'official_verified'
  eligible: number
}

interface CycleRow {
  id: string
  account_id: string
  allocation_kind: string
  activation_state: 'active' | 'pending_claim' | 'voided'
  usable_start_on: string
  usable_end_before: string | null
  currency: string | null
  remaining_count: number | null
  remaining_minor: number | null
}

interface TaskRow {
  id: string
  holder_id: string
  holder_name: string
  title: string
  deadline_at: string
  expected_from_on: string | null
  expected_until_before: string | null
  rules_snapshot_json: string
  progress_json: string
  reward_recorded: number
}

interface BookingRow {
  id: string
  holder_id: string
  holder_name: string
  service_at: string
  service_time_zone: string
  title: string | null
}

interface UserWorld {
  user_id: string
  holderIds: Set<string>
  config: OpportunityReminderConfig
  rawConfig: Partial<UserReminderConfig> | null
  quiet: { quiet_hours_start?: string; quiet_hours_end?: string }
  webPushGloballyEnabled: boolean
}

interface PushEvent {
  event: OpportunityCalendarEvent
  eligible: boolean
  balance?: string
  serviceTime?: string
  opensAt?: string
  closesAt?: string
}

interface EventWorld {
  id: string
  kind: ObjectKind
  events: PushEvent[]
  holderId: string
  holderName: string
  definitionKind?: string
}

function formatBalance(count: number | null, minor: number | null, currency: string | null): string {
  const amount = minor !== null && currency ? `${currencySymbol(currency)}${(minor / 100).toFixed(2)}` : null
  if (count !== null && amount) return `剩余 ${count} 次 / ${amount}`
  if (count !== null) return `剩余 ${count} 次`
  return amount ? `剩余 ${amount}` : '不限次数'
}

function hasBalance(cycle: CycleRow): boolean {
  return (cycle.remaining_count === null || cycle.remaining_count > 0) &&
    (cycle.remaining_minor === null || cycle.remaining_minor > 0)
}

async function loadAccountWorlds(db: D1Database, id?: string): Promise<EventWorld[]> {
  const [{ results: accounts }, { results: cycles }] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.holder_id, h.name AS holder_name, d.kind AS definition_kind,
              v.id AS version_id, v.rules_json, v.verification,
              a.eligibility != 'ineligible' AND EXISTS (
                SELECT 1 FROM opportunity_account_cards ac
                JOIN credit_cards cc ON cc.id = ac.card_id
                WHERE ac.account_id = a.id AND ac.retired_at IS NULL
                  AND cc.status = 'active' AND cc.card_type = 'credit'
              ) AS eligible
       FROM opportunity_accounts a
       JOIN card_holders h ON h.id = a.holder_id
       JOIN opportunity_definitions d ON d.id = a.definition_id AND d.status = 'active'
       JOIN opportunity_rule_versions v ON v.definition_id = d.id
        AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2 WHERE v2.definition_id = d.id)
       WHERE a.status = 'active' ${id ? 'AND a.id = ?' : ''}`,
    ).bind(...(id ? [id] : [])).all<AccountRow>(),
    db.prepare(
      `SELECT id, account_id, allocation_kind, activation_state, usable_start_on, usable_end_before, currency,
              count_limit - opening_used_count - used_count - reserved_count AS remaining_count,
              amount_limit_minor - opening_used_minor - used_minor - reserved_minor AS remaining_minor
       FROM opportunity_cycles ${id ? 'WHERE account_id = ?' : ''}`,
    ).bind(...(id ? [id] : [])).all<CycleRow>(),
  ])

  const cyclesByAccount = new Map<string, CycleRow[]>()
  for (const cycle of cycles) {
    const group = cyclesByAccount.get(cycle.account_id) ?? []
    group.push(cycle)
    cyclesByAccount.set(cycle.account_id, group)
  }
  const worlds: EventWorld[] = []
  for (const account of accounts) {
    let rules: RuleSnapshotV1
    try {
      rules = parseRules(account.rules_json)
    } catch {
      continue
    }
    const accountCycles = cyclesByAccount.get(account.id) ?? []
    const events: PushEvent[] = []
    for (const cycle of accountCycles) {
      const calendarEvents = await buildCycleCalendarEvents({
        account_id: account.id,
        cycle_id: cycle.id,
        title: rules.title,
        time_zone: rules.time_zone,
        usable_start_on: cycle.usable_start_on,
        usable_end_before: cycle.usable_end_before,
        next_reset_on: cycle.allocation_kind === 'regular' && rules.cycle.kind !== 'one_time'
          ? cycle.usable_end_before : null,
        claim_window: rules.claim_window,
        version_id: account.version_id,
        verification: account.verification,
      })
      for (const entry of calendarEvents) {
        let event = entry
        let opensAt: string | undefined
        let closesAt: string | undefined
        let eligible = Boolean(account.eligible) && cycle.activation_state !== 'voided'
        let balance: string | undefined
        if (event.kind === 'cycle_expiry') {
          eligible &&= cycle.activation_state === 'active' && hasBalance(cycle)
          balance = formatBalance(cycle.remaining_count, cycle.remaining_minor, cycle.currency)
        } else if (event.kind === 'cycle_reset') {
          const next = accountCycles.find(candidate =>
            candidate.allocation_kind === 'regular' && candidate.usable_start_on === event.local_date_on)
          balance = next
            ? formatBalance(next.remaining_count, next.remaining_minor, next.currency)
            : formatBalance(rules.count_limit, rules.amount_limit_minor, rules.currency)
        } else {
          eligible &&= cycle.activation_state === 'pending_claim'
          const start = rules.claim_window?.starts_at
          const end = rules.claim_window?.ends_at
          const opens = event.kind === 'claim_window_open'
          const nodeInstant = opens ? start : end
          if (!nodeInstant) continue
          const localDate = localDateInZone(new Date(nodeInstant), event.time_zone)
          // Retain the calendar's event key while scheduling in the rule's local day.
          event = { ...event, local_date_on: localDate }
          // Shared claim rules can describe multiple cycles; only the overlapping one owns the window.
          if (localDate < cycle.usable_start_on ||
            (cycle.usable_end_before && localDate >= cycle.usable_end_before)) continue
          if (opens && start) opensAt = toRfc3339Utc(new Date(start))
          if (end) {
            event.deadline_before = localDateInZone(new Date(end), event.time_zone)
            closesAt = toRfc3339Utc(new Date(end))
          }
        }
        events.push({ event, eligible, balance, opensAt, closesAt })
      }
    }
    worlds.push({
      id: account.id, kind: 'account', events, holderId: account.holder_id,
      holderName: account.holder_name, definitionKind: account.definition_kind,
    })
  }
  return worlds
}

async function loadTaskWorlds(db: D1Database, id?: string): Promise<EventWorld[]> {
  const { results } = await db.prepare(
    `SELECT tc.id, t.holder_id, h.name AS holder_name, t.title, tc.deadline_at,
            tc.expected_from_on, tc.expected_until_before, tc.rules_snapshot_json, tc.progress_json,
            EXISTS (SELECT 1 FROM opportunity_fulfillments f
                    WHERE f.task_cycle_id = tc.id AND f.kind IN ('grant', 'task_result')
                      AND f.status != 'cancelled') AS reward_recorded
     FROM opportunity_task_cycles tc
     JOIN opportunity_tasks t ON t.id = tc.task_id
     JOIN card_holders h ON h.id = t.holder_id
     WHERE t.status = 'active' ${id ? 'AND tc.id = ?' : ''}`,
  ).bind(...(id ? [id] : [])).all<TaskRow>()
  const worlds: EventWorld[] = []
  for (const row of results) {
    let satisfied: boolean
    try {
      const progress: ManualProgress = JSON.parse(row.progress_json)
      satisfied = evaluateTask(parseTaskConditions(row.rules_snapshot_json), {
        as_of_on: progress.as_of_on ?? row.deadline_at.slice(0, 10),
        metric_values: progress.metric_values ?? {},
        note: progress.note ?? null,
      }).satisfied
    } catch {
      continue
    }
    const events = await buildTaskCalendarEvents({ ...row, task_cycle_id: row.id, satisfied, version: 'task' })
    worlds.push({
      id: row.id, kind: 'task', holderId: row.holder_id, holderName: row.holder_name,
      events: events.map(event => ({
        event,
        eligible: event.kind === 'task_deadline' ? !satisfied : !row.reward_recorded,
      })),
    })
  }
  return worlds
}

async function loadBookingWorlds(db: D1Database, id?: string): Promise<EventWorld[]> {
  const { results } = await db.prepare(
    `SELECT f.id, f.holder_id, h.name AS holder_name, f.service_at, f.service_time_zone,
            json_extract(v.rules_json, '$.title') AS title
     FROM opportunity_fulfillments f
     JOIN card_holders h ON h.id = f.holder_id
     JOIN opportunity_accounts a ON a.id = f.account_id AND a.status = 'active' AND a.eligibility != 'ineligible'
     JOIN opportunity_definitions d ON d.id = a.definition_id AND d.status = 'active'
     JOIN opportunity_rule_versions v ON v.definition_id = d.id
       AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2 WHERE v2.definition_id = d.id)
       AND v.verification != 'unverified'
     JOIN opportunity_account_cards ac ON ac.account_id = a.id AND ac.card_id = f.card_id AND ac.retired_at IS NULL
     JOIN credit_cards cc ON cc.id = f.card_id AND cc.status = 'active' AND cc.card_type = 'credit'
     WHERE f.kind = 'booking' AND f.status = 'recorded' ${id ? 'AND f.id = ?' : ''}`,
  ).bind(...(id ? [id] : [])).all<BookingRow>()
  const worlds: EventWorld[] = []
  for (const row of results) {
    const serviceAt = new Date(row.service_at)
    if (!Number.isFinite(serviceAt.getTime()) || !isValidIanaTimeZone(row.service_time_zone)) continue
    const localDate = localDateInZone(serviceAt, row.service_time_zone)
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: row.service_time_zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(serviceAt)
    const events = await buildBookingCalendarEvents({
      fulfillment_id: row.id, title: row.title ?? '预约服务',
      service_at: row.service_at, service_time_zone: row.service_time_zone,
    })
    worlds.push({
      id: row.id, kind: 'fulfillment', holderId: row.holder_id, holderName: row.holder_name,
      events: events.map(event => ({
        event: { ...event, local_date_on: localDate, deadline_before: localDate },
        eligible: true,
        serviceTime: `${localDate} ${localTime}`,
      })),
    })
  }
  return worlds
}

const worldLoaders = {
  account: loadAccountWorlds,
  task: loadTaskWorlds,
  fulfillment: loadBookingWorlds,
}

/** Users + holder universe + merged opportunity preferences (batched). */
async function loadUsers(db: D1Database, userId?: string): Promise<UserWorld[]> {
  const { results: rows } = await db.prepare(
    `SELECT u.id AS user_id, p.reminder_config, h.id AS holder_id
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.id
     LEFT JOIN card_holders h ON (
       (u.role = 'admin' AND (h.created_by = u.id OR h.managed_by = u.id))
       OR (u.role = 'member' AND h.auth_user_id = u.id)
     )
     ${userId ? 'WHERE u.id = ?' : ''}`,
  ).bind(...(userId ? [userId] : [])).all<{
    user_id: string; reminder_config: string | null; holder_id: string | null
  }>()
  const users = new Map<string, UserWorld>()
  for (const row of rows) {
    let user = users.get(row.user_id)
    if (!user) {
      let rawConfig: Partial<UserReminderConfig> | null = null
      let config: OpportunityReminderConfig
      try {
        rawConfig = JSON.parse(row.reminder_config ?? 'null')
        config = mergeOpportunityReminderConfig(rawConfig?.opportunities)
      } catch {
        config = mergeOpportunityReminderConfig(null)
      }
      user = {
        user_id: row.user_id,
        holderIds: new Set(),
        config,
        rawConfig,
        quiet: {
          quiet_hours_start: rawConfig?.quiet_hours_start,
          quiet_hours_end: rawConfig?.quiet_hours_end,
        },
        webPushGloballyEnabled: isWebPushChannelEnabled(row.reminder_config),
      }
      users.set(row.user_id, user)
    }
    if (row.holder_id) user.holderIds.add(row.holder_id)
  }
  return [...users.values()]
}

function opportunitySwitchKeyForEvent(
  kind: OpportunityCalendarEvent['kind'],
  definitionKind?: string
): OpportunitySwitchKey {
  if (kind === 'cycle_reset') return 'opportunity_reset'
  if (kind === 'claim_window_open' || kind === 'claim_window_deadline') return 'opportunity_claim'
  if (kind === 'booking_service') return 'opportunity_booking'
  if (kind === 'task_deadline' || kind === 'reward_window') return 'opportunity_task'
  if (kind === 'cycle_expiry' && definitionKind === 'promo') return 'opportunity_activity'
  return 'opportunity_expiry'
}

function isOpportunityInboxEnabled(user: UserWorld, switchKey: OpportunitySwitchKey): boolean {
  if (!user.config.enabled || !isOpportunitySwitchEnabled(user.rawConfig, switchKey)) return false
  if (switchKey === 'opportunity_reset' && !user.config.reset_enabled) return false
  if (switchKey === 'opportunity_booking' && !user.config.booking_enabled) return false
  return true
}

function reminderSteps(event: OpportunityCalendarEvent, user: UserWorld, category: OpportunitySwitchKey) {
  const before = (days: number[]) => [...new Set([0, ...days])].map(daysBefore => ({
    key: `d${daysBefore}`, date: addDays(event.local_date_on, -daysBefore),
  }))
  switch (event.kind) {
    case 'cycle_expiry':
      return before(category === 'opportunity_activity' ? user.config.activity_days_before : user.config.expiry_days_before)
    case 'cycle_reset': return [{ key: 'reset', date: event.local_date_on }]
    case 'claim_window_open': return [{ key: 'open', date: event.local_date_on }]
    case 'claim_window_deadline': return before(user.config.claim_days_before)
    case 'task_deadline': return before(user.config.task_days_before)
    case 'reward_window': return before([0])
    case 'booking_service': return before([1])
  }
}

function eventExpiry({ event, closesAt }: PushEvent): string {
  const exclusiveDate = event.kind === 'cycle_expiry' || event.kind === 'reward_window'
    ? event.deadline_before : null
  const end = exclusiveDate ?? addDays(event.deadline_before ?? event.local_date_on, 1)
  const endOfDay = localWallTimeToInstant(end, '00:00', event.time_zone).utc
  return closesAt && closesAt < endOfDay ? closesAt : endOfDay
}

function scheduleNode(pushEvent: PushEvent, date: string, user: UserWorld): string {
  const { utc } = resolveDeliveryInstant(date, user.config.local_time, user.config.time_zone, user.quiet)
  return pushEvent.opensAt && pushEvent.opensAt > utc ? pushEvent.opensAt : utc
}

async function enqueueDueJobs(deps: ScanDeps, users: UserWorld[], worlds: EventWorld[], report: ScanReport) {
  const nowIso = toRfc3339Utc(deps.now)
  const localDates = new Map<string, string>()
  const jobs: { id: string; statement: D1PreparedStatement; status: string }[] = []
  for (const user of users) {
    for (const world of worlds) {
      if (!user.holderIds.has(world.holderId)) continue
      for (const pushEvent of world.events) {
        const { event } = pushEvent
        if (event.needs_review) continue
        const category = opportunitySwitchKeyForEvent(event.kind, world.definitionKind)
        if (!isOpportunityInboxEnabled(user, category)) continue
        let today = localDates.get(event.time_zone)
        if (!today) {
          today = localDateInZone(deps.now, event.time_zone)
          localDates.set(event.time_zone, today)
        }
        const steps = reminderSteps(event, user, category).filter(step => step.date === today)
        if (!steps.length) continue
        const expiresAt = eventExpiry(pushEvent)
        for (const step of steps) {
          const scheduledAt = scheduleNode(pushEvent, step.date, user)
          const status = scheduledAt >= expiresAt || nowIso >= expiresAt ? 'cancelled' : 'pending'
          const id = `onj_${crypto.randomUUID()}`
          const statement = deps.db.prepare(
            `INSERT INTO opportunity_notification_jobs
               (id, user_id, holder_id, event_key, delivery_key, object_kind, object_id,
                business_version, scheduled_at, expires_at, status, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(user_id, delivery_key) DO UPDATE SET
               scheduled_at = excluded.scheduled_at, expires_at = excluded.expires_at,
               status = excluded.status, updated_at = excluded.updated_at
             WHERE opportunity_notification_jobs.status = 'pending'
               AND opportunity_notification_jobs.attempt_count = 0
               AND opportunity_notification_jobs.expires_at IS NOT excluded.expires_at
             RETURNING id`,
          ).bind(
            id, user.user_id, world.holderId, event.event_key,
            reminderDeliveryKey(event.event_key, step.key), world.kind, world.id,
            `${event.deadline_before ?? 'none'}|${event.event_key}`,
            scheduledAt, expiresAt, status, nowIso, nowIso,
          )
          jobs.push({ id, statement, status })
        }
      }
    }
  }
  for (let offset = 0; offset < jobs.length; offset += DEFAULT_BATCH) {
    const batch = jobs.slice(offset, offset + DEFAULT_BATCH)
    const results = await deps.db.batch<{ id: string }>(batch.map(job => job.statement))
    for (const [index, result] of results.entries()) {
      const updated = result.results[0]
      if (!updated) continue
      if (updated.id === batch[index].id) report.jobs_created++
      if (batch[index].status === 'cancelled') report.cancelled++
    }
  }
}

interface JobRow {
  id: string
  user_id: string
  event_key: string
  delivery_key: string
  object_kind: ObjectKind
  object_id: string
  lease_until: string
  attempt_count: number
}

function buildBody(pushEvent: PushEvent, world: EventWorld, step: string) {
  const { event, balance, serviceTime } = pushEvent
  const { title } = event
  const holder = world.holderName
  const accountUrl = `/benefits?account_id=${encodeURIComponent(world.id)}`
  const claimUrl = `${accountUrl}&action=claim`
  const taskUrl = `/benefits/tasks?task_cycle_id=${encodeURIComponent(world.id)}`
  const days = Number(step.slice(1))
  switch (event.kind) {
    case 'cycle_expiry':
      return {
        title: `${days === 0 ? '今日截止' : '即将到期'}：${title}`,
        body: days === 0 ? `${holder} · ${balance}，今日为最后可用日，逾期将清零。`
          : `${holder} · ${balance}，将于 ${days} 天后（${event.local_date_on}）失效，请及时使用。`,
        url: accountUrl,
      }
    case 'cycle_reset':
      return {
        title: `额度已重置：${title}`,
        body: `${holder} · 新周期已开启，可用额度：${balance}。`,
        url: accountUrl,
      }
    case 'claim_window_open':
      return {
        title: `抢兑/领取开启：${title}`,
        body: `${holder} · 本期领取窗口今日已开启，点击去记录领取。`,
        url: claimUrl,
      }
    case 'claim_window_deadline':
      return {
        title: `${days === 0 ? '今日截止领取' : `${days}天后截止领取`}：${title}`,
        body: `${holder} · 领取窗口将于 ${event.local_date_on} 关闭，尚未标记已领取。`,
        url: claimUrl,
      }
    case 'task_deadline':
      return {
        title: `${days === 0 ? '任务今日截止' : '达标任务提醒'}：${title}`,
        body: `${holder} · 距任务统计截止还剩 ${days} 天（${event.local_date_on}），当前未达标。`,
        url: taskUrl,
      }
    case 'reward_window':
      return {
        title: `奖励预计到账窗口：${title}`,
        body: `${holder} · 已达标任务进入预计发放窗口，实际到账后请手动确认。`,
        url: taskUrl,
      }
    case 'booking_service':
      return {
        title: `${days === 0 ? '今日预约服务' : '预约服务提醒'}：${title}`,
        body: `${holder} · 预约时间 ${serviceTime}，使用或取消后请及时结算。`,
        url: `/benefits/calendar?event_key=${encodeURIComponent(event.event_key)}`,
      }
  }
}

async function reverify(db: D1Database, job: JobRow, nowIso: string) {
  const [[world], [user], state] = await Promise.all([
    worldLoaders[job.object_kind](db, job.object_id),
    loadUsers(db, job.user_id),
    db.prepare(
      `SELECT dismissed_at, snooze_until FROM opportunity_reminder_states
       WHERE user_id = ? AND event_key = ?`,
    ).bind(job.user_id, job.event_key).first<{ dismissed_at: string | null; snooze_until: string | null }>(),
  ])
  if (!world || !user?.holderIds.has(world.holderId) || state?.dismissed_at ||
    (state?.snooze_until && Date.parse(state.snooze_until) > Date.parse(nowIso))) return null
  const pushEvent = world.events.find(candidate => candidate.event.event_key === job.event_key)
  if (!pushEvent?.eligible || pushEvent.event.needs_review) return null
  const category = opportunitySwitchKeyForEvent(pushEvent.event.kind, world.definitionKind)
  if (!isOpportunityInboxEnabled(user, category)) return null
  const expiresAt = eventExpiry(pushEvent)
  if (nowIso >= expiresAt) return null
  return { world, user, pushEvent, category, expiresAt }
}

async function finishJob(
  db: D1Database, job: JobRow, status: string, nowIso: string, error: string | null = null,
) {
  await db.prepare(
    `UPDATE opportunity_notification_jobs
     SET status = ?, lease_until = NULL, updated_at = ?, last_error = ?
     WHERE id = ? AND lease_until = ? AND status = 'leased'`,
  ).bind(status, nowIso, error, job.id, job.lease_until).run()
}

async function recordDelivery(
  db: D1Database, job: JobRow, channel: 'web_push' | 'apns', targetId: string,
  outcome: SendOutcome, nowIso: string,
) {
  const statements = [db.prepare(
    `INSERT INTO opportunity_notification_deliveries
       (id, job_id, subscription_id, channel, status, accepted_at, last_error, attempt_count)
     SELECT ?,?,?,?,?,?,?,1
     WHERE EXISTS (SELECT 1 FROM opportunity_notification_jobs
                   WHERE id = ? AND status = 'leased' AND lease_until = ?)
     ON CONFLICT(job_id, subscription_id) DO UPDATE SET
       status = excluded.status, accepted_at = excluded.accepted_at, last_error = excluded.last_error,
       attempt_count = opportunity_notification_deliveries.attempt_count + 1
     WHERE opportunity_notification_deliveries.status NOT IN ('accepted', 'gone')`,
  ).bind(
    `ond_${crypto.randomUUID()}`, job.id, targetId, channel,
    outcome.ok ? 'accepted' : outcome.gone ? 'gone' : 'failed',
    outcome.ok ? nowIso : null, outcome.ok ? null : (outcome.error ?? 'send failed'),
    job.id, job.lease_until,
  )]
  if (outcome.ok) {
    statements.push(db.prepare(
      `UPDATE notification_history SET status = 'sent', push_sent_at = ?, error = NULL
       WHERE user_id = ? AND notification_key = ? AND push_sent_at IS NULL
         AND EXISTS (SELECT 1 FROM opportunity_notification_deliveries
                     WHERE job_id = ? AND subscription_id = ? AND status = 'accepted')`,
    ).bind(nowIso, job.user_id, `opp:${job.delivery_key}`, job.id, targetId))
  }
  await db.batch(statements)
}

async function deliverJob(
  deps: ScanDeps, job: JobRow, nowIso: string, report: ScanReport,
) {
  const { db } = deps
  const current = await reverify(db, job, nowIso)
  if (!current) {
    await finishJob(db, job, 'cancelled', nowIso)
    report.cancelled++
    return
  }

  const { world, user, pushEvent, category, expiresAt } = current
  const step = job.delivery_key.slice(job.event_key.length + 1)
  const node = reminderSteps(pushEvent.event, user, category).find(candidate => candidate.key === step)
  if (!node) {
    await finishJob(db, job, 'cancelled', nowIso)
    report.cancelled++
    return
  }
  let nextAttempt = scheduleNode(pushEvent, node.date, user)
  const isQuiet = isInQuietHours(deps.now, user.config.time_zone, user.quiet.quiet_hours_start, user.quiet.quiet_hours_end)
  if (isQuiet) {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: user.config.time_zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(deps.now)
    const today = localDateInZone(deps.now, user.config.time_zone)
    const { utc } = resolveDeliveryInstant(today, clock, user.config.time_zone, user.quiet)
    const quietEnd = utc > nowIso ? utc : toRfc3339Utc(new Date(deps.now.getTime() + 15 * 60_000))
    if (quietEnd > nextAttempt) nextAttempt = quietEnd
  }
  if (nextAttempt >= expiresAt) {
    await finishJob(db, job, 'cancelled', nowIso)
    report.cancelled++
    return
  }
  if (nextAttempt > nowIso) {
    // A preference change or quiet period can postpone an already queued job.
    await db.prepare(
      `UPDATE opportunity_notification_jobs
       SET status = 'pending', lease_until = NULL, attempt_count = attempt_count - 1,
           scheduled_at = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'leased' AND lease_until = ?`,
    ).bind(nextAttempt, expiresAt, nowIso, job.id, job.lease_until).run()
    return
  }

  const message = buildBody(pushEvent, world, step)
  const inboxKey = `opp:${job.delivery_key}`
  await db.prepare(
    `INSERT OR IGNORE INTO notification_history
       (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped')`,
  ).bind(
    crypto.randomUUID(), job.user_id, inboxKey, category, message.title, message.body, message.url,
    JSON.stringify({
      kind: 'opportunity', event_key: job.event_key, delivery_key: job.delivery_key, object_id: job.object_id,
    }),
    nowIso,
  ).run()

  if (!user.webPushGloballyEnabled) {
    await finishJob(db, job, 'skipped', nowIso, 'web_push_disabled')
    report.skipped_web_push_disabled++
    return
  }

  const [{ results: subs }, { results: devices }, { results: priorDeliveries }] = await Promise.all([
    db.prepare('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(job.user_id).all<PushSubscriptionRow>(),
    deps.apnsSender
      ? db.prepare("SELECT id, user_id, token FROM device_tokens WHERE user_id = ? AND platform = 'ios'")
        .bind(job.user_id).all<DeviceTokenRow>()
      : { results: [] },
    db.prepare('SELECT subscription_id, status FROM opportunity_notification_deliveries WHERE job_id = ?')
      .bind(job.id).all<{ subscription_id: string; status: string }>(),
  ])
  if (!subs.length && !devices.length && !priorDeliveries.length) {
    await finishJob(db, job, 'skipped', nowIso, 'no_subscription')
    report.skipped_no_subscription++
    return
  }

  const terminalTargets = new Set(priorDeliveries.filter(row => row.status !== 'failed' && row.status !== 'pending')
    .map(row => row.subscription_id))
  let accepted = priorDeliveries.filter(row => row.status === 'accepted').length
  let failures = 0
  const applyOutcome = async (channel: 'web_push' | 'apns', targetId: string, outcome: SendOutcome) => {
    await recordDelivery(db, job, channel, targetId, outcome, nowIso)
    if (outcome.ok) accepted++
    else if (!outcome.gone) failures++
  }

  const payload = JSON.stringify({ ...message, tag: reminderTag(job.delivery_key) })
  const ttlSeconds = Math.min(86_400, Math.floor((Date.parse(expiresAt) - deps.now.getTime()) / 1000))
  for (const sub of subs) {
    if (terminalTargets.has(sub.id)) continue
    let outcome: SendOutcome
    try {
      outcome = await deps.sender(sub, payload, ttlSeconds)
    } catch (error) {
      outcome = { ok: false, error: String(error) }
    }
    await applyOutcome('web_push', sub.id, outcome)
    if (outcome.gone) {
      const deleted = await db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?')
        .bind(sub.id, job.user_id).run()
      report.subscriptions_deleted += Number(deleted.meta.changes ?? 0)
    }
  }
  const pendingDevices = devices.filter(device => !terminalTargets.has(`apns:${device.id}`))
  if (deps.apnsSender && pendingDevices.length) {
    let outcomes: Map<string, SendOutcome>
    try {
      outcomes = await deps.apnsSender(job.user_id, pendingDevices, {
        alert: { title: message.title, body: message.body },
        sound: 'default',
        badge: 1,
        expirationSeconds: ttlSeconds,
        customData: { type: category, url: message.url, delivery_key: job.delivery_key, event_key: job.event_key },
      })
    } catch (error) {
      outcomes = new Map(pendingDevices.map(device => [device.id, { ok: false, error: String(error) }]))
    }
    for (const device of pendingDevices) {
      const outcome = outcomes.get(device.id) ?? { ok: false, error: 'APNs returned no device result' }
      await applyOutcome('apns', `apns:${device.id}`, outcome)
      if (outcome.gone) {
        await db.prepare('DELETE FROM device_tokens WHERE id = ? AND user_id = ? AND token = ?')
          .bind(device.id, job.user_id, device.token).run()
      }
    }
  }

  const status = accepted > 0 ? (failures ? 'partial' : 'sent')
    : failures ? (job.attempt_count >= MAX_ATTEMPTS ? 'failed' : 'pending') : 'skipped'
  const error = failures ? `${failures} 台设备发送失败` : status === 'skipped' ? 'all_endpoints_gone' : null
  await finishJob(db, job, status, nowIso, error)
  if (accepted > 0 || status === 'failed') {
    await db.prepare(
      `UPDATE notification_history SET status = ?, error = ?
       WHERE user_id = ? AND notification_key = ? AND error IS NOT ?`,
    ).bind(accepted > 0 ? 'sent' : 'failed', error, job.user_id, inboxKey, error).run()
  }
  if (status === 'sent' || status === 'partial' || status === 'failed') report[status]++
}

/** Scan events, claim a bounded batch, and recheck each job before sending. */
export async function scanOpportunityNotifications(deps: ScanDeps): Promise<ScanReport> {
  const { db } = deps
  const nowIso = toRfc3339Utc(deps.now)
  const leaseUntil = toRfc3339Utc(new Date(deps.now.getTime() + (deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS) * 1000))
  const report: ScanReport = {
    jobs_created: 0, jobs_claimed: 0, sent: 0, partial: 0, failed: 0, cancelled: 0,
    skipped_no_subscription: 0, skipped_web_push_disabled: 0, subscriptions_deleted: 0,
  }
  const [users, ...worlds] = await Promise.all([
    loadUsers(db), loadAccountWorlds(db), loadTaskWorlds(db), loadBookingWorlds(db),
  ])
  await enqueueDueJobs(deps, users, worlds.flat(), report)

  const expired = await db.prepare(
    `UPDATE opportunity_notification_jobs SET status = 'cancelled', lease_until = NULL, updated_at = ?
     WHERE expires_at <= ? AND ((status IN ('pending', 'partial') AND attempt_count < ?)
                               OR (status = 'leased' AND lease_until <= ?))`,
  ).bind(nowIso, nowIso, MAX_ATTEMPTS, nowIso).run()
  report.cancelled += Number(expired.meta.changes ?? 0)

  // A worker that stops on the last attempt cannot leave an unreclaimable lease.
  await db.prepare(
    `UPDATE opportunity_notification_jobs SET
       status = CASE WHEN EXISTS (SELECT 1 FROM opportunity_notification_deliveries
                        WHERE job_id = opportunity_notification_jobs.id AND status = 'accepted')
                     THEN 'partial' ELSE 'failed' END,
       lease_until = NULL, updated_at = ?, last_error = 'lease_exhausted'
     WHERE status = 'leased' AND lease_until <= ? AND attempt_count >= ?`,
  ).bind(nowIso, nowIso, MAX_ATTEMPTS).run()

  const { results: claimed } = await db.prepare(
    `UPDATE opportunity_notification_jobs
     SET status = 'leased', lease_until = ?, attempt_count = attempt_count + 1, updated_at = ?
     WHERE id IN (
       SELECT id FROM opportunity_notification_jobs
       WHERE attempt_count < ? AND (expires_at IS NULL OR expires_at > ?) AND (
         (status IN ('pending', 'partial') AND scheduled_at <= ?)
         OR (status = 'leased' AND lease_until <= ?)
       )
       ORDER BY scheduled_at, id LIMIT ?
     )
     RETURNING id, user_id, event_key, delivery_key, object_kind, object_id, lease_until, attempt_count`,
  ).bind(leaseUntil, nowIso, MAX_ATTEMPTS, nowIso, nowIso, nowIso, deps.batchSize ?? DEFAULT_BATCH).all<JobRow>()
  report.jobs_claimed = claimed.length

  for (const job of claimed) {
    try {
      await deliverJob(deps, job, nowIso, report)
    } catch (error) {
      console.error(`[opportunity-cron] Job ${job.id} failed:`, error)
    }
  }
  return report
}

export function apnsCronSender(env: OpportunityCronEnv): ApnsBatchSender | undefined {
  const { APNS_KEY_P8: keyP8, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = env
  if (!keyP8 || !keyId || !teamId) return undefined
  return async (userId, devices, options) => {
    const { outcomes } = await sendApnsToUser(userId, options, {
      keyP8, keyId, teamId, bundleId: env.APNS_BUNDLE_ID, isProduction: env.APNS_ENVIRONMENT === 'production',
    }, devices.map(device => device.token), true)
    const byToken = new Map(outcomes.map(outcome => [outcome.token, outcome]))
    return new Map(devices.flatMap(device => {
      const result = byToken.get(device.token)
      return result ? [[device.id, { ok: result.success, gone: result.invalidToken, error: result.error }]] : []
    }))
  }
}

/** Pure cron routing: the two crons own disjoint duties (spec §10.3). */
export function routeOpportunityCron(cron: string): 'opportunities' | 'bills' | null {
  if (cron === '*/15 * * * *') return 'opportunities'
  if (cron === '0 * * * *' || cron === '0 9 * * *') return 'bills'
  return null
}

/** Production sender wrapping web-push; tests never use this. */
export function webPushSender(env: OpportunityCronEnv): PushSender {
  return async (sub, payload, ttlSeconds) => {
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
        { TTL: ttlSeconds, timeout: 10_000 },
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
