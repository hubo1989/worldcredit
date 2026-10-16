// lib/__tests__/opportunity-bookings.test.ts — booking reservations,
// completion and settlement (plan Task 20, spec §7.2/§8.2): reserve adds
// reserved only; completion moves reserved→used with a linked usage in ONE
// batch (re-usable but never re-decrementing); cancellation branches
// returned/charged/unknown each land their exact six-dimension deltas; quota
// races reject; generic correct/void refuse booking-derived usages; repeated
// completion with the same revision only succeeds once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import {
  recordOpportunityBooking,
  completeOpportunityBooking,
  cancelOpportunityBooking,
} from '../opportunities/fulfillments.server'
import {
  recordOpportunityUsage,
  correctOpportunityUsage,
  voidOpportunityUsage,
} from '../opportunities/usages.server'
import { reconcileOpportunityCycle } from '../opportunities/writes.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }

let seq = 0
const rk = () => `booking-rk-run-${String(++seq).padStart(4, '0')}`

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '预约验证权益',
    description: null,
    category: 'other',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    card_product_ids: [f.products.cmbClassic],
    valid_from: null,
    valid_until_before: null,
    open_ended: true,
    weekdays: null,
    cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
    allocation: 'recurring',
    count_limit: 2,
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
    ...over,
  }
}

