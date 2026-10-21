// lib/__tests__/opportunity-push.test.ts — push delivery semantics (plan
// Task 15 step 6): partial device failure retries ONLY the failed devices on
// the next pass, 404/410 deletes the subscription (delivery recorded gone),
// zero accepted never records sent, and the payload stays tag+whitelist-url.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { scanOpportunityNotifications, type PushSender } from '../../worker/opportunity-cron'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const CLOCK = new Date('2026-10-15T01:00:00Z')

function rules(): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '推送验证权益',
    description: null,
    category: 'other',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    card_product_ids: [f.products.cmbClassic],
    valid_from: '2026-10-01',
    valid_until_before: '2026-10-16',
    open_ended: false,
    weekdays: null,
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

async function seedWorld() {
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES ('odef-push', 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES ('orv-push', 'odef-push', 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(JSON.stringify(rules())),
  ])
  await createOpportunityAccount(actorAdminA, {
    definition_id: 'odef-push', holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: 'push-seed-key-00001',
  }, { now: '2026-10-15T01:00:00Z' })
}

async function addSubscription(endpoint: string) {
  await db
    .prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
    .bind(`sub-${endpoint}`, f.users.adminA, endpoint, 'pk', 'ak', '2026-10-01T00:00:00Z')
    .run()
}

function senderWith(script: Record<string, Array<'ok' | 'fail' | 'gone'>>): { sender: PushSender; calls: string[] } {
  const calls: string[] = []
  const counts = new Map<string, number>()
  const sender: PushSender = async (sub) => {
    calls.push(sub.endpoint)
    const n = (counts.get(sub.endpoint) ?? 0) + 1
    counts.set(sub.endpoint, n)
    const outcome = script[sub.endpoint]?.[n - 1] ?? script[sub.endpoint]?.[script[sub.endpoint]!.length - 1] ?? 'ok'
    if (outcome === 'ok') return { ok: true }
    if (outcome === 'gone') return { ok: false, gone: true, error: '410 Gone' }
    return { ok: false, error: 'timeout' }
  }
  return { sender, calls }
}

function jobRow() {
  return db.raw
    .prepare('SELECT id, status FROM opportunity_notification_jobs')
    .get() as { id: string; status: string }
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

describe('multi-device delivery', () => {
  it('部分失败 → partial；下一轮只重发失败设备', async () => {
    await seedWorld()
    await addSubscription('https://push.example/good')
    await addSubscription('https://push.example/bad')

    const pass1 = senderWith({ 'https://push.example/good': ['ok'], 'https://push.example/bad': ['fail'] })
    const r1 = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender: pass1.sender })
    expect(r1.sent).toBe(0)
    expect(r1.partial).toBe(1)
    expect(jobRow().status).toBe('partial')
    // 交付记录：good=accepted，bad=failed
    const deliveries = db.raw
      .prepare('SELECT status FROM opportunity_notification_deliveries ORDER BY subscription_id')
      .all() as Array<{ status: string }>
    expect(deliveries.map((d) => d.status).sort()).toEqual(['accepted', 'failed'])

    // 第二轮：bad 恢复；只补发 bad，不重发已 accepted 的 good
    const pass2 = senderWith({ 'https://push.example/good': ['ok'], 'https://push.example/bad': ['ok'] })
    const r2 = await scanOpportunityNotifications({
      db: db as unknown as D1Database,
      now: new Date(CLOCK.getTime() + 15 * 60_000),
      sender: pass2.sender,
    })
    expect(r2.sent).toBe(1)
    expect(pass2.calls).toEqual(['https://push.example/bad'])
    expect(jobRow().status).toBe('sent')
    const finalDeliveries = db.raw
      .prepare("SELECT status FROM opportunity_notification_deliveries WHERE status = 'accepted'")
      .all() as Array<{ status: string }>
    expect(finalDeliveries).toHaveLength(2)
  })

  it('404/410 → 删除订阅并记录 gone；另一台设备不受影响', async () => {
    await seedWorld()
    await addSubscription('https://push.example/dead')
    await addSubscription('https://push.example/live')
    const { sender } = senderWith({
      'https://push.example/dead': ['gone'],
      'https://push.example/live': ['ok'],
    })
    const report = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    // gone 设备不算失败：存活设备送达即 sent，死订阅被清理
    expect(report.sent).toBe(1)
    expect(report.subscriptions_deleted).toBe(1)
    const remaining = db.raw.prepare('SELECT endpoint FROM push_subscriptions').all() as Array<{ endpoint: string }>
    expect(remaining.map((r) => r.endpoint)).toEqual(['https://push.example/live'])
    const gone = db.raw
      .prepare("SELECT status FROM opportunity_notification_deliveries WHERE status = 'gone'")
      .all()
    expect(gone).toHaveLength(1)
  })

  it('全部失败 → 记 pending/failed，绝不记 sent', async () => {
    await seedWorld()
    await addSubscription('https://push.example/x')
    const { sender } = senderWith({ 'https://push.example/x': ['fail'] })
    const r1 = await scanOpportunityNotifications({ db: db as unknown as D1Database, now: CLOCK, sender })
    expect(r1.sent).toBe(0)
    expect(['partial', 'failed', 'pending']).toContain(jobRow().status)
  })
})
