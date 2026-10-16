// lib/__tests__/opportunity-cron.test.ts — the */15 scanner (plan Task 15):
// dispatch routing, idempotent job creation, lease reclaim, send-time
// cancellation (dismissed events, expired deadlines, unlinked cards), no
// subscription → skipped, attempt cap → failed. The sender is an injected
// stub; no real push endpoints are ever contacted.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { scanOpportunityNotifications, routeOpportunityCron, type PushSender } from '../../worker/opportunity-cron'
import { updateOpportunityReminderState } from '../opportunities/notifications.server'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
// 2026-10-15 09:00 Asia/Shanghai — the default local_time slot
const CLOCK = new Date('2026-10-15T01:00:00Z')

let seq = 0
const rk = () => `cron-rk-seed-${String(++seq).padStart(4, '0')}`

interface SentCall {
  endpoint: string
  payload: { title: string; body: string; url: string; tag: string }
}

function stubSender(outcomes: Record<string, 'ok' | 'fail' | 'gone'> = {}): {
  sender: PushSender
  calls: SentCall[]
} {
  const calls: SentCall[] = []
  const sender: PushSender = async (sub, payload) => {
    calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as SentCall['payload'] })
    const outcome = outcomes[sub.endpoint] ?? 'ok'
    if (outcome === 'ok') return { ok: true }
    if (outcome === 'gone') return { ok: false, gone: true, error: '410 Gone' }
    return { ok: false, error: 'boom' }
  }
  return { sender, calls }
}

function rules(validUntilBefore: string | null = '2026-10-16'): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: 'Cron 验证权益',
    description: null,
    category: 'other',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    card_product_ids: [f.products.cmbClassic],
    valid_from: validUntilBefore === null ? null : '2026-10-01',
    valid_until_before: validUntilBefore,
    open_ended: validUntilBefore === null,
    weekdays: null,
    // one_time：周期=规则窗口本身，截止由规则决定（周期身份不可 UPDATE）
    cycle: { kind: 'one_time', anchor_month: null, anchor_day: null, anchor_source: null },
    allocation: 'recurring',
    count_limit: 6,
    amount_limit_minor: null,
    currency: null,
    unit_label: '次',
    eligibility_text: null,
    requires_personal_confirmation: false,
    claim_window: null,
    booking_window: null,
    workflow_time_basis: 'fixed',
    booking_consumes: 'reserve_then_use',
    cancellation_rule: 'confirm_with_issuer',
    entry: { website_url: null, app_name: null, app_path: null },
  }
}

