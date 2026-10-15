// lib/__tests__/opportunity-usages.test.ts — recording, correcting, voiding
// and listing usages (plan Task 9, tech spec §7), against real SQLite so
// CHECK/FK/trigger behaviour and batch rollback are the database's:
//   record — validations (card link, eligibility, window, no future date,
//            currency-less amounts, quota), idempotent replay (A05)
//   correct — note-only zero-delta fix, same-cycle delta fix, cross-cycle
//            move, A08 cross-cycle shortage rolling back the whole command
//   void — A09: reversal only on the usage's own cycle, second void refused,
//            same-key replay staying put
//   getUsageHistory — filters, pagination, audit events, scope

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  createOpportunityAccount,
  confirmOpportunityEligibility,
  materializeCycleForDate,
} from '../opportunities/accounts.server'
import {
  recordOpportunityUsage,
  correctOpportunityUsage,
  voidOpportunityUsage,
  getUsageHistory,
} from '../opportunities/usages.server'
import { reconcileOpportunityCycle } from '../opportunities/writes.server'
import { OpportunityError } from '../opportunities/errors'
import type { RuleSnapshotV1, OpportunityActor } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z' // 2026-10-15 in Asia/Shanghai and America/New_York

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

// ---------------------------------------------------------------------------
// World builders (services, not raw SQL — the whole chain stays real)
// ---------------------------------------------------------------------------

function makeRules(overrides: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '经典白金 贵宾厅',
    description: null,
    category: 'travel',
    time_zone: 'Asia/Shanghai',
    bank_id: f.banks.cmb,
    card_product_ids: [f.products.cmbClassic],
    valid_from: null,
    valid_until_before: null,
    open_ended: true,
    weekdays: null,
    cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
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
    ...overrides,
  }
}

let seq = 0
const rk = (tag: string) => `usage-rk-${tag}-${String(++seq).padStart(4, '0')}`

async function seedDefinition(rules: RuleSnapshotV1) {
  const n = ++seq
  const defId = `odef-usage-${n}`
  const versionId = `orv-usage-${n}`
  await db.batch([
    db
      .prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
      )
      .bind(defId, f.users.adminA),
    db
      .prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
      )
      .bind(versionId, defId, JSON.stringify(rules)),
  ])
  return { defId, versionId }
}

interface World {
  accountId: string
  octCycleId: string
}

/** Account over c-self-main with the current (October) cycle materialized. */
async function setupWorld(rules: RuleSnapshotV1 = makeRules()): Promise<World> {
  const { defId } = await seedDefinition(rules)
  const created = await createOpportunityAccount(
    actorAdminA,
    {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: rk('world'),
    },
    { now: NOW },
  )
  if (!created.cycle) throw new Error('setupWorld: no current cycle materialized')
  return { accountId: created.account.id, octCycleId: created.cycle.id }
}

/** The September cycle of the same account (usable 2026-09-01..2026-10-01). */
async function septemberCycle(accountId: string): Promise<string> {
  const cycle = await materializeCycleForDate(actorAdminA, accountId, '2026-09-20', rk('sep'), { now: NOW })
  if (!cycle) throw new Error('septemberCycle: not materialized')
  return cycle.id
}

function cycleRow(cycleId: string) {
  return db.raw
    .prepare(
      'SELECT used_count, used_minor, revision FROM opportunity_cycles WHERE id = ?',
    )
    .get(cycleId) as { used_count: number; used_minor: number; revision: number }
}

function record(accountId: string, cycleId: string, over: Partial<Parameters<typeof recordOpportunityUsage>[1]> = {}) {
  return recordOpportunityUsage(
    actorAdminA,
    {
      account_id: accountId,
      cycle_id: cycleId,
      card_id: f.cards.selfMain,
      used_on: '2026-10-10',
      quantity: 1,
      amount_minor: 0,
      note: null,
      request_key: rk('rec'),
      ...over,
    },
    { now: NOW },
  )
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(OpportunityError)
  await expect(promise).rejects.toMatchObject({ code })
}

// ---------------------------------------------------------------------------
// recordOpportunityUsage
// ---------------------------------------------------------------------------