async function seedAccount(ruleSet = rules()) {
  const n = ++seq
  const defId = `odef-bk-${n}`
  const versionId = `orv-bk-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(ruleSet)),
  ])
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
  }, { now: NOW })
  if (!created.cycle) throw new Error('no cycle')
  return { accountId: created.account.id, cycleId: created.cycle.id }
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(OpportunityError)
    expect((err as OpportunityError).code).toBe(code)
    return true
  })
}

function cycleSix(cycleId: string) {
  return db.raw
    .prepare(
      'SELECT used_count, used_minor, reserved_count, reserved_minor FROM opportunity_cycles WHERE id = ?',
    )
    .get(cycleId) as { used_count: number; used_minor: number; reserved_count: number; reserved_minor: number }
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

describe('recordOpportunityBooking', () => {
  it('预约只加 reserved；同 key 重放幂等；超额拒绝', async () => {
    const world = await seedAccount()
    const firstKey = rk()
    const booking = await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, note: '酒店下午茶', request_key: firstKey,
    }, { now: NOW })
    expect(cycleSix(world.cycleId)).toEqual({ used_count: 0, used_minor: 0, reserved_count: 1, reserved_minor: 0 })

    // 同 key 重放返回已提交结果，不重复占用
    const replay = await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, note: '酒店下午茶', request_key: firstKey,
    }, { now: NOW })
    expect(replay.fulfillment_id).toBe(booking.fulfillment_id)
    expect(cycleSix(world.cycleId).reserved_count).toBe(1)
    // 第二个预约把额度（2）占满
    await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-21T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    expect(cycleSix(world.cycleId).reserved_count).toBe(2)
    // 第三个超额
    await rejects(
      recordOpportunityBooking(actorAdminA, {
        account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
        service_at: '2026-10-22T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
        quantity: 1, amount_minor: 0, request_key: rk(),
      }, { now: NOW }),
      'QUOTA_EXCEEDED',
    )
    // 与直接使用抢最后额度：先约满再直接使用 → 拒绝
    await rejects(
      recordOpportunityUsage(actorAdminA, {
        account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
        used_on: '2026-10-15', quantity: 1, amount_minor: 0, note: null, request_key: rk(),
      }, { now: NOW }),
      'QUOTA_EXCEEDED',
    )
  })
})

describe('completeOpportunityBooking', () => {
  it('reserved−q/a 与 used+q/a、usage 与 fulfillment 状态同一 batch；重复完成冲突', async () => {
    const world = await seedAccount()
    const booking = await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 2, amount_minor: 0, request_key: rk(),
    }, { now: NOW })

    const done = await completeOpportunityBooking(actorAdminA, {
      fulfillment_id: booking.fulfillment_id, used_on: '2026-10-20',
      expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(done.status).toBe('used')
    expect(cycleSix(world.cycleId)).toEqual({ used_count: 2, used_minor: 0, reserved_count: 0, reserved_minor: 0 })

    const row = db.raw
      .prepare('SELECT status, usage_id FROM opportunity_fulfillments WHERE id = ?')
      .get(booking.fulfillment_id) as { status: string; usage_id: string }
    expect(row.status).toBe('used')
    expect(row.usage_id).toBe(done.usage_id)

    // 同 revision 二次完成必须失败（状态已 used）
    await rejects(
      completeOpportunityBooking(actorAdminA, {
        fulfillment_id: booking.fulfillment_id, used_on: '2026-10-20',
        expected_revision: 1, request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )

    const recon = await reconcileOpportunityCycle(actorAdminA, world.cycleId)
    expect(recon.ok).toBe(true)
  })

  it('预约产生的 usage 拒绝通用 correct/void（USE_FULFILLMENT_CORRECTION）', async () => {
    const world = await seedAccount()
    const booking = await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    const done = await completeOpportunityBooking(actorAdminA, {
      fulfillment_id: booking.fulfillment_id, used_on: '2026-10-20',
      expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    const usageRow = db.raw
      .prepare('SELECT revision FROM opportunity_usages WHERE id = ?')
      .get(done.usage_id) as { revision: number }

    await rejects(
      voidOpportunityUsage(actorAdminA, {
        usage_id: done.usage_id, reason: '直接撤销', expected_revision: usageRow.revision, request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
    await rejects(
      correctOpportunityUsage(actorAdminA, {
        usage_id: done.usage_id, used_on: '2026-10-19', reason: '直接更正',
        expected_revision: usageRow.revision, request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
  })
})

describe('cancelOpportunityBooking', () => {
  it('returned 只释放原周期；charged 转为已消耗；unknown 保留 reserved 并标 pending', async () => {
    // returned
    const w1 = await seedAccount()
    const b1 = await recordOpportunityBooking(actorAdminA, {
      account_id: w1.accountId, cycle_id: w1.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    const c1 = await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: b1.fulfillment_id, settlement: 'returned',
      reason: '服务商取消退回', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(c1.status).toBe('cancelled')
    expect(cycleSix(w1.cycleId).reserved_count).toBe(0)
    expect(cycleSix(w1.cycleId).used_count).toBe(0)

    // charged
    const w2 = await seedAccount()
    const b2 = await recordOpportunityBooking(actorAdminA, {
      account_id: w2.accountId, cycle_id: w2.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: b2.fulfillment_id, settlement: 'charged',
      reason: '银行扣除取消费用', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(cycleSix(w2.cycleId)).toEqual({ used_count: 1, used_minor: 0, reserved_count: 0, reserved_minor: 0 })

    // unknown → pending_settlement（reserved 保留）
    const w3 = await seedAccount()
    const b3 = await recordOpportunityBooking(actorAdminA, {
      account_id: w3.accountId, cycle_id: w3.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    const c3 = await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: b3.fulfillment_id, settlement: 'unknown',
      reason: '待确认结算', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(c3.status).toBe('pending_settlement')
    expect(cycleSix(w3.cycleId).reserved_count).toBe(1)
    // pending → cancelled（returned）完成结算
    await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: b3.fulfillment_id, settlement: 'returned',
      reason: '确认退回', expected_revision: 2, request_key: rk(),
    }, { now: NOW })
    expect(cycleSix(w3.cycleId).reserved_count).toBe(0)

    // 三选一必填：不默认退回
    await rejects(
      cancelOpportunityBooking(actorAdminA, {
        fulfillment_id: b1.fulfillment_id, settlement: 'bogus' as 'returned',
        reason: 'x', expected_revision: 2, request_key: rk(),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
  })

  it('到期不自动已使用：过期预约保持 recorded 可取消', async () => {
    const world = await seedAccount()
    const booking = await recordOpportunityBooking(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      service_at: '2026-09-01T10:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    // 服务时间已过仍可取消（结算由人确认）
    const cancelled = await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: booking.fulfillment_id, settlement: 'unknown',
      reason: '过期未使用待确认', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(cancelled.status).toBe('pending_settlement')
  })
})