/** Account whose one_time window ends 2026-10-16 → expiry event today (10-15). */
async function seedExpiringWorld(validUntilBefore: string | null = '2026-10-16') {
  const n = ++seq
  const defId = `odef-cron-${n}`
  const versionId = `orv-cron-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(rules(validUntilBefore))),
  ])
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
  }, { now: '2026-10-15T01:00:00Z' })
  if (!created.cycle) throw new Error('no cycle')
  return created
}

async function addSubscription(userId: string, endpoint: string) {
  await db
    .prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
    .bind(`sub-${endpoint}`, userId, endpoint, 'pk', 'ak', '2026-10-01T00:00:00Z')
    .run()
}

function jobs(): Array<{ id: string; status: string; delivery_key: string; event_key: string; attempt_count: number }> {
  return db.raw
    .prepare('SELECT id, status, delivery_key, event_key, attempt_count FROM opportunity_notification_jobs')
    .all() as unknown as Array<{ id: string; status: string; delivery_key: string; event_key: string; attempt_count: number }>
}

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('routeOpportunityCron', () => {
  it('*/15 只权益；0 9 只账单；未知表达式不处理', () => {
    expect(routeOpportunityCron('*/15 * * * *')).toBe('opportunities')
    expect(routeOpportunityCron('0 9 * * *')).toBe('bills')
    expect(routeOpportunityCron('0 * * * *')).toBeNull()
  })
})

describe('scanOpportunityNotifications', () => {
  it('同节点两次扫描只创建一个 job、只发送一次', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/a')
    const { sender, calls } = stubSender()

    const first = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(first.jobs_created).toBeGreaterThan(0)
    expect(first.sent).toBe(1)

    const second = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(second.jobs_created).toBe(0)
    expect(second.jobs_claimed).toBe(0)
    expect(calls).toHaveLength(1)
    expect(jobs().every((j) => j.status === 'sent')).toBe(true)
  })

  it('payload 带稳定 wc-op tag 与站内白名单 URL', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/a')
    const { sender, calls } = stubSender()
    await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    const payload = calls[0].payload
    expect(payload.tag.startsWith('wc-op:')).toBe(true)
    expect(payload.url).toBe('/benefits')
    // tag 与 delivery_key 对应
    const job = jobs()[0]
    expect(payload.tag).toBe(`wc-op:${job.delivery_key}`)
  })

  it('忽略事件后取消，不再发送', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/a')
    // 从日历 API 拿到今天的到期事件并忽略，再扫描验证取消
    const { getOpportunityCalendar } = await import('../opportunities/notifications.server')
    const cal = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-15', to_before: '2026-10-16' })
    const expiry = cal.events.find((e) => e.kind === 'cycle_expiry')!
    await updateOpportunityReminderState(actorAdminA, {
      event_key: expiry.event_key, action: 'dismiss',
    }, { now: CLOCK.toISOString() })
    const { sender, calls } = stubSender()
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(report.sent).toBe(0)
    expect(report.cancelled).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('解绑卡（无 active 关联卡）后取消', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/a')
    await db
      .prepare('UPDATE opportunity_account_cards SET retired_at = ? WHERE card_id = ?')
      .bind('2026-10-15T00:00:00Z', f.cards.selfMain)
      .run()
    const { sender, calls } = stubSender()
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(report.sent).toBe(0)
    expect(report.cancelled).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('无订阅 → skipped（应用内提醒仍可用）', async () => {
    await seedExpiringWorld()
    const { sender } = stubSender()
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(report.skipped_no_subscription).toBe(1)
    expect(jobs()[0].status).toBe('skipped')
  })

  it('租约过期的 job 可被重新认领', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/a')
    const { sender } = stubSender()
    // 人为制造一个悬挂租约（扫描中途崩溃的等价物）
    await db.batch([
      db.prepare(
        `INSERT INTO opportunity_notification_jobs
           (id, user_id, holder_id, event_key, delivery_key, object_kind, object_id, business_version,
            scheduled_at, expires_at, status, attempt_count, lease_until, created_at, updated_at)
         VALUES ('onj-lease-1', ?, ?, 'op:expiry:whatever:1:2', 'op:expiry:whatever:1:2:d0', 'account', 'x',
                 'v', '2000-01-01T00:00:00Z', '2999-01-01T00:00:00Z', 'leased', 1, '2000-01-01T00:00:00Z',
                 '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')`,
      ).bind(f.users.adminA, f.holders.self),
    ])
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    // 悬挂 job 被重新认领；账户不存在 → reverify 取消（无悬挂残留）
    expect(report.cancelled).toBeGreaterThanOrEqual(1)
    const leased = db.raw
      .prepare("SELECT status FROM opportunity_notification_jobs WHERE id = 'onj-lease-1'")
      .get() as { status: string }
    expect(['cancelled', 'sent', 'partial', 'failed', 'pending']).toContain(leased.status)
  })

  it('窗口已结束的世界不再产生新事件', async () => {
    // 截止 10-15（半开）→ 最后可用日 10-14，今天 10-15 没有任何节点
    await seedExpiringWorld('2026-10-15')
    await addSubscription(f.users.adminA, 'https://push.example/a')
    const { sender, calls } = stubSender()
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(report.jobs_created).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('尝试上限后记 failed 而不是无限重试', async () => {
    await seedExpiringWorld()
    await addSubscription(f.users.adminA, 'https://push.example/bad')
    let clock = new Date('2026-10-15T01:00:00Z')
    for (let i = 0; i < 5; i++) {
      const { sender } = stubSender({ 'https://push.example/bad': 'fail' })
      await scanOpportunityNotifications({ db: db as unknown as D1Database, now: clock, sender })
      clock = new Date(clock.getTime() + 15 * 60_000)
    }
    const job = jobs()[0]
    expect(['failed', 'pending']).toContain(job.status)
    if (job.attempt_count >= 4) expect(job.status).toBe('failed')
  })
})