describe('recordOpportunityUsage', () => {
  it('登记成功写入 usage、事件与投影，返回最新 Balance', async () => {
    const w = await setupWorld(makeRules({ count_limit: 6, amount_limit_minor: 600000, currency: 'CNY' }))
    const res = await record(w.accountId, w.octCycleId, {
      used_on: '2026-10-14',
      quantity: 2,
      amount_minor: 50000,
      request_key: rk('ok'),
    })

    expect(res.status).toBe('active')
    expect(res.revision).toBe(1)
    expect(res.balance).toMatchObject({ cycle_id: w.octCycleId, used_count: 2, used_minor: 50000, revision: 2 })
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 2, used_minor: 50000, revision: 2 })

    const usage = db.raw
      .prepare('SELECT account_id, cycle_id, card_id, used_on, quantity, amount_minor, status, revision FROM opportunity_usages WHERE id = ?')
      .get(res.usage_id) as Record<string, unknown>
    expect(usage).toMatchObject({
      account_id: w.accountId, cycle_id: w.octCycleId, card_id: f.cards.selfMain,
      used_on: '2026-10-14', quantity: 2, amount_minor: 50000, status: 'active', revision: 1,
    })

    const event = db.raw
      .prepare("SELECT delta_used_count, delta_used_minor, event_type FROM opportunity_events WHERE entity_kind = 'usage'")
      .get() as Record<string, unknown>
    expect(event).toEqual({ delta_used_count: 2, delta_used_minor: 50000, event_type: 'usage.recorded' })

    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
  })

  it('A05：同 key 同参数重放首个结果，不重复入账', async () => {
    const w = await setupWorld()
    const input = {
      account_id: w.accountId,
      cycle_id: w.octCycleId,
      card_id: f.cards.selfMain,
      used_on: '2026-10-11',
      quantity: 1,
      amount_minor: 0,
      note: null,
      request_key: rk('replay'),
    }
    const first = await recordOpportunityUsage(actorAdminA, input, { now: NOW })
    const second = await recordOpportunityUsage(actorAdminA, input, { now: NOW })

    expect(second).toEqual(first) // 首个结果原样返回
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get()).toEqual({ n: 1 })
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'").get(),
    ).toEqual({ n: 1 })
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 1, used_minor: 0, revision: 2 })
  })

  it('A05：同 key 换参数报 IDEMPOTENCY_CONFLICT', async () => {
    const w = await setupWorld()
    const key = rk('dup')
    await record(w.accountId, w.octCycleId, { quantity: 1, request_key: key })
    await rejects(
      record(w.accountId, w.octCycleId, { quantity: 3, request_key: key }),
      'IDEMPOTENCY_CONFLICT',
    )
    expect(cycleRow(w.octCycleId).used_count).toBe(1)
  })

  it('未来日期被拒', async () => {
    const w = await setupWorld()
    await rejects(
      record(w.accountId, w.octCycleId, { used_on: '2026-10-16', request_key: rk('future') }),
      'VALIDATION_FAILED',
    )
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get()).toEqual({ n: 0 })
  })

  it('过期周期不能登记今天，但可补记窗口内的过去日期', async () => {
    const w = await setupWorld()
    const sep = await septemberCycle(w.accountId)

    // 已结束的九月周期：补记窗口内过去日期 OK
    await record(w.accountId, sep, { used_on: '2026-09-20', request_key: rk('backfill') })
    expect(cycleRow(sep).used_count).toBe(1)

    // 同一周期不能“今天才用”（今天不在窗口内）
    await rejects(
      record(w.accountId, sep, { used_on: '2026-10-15', request_key: rk('late') }),
      'VALIDATION_FAILED',
    )
    expect(cycleRow(sep).used_count).toBe(1)
  })

  it('早于周期可用开始日的日期被拒', async () => {
    const w = await setupWorld()
    await rejects(
      record(w.accountId, w.octCycleId, { used_on: '2026-09-30', request_key: rk('early') }),
      'VALIDATION_FAILED',
    )
  })

  it('超出次数上限报 QUOTA_EXCEEDED 且无任何残留', async () => {
    const w = await setupWorld()
    for (let i = 1; i <= 6; i++) {
      await record(w.accountId, w.octCycleId, {
        used_on: `2026-10-0${i}`,
        request_key: rk(`fill-${i}`),
      })
    }
    await rejects(
      record(w.accountId, w.octCycleId, { used_on: '2026-10-07', request_key: rk('over') }),
      'QUOTA_EXCEEDED',
    )
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get()).toEqual({ n: 6 })
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'").get(),
    ).toEqual({ n: 6 })
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 6, used_minor: 0, revision: 7 })
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
  })

  it('pending_claim 周期不能直接使用', async () => {
    const w = await setupWorld(makeRules({ allocation: 'claim_gated' }))
    // createOpportunityAccount materializes the claim-gated cycle as pending_claim
    const state = db.raw
      .prepare('SELECT activation_state FROM opportunity_cycles WHERE id = ?')
      .get(w.octCycleId) as { activation_state: string }
    expect(state.activation_state).toBe('pending_claim')

    await rejects(
      record(w.accountId, w.octCycleId, { request_key: rk('claim') }),
      'NEEDS_CONFIRMATION',
    )
  })

  it('资格已确认不可用拒绝登记', async () => {
    const w = await setupWorld()
    await confirmOpportunityEligibility(actorAdminA, {
      account_id: w.accountId,
      eligibility: 'ineligible',
      eligible_from_on: null,
      note: '实测不符合',
      expected_revision: 1,
      request_key: rk('ineligible'),
    }, { now: NOW })
    await rejects(record(w.accountId, w.octCycleId, { request_key: rk('after') }), 'INVALID_TRANSITION')
  })

  it('需个人确认且未确认时报 NEEDS_CONFIRMATION', async () => {
    const w = await setupWorld(makeRules({ requires_personal_confirmation: true }))
    await rejects(record(w.accountId, w.octCycleId, { request_key: rk('confirm-first') }), 'NEEDS_CONFIRMATION')
  })

  it('卡不在账户绑定范围被拒', async () => {
    const w = await setupWorld()
    await rejects(
      record(w.accountId, w.octCycleId, { card_id: f.cards.selfSecond, request_key: rk('card') }),
      'VALIDATION_FAILED',
    )
  })

  it('无币种的按次权益拒绝登记金额', async () => {
    const w = await setupWorld()
    await rejects(
      record(w.accountId, w.octCycleId, { amount_minor: 500, request_key: rk('amount') }),
      'VALIDATION_FAILED',
    )
  })

  it('越权用户不能登记他人账户', async () => {
    const w = await setupWorld()
    await expect(
      recordOpportunityUsage(
        actorAdminB,
        {
          account_id: w.accountId,
          cycle_id: w.octCycleId,
          card_id: f.cards.selfMain,
          used_on: '2026-10-10',
          quantity: 1,
          amount_minor: 0,
          note: null,
          request_key: rk('foreign'),
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' })
  })
})

// ---------------------------------------------------------------------------
// correctOpportunityUsage
// ---------------------------------------------------------------------------

describe('correctOpportunityUsage', () => {
  it('备注更正六维 delta 为 0，只修订 usage', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { quantity: 2, request_key: rk('base') })

    const res = await correctOpportunityUsage(actorAdminA, {
      usage_id: r.usage_id,
      note: '机场 T2 贵宾厅',
      reason: '补充位置备注',
      expected_revision: 1,
      request_key: rk('note'),
    }, { now: NOW })

    expect(res.revision).toBe(2)
    const deltas = db.raw
      .prepare('SELECT delta_opening_count, delta_used_count, delta_used_minor, delta_reserved_count FROM opportunity_events WHERE event_type = ?')
      .get('usage.corrected') as Record<string, number>
    expect(deltas).toEqual({ delta_opening_count: 0, delta_used_count: 0, delta_used_minor: 0, delta_reserved_count: 0 })
    // 六维不变；触发器仍推进 revision
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 2, used_minor: 0, revision: 3 })
    const usage = db.raw
      .prepare('SELECT note, revision FROM opportunity_usages WHERE id = ?')
      .get(r.usage_id) as { note: string; revision: number }
    expect(usage).toEqual({ note: '机场 T2 贵宾厅', revision: 2 })
  })

  it('同期数量更正 2→1，投影同步减 1', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { quantity: 2, request_key: rk('base') })

    await correctOpportunityUsage(actorAdminA, {
      usage_id: r.usage_id,
      quantity: 1,
      reason: '多记了一次',
      expected_revision: 1,
      request_key: rk('qty'),
    }, { now: NOW })

    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 1, used_minor: 0, revision: 3 })
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
  })

  it('陈旧 expected_revision 报 REVISION_CONFLICT', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { request_key: rk('base') })
    await rejects(
      correctOpportunityUsage(actorAdminA, {
        usage_id: r.usage_id,
        note: 'x',
        reason: '并发覆盖',
        expected_revision: 5,
        request_key: rk('stale'),
      }, { now: NOW }),
      'REVISION_CONFLICT',
    )
  })

  it('更正已撤销的 usage 报 INVALID_TRANSITION', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { request_key: rk('base') })
    await voidOpportunityUsage(actorAdminA, {
      usage_id: r.usage_id,
      reason: '记错了',
      expected_revision: 1,
      request_key: rk('void'),
    }, { now: NOW })
    await rejects(
      correctOpportunityUsage(actorAdminA, {
        usage_id: r.usage_id,
        quantity: 1,
        reason: '试图复活',
        expected_revision: 2,
        request_key: rk('revive'),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
  })

  it('跨周期更正成功：旧周期反冲、新周期入账、usage 迁移', async () => {
    const w = await setupWorld()
    const sep = await septemberCycle(w.accountId)
    const r = await record(w.accountId, w.octCycleId, { quantity: 2, request_key: rk('base') })

    const res = await correctOpportunityUsage(actorAdminA, {
      usage_id: r.usage_id,
      cycle_id: sep,
      used_on: '2026-09-15',
      reason: '实际发生在九月',
      expected_revision: 1,
      request_key: rk('move'),
    }, { now: NOW })

    expect(res.cycle_id).toBe(sep)
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 0, used_minor: 0, revision: 3 })
    expect(cycleRow(sep)).toEqual({ used_count: 2, used_minor: 0, revision: 2 })
    const usage = db.raw
      .prepare('SELECT cycle_id, used_on, quantity, revision FROM opportunity_usages WHERE id = ?')
      .get(r.usage_id) as Record<string, unknown>
    expect(usage).toMatchObject({ cycle_id: sep, used_on: '2026-09-15', quantity: 2, revision: 2 })

    const types = (
      db.raw
        .prepare("SELECT event_type FROM opportunity_events WHERE entity_kind = 'usage' ORDER BY rowid")
        .all() as Array<{ event_type: string }>
    ).map((e) => e.event_type)
    expect(types).toEqual(['usage.recorded', 'usage.corrected.reversal', 'usage.corrected.apply'])
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
    expect((await reconcileOpportunityCycle(actorAdminA, sep)).ok).toBe(true)
  })

  it('A08：跨周期目标额度不足，整批回滚原状保留', async () => {
    const w = await setupWorld()
    const sep = await septemberCycle(w.accountId)
    // 九月已用 5/6，只剩 1 个空位
    for (let i = 1; i <= 5; i++) {
      await record(w.accountId, sep, { used_on: `2026-09-0${i}`, request_key: rk(`sep-${i}`) })
    }
    const r = await record(w.accountId, w.octCycleId, { quantity: 2, request_key: rk('oct') })
    const before = {
      oct: cycleRow(w.octCycleId),
      sep: cycleRow(sep),
      events: (db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get() as { n: number }).n,
    }

    await rejects(
      correctOpportunityUsage(actorAdminA, {
        usage_id: r.usage_id,
        cycle_id: sep,
        used_on: '2026-09-15',
        reason: '目标周期装不下 2 次',
        expected_revision: 1,
        request_key: rk('overflow'),
      }, { now: NOW }),
      'QUOTA_EXCEEDED',
    )

    // 原周期、目标周期、usage 行全部原状
    expect(cycleRow(w.octCycleId)).toEqual(before.oct)
    expect(cycleRow(sep)).toEqual(before.sep)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: before.events })
    const usage = db.raw
      .prepare('SELECT cycle_id, quantity, revision, status FROM opportunity_usages WHERE id = ?')
      .get(r.usage_id) as Record<string, unknown>
    expect(usage).toMatchObject({ cycle_id: w.octCycleId, quantity: 2, revision: 1, status: 'active' })
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
    expect((await reconcileOpportunityCycle(actorAdminA, sep)).ok).toBe(true)
  })

  it('更正到未来日期被拒', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { request_key: rk('base') })
    await rejects(
      correctOpportunityUsage(actorAdminA, {
        usage_id: r.usage_id,
        used_on: '2026-10-16',
        reason: '改到明天',
        expected_revision: 1,
        request_key: rk('to-future'),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
  })
})

// ---------------------------------------------------------------------------
// voidOpportunityUsage
// ---------------------------------------------------------------------------

describe('voidOpportunityUsage', () => {
  it('撤销反冲使用所在周期并置 voided', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { quantity: 2, request_key: rk('base') })

    const res = await voidOpportunityUsage(actorAdminA, {
      usage_id: r.usage_id,
      reason: '记错了卡',
      expected_revision: 1,
      request_key: rk('void'),
    }, { now: NOW })

    expect(res).toMatchObject({ status: 'voided', revision: 2 })
    expect(res.balance).toMatchObject({ used_count: 0, revision: 3 })
    expect(cycleRow(w.octCycleId)).toEqual({ used_count: 0, used_minor: 0, revision: 3 })
    const event = db.raw
      .prepare('SELECT delta_used_count, event_type FROM opportunity_events WHERE event_type = ?')
      .get('usage.voided') as Record<string, unknown>
    expect(event).toEqual({ delta_used_count: -2, event_type: 'usage.voided' })
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
  })

  it('A09：二次撤销不二次返还；旧周期撤销不给当前周期加额度', async () => {
    const w = await setupWorld()
    const sep = await septemberCycle(w.accountId)
    // 九月满额（6/6），十月已用 1
    let firstSepUsage = ''
    for (let i = 1; i <= 6; i++) {
      const r = await record(w.accountId, sep, { used_on: `2026-09-0${i}`, request_key: rk(`sep-${i}`) })
      if (i === 1) firstSepUsage = r.usage_id
    }
    await record(w.accountId, w.octCycleId, { used_on: '2026-10-10', request_key: rk('oct') })
    const octBefore = cycleRow(w.octCycleId)

    const voidSepKey = rk('void-sep')
    const res = await voidOpportunityUsage(actorAdminA, {
      usage_id: firstSepUsage,
      reason: '九月那笔实际没消费',
      expected_revision: 1,
      request_key: voidSepKey,
    }, { now: NOW })
    expect(res.balance.used_count).toBe(5)

    // 旧周期返还 1；当前周期的用量与 revision 完全不动
    expect(cycleRow(sep)).toEqual({ used_count: 5, used_minor: 0, revision: 8 })
    expect(cycleRow(w.octCycleId)).toEqual(octBefore)

    // 二次撤销（换 key）被拒，不再返还
    await rejects(
      voidOpportunityUsage(actorAdminA, {
        usage_id: firstSepUsage,
        reason: '再撤一次',
        expected_revision: 2,
        request_key: rk('void-again'),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
    expect(cycleRow(sep).used_count).toBe(5)

    // 同 key 重放保持首次结果
    const again = await voidOpportunityUsage(actorAdminA, {
      usage_id: firstSepUsage,
      reason: '九月那笔实际没消费',
      expected_revision: 1,
      request_key: voidSepKey,
    }, { now: NOW })
    expect(again).toEqual(res)
    expect(cycleRow(sep).used_count).toBe(5)
    expect((await reconcileOpportunityCycle(actorAdminA, sep)).ok).toBe(true)
    expect((await reconcileOpportunityCycle(actorAdminA, w.octCycleId)).ok).toBe(true)
  })

  it('陈旧 expected_revision 撤销报 REVISION_CONFLICT', async () => {
    const w = await setupWorld()
    const r = await record(w.accountId, w.octCycleId, { request_key: rk('base') })
    await rejects(
      voidOpportunityUsage(actorAdminA, {
        usage_id: r.usage_id,
        reason: '过期修订号',
        expected_revision: 9,
        request_key: rk('stale'),
      }, { now: NOW }),
      'REVISION_CONFLICT',
    )
    const usage = db.raw
      .prepare('SELECT status, revision FROM opportunity_usages WHERE id = ?')
      .get(r.usage_id) as { status: string; revision: number }
    expect(usage).toEqual({ status: 'active', revision: 1 })
  })
})

// ---------------------------------------------------------------------------
// getUsageHistory
// ---------------------------------------------------------------------------

describe('getUsageHistory', () => {
  async function seededHistoryWorld() {
    const w = await setupWorld()
    const sep = await septemberCycle(w.accountId)
    await record(w.accountId, sep, { used_on: '2026-09-05', request_key: rk('h-sep') })
    await record(w.accountId, w.octCycleId, { used_on: '2026-10-14', request_key: rk('h-1') })
    await record(w.accountId, w.octCycleId, { used_on: '2026-10-12', request_key: rk('h-2') })
    const third = await record(w.accountId, w.octCycleId, { used_on: '2026-10-10', request_key: rk('h-3') })
    await voidOpportunityUsage(actorAdminA, {
      usage_id: third.usage_id,
      reason: '记错',
      expected_revision: 1,
      request_key: rk('h-void'),
    }, { now: NOW })
    return w
  }

  it('按 used_on 倒序返回条目与审计事件', async () => {
    const w = await seededHistoryWorld()
    const page = await getUsageHistory(actorAdminA, { account_id: w.accountId })
    expect(page.items.map((i) => i.used_on)).toEqual(['2026-10-14', '2026-10-12', '2026-10-10', '2026-09-05'])
    expect(page.next_cursor).toBeNull()
    const voided = page.items[2]
    expect(voided.status).toBe('voided')
    expect(voided.events.map((e) => e.event_type)).toEqual(['usage.recorded', 'usage.voided'])
    expect(voided.events[1].delta_used_count).toBe(-1)
    expect(page.items[0].cycle_key).toBeTruthy()
  })

  it('status 与日期范围过滤真实生效', async () => {
    const w = await seededHistoryWorld()
    const activeOnly = await getUsageHistory(actorAdminA, { account_id: w.accountId, status: 'active' })
    expect(activeOnly.items.map((i) => i.status)).toEqual(['active', 'active', 'active'])
    const october = await getUsageHistory(actorAdminA, {
      account_id: w.accountId,
      from_on: '2026-10-01',
      to_before: '2026-11-01',
    })
    expect(october.items.map((i) => i.used_on)).toEqual(['2026-10-14', '2026-10-12', '2026-10-10'])
  })

  it('limit 分页 + next_cursor 续读，跨页不重不漏', async () => {
    const w = await seededHistoryWorld()
    const p1 = await getUsageHistory(actorAdminA, { account_id: w.accountId, limit: 2 })
    expect(p1.items.map((i) => i.used_on)).toEqual(['2026-10-14', '2026-10-12'])
    expect(p1.next_cursor).toBeTruthy()

    const p2 = await getUsageHistory(actorAdminA, { account_id: w.accountId, limit: 2, cursor: p1.next_cursor })
    expect(p2.items.map((i) => i.used_on)).toEqual(['2026-10-10', '2026-09-05'])
    expect(p2.next_cursor).toBeNull()

    const all = [...p1.items, ...p2.items].map((i) => i.id)
    expect(new Set(all).size).toBe(4)

    // 更换过滤条件时 cursor 不能沿用旧位置
    const restart = await getUsageHistory(actorAdminA, {
      account_id: w.accountId,
      status: 'active',
      limit: 2,
      cursor: p1.next_cursor,
    })
    expect(restart.items.map((i) => i.used_on)).toEqual(['2026-10-14', '2026-10-12'])
  })

  it('越权用户不能读取他人使用历史', async () => {
    const w = await seededHistoryWorld()
    await expect(
      getUsageHistory(actorAdminB, { account_id: w.accountId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' })
  })
})
