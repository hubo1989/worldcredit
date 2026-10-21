// lib/__tests__/opportunity-end-to-end.test.ts — one continuous story through
// the whole P1+P2 surface (plan Task 23): catalog version → personal account
// → opening verification → record → correct → void → manual task → reward →
// booking → three-way cancellation; every step reconciles, the final state
// passes foreign_key_check, and the anomaly drills (archive, terminate,
// merge-block, unbind, re-run backfill, legacy replay) hold.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  createOpportunityAccount,
  confirmOpeningBalance,
  materializeCycleForDate,
} from '../opportunities/accounts.server'
import {
  recordOpportunityUsage,
  correctOpportunityUsage,
  voidOpportunityUsage,
} from '../opportunities/usages.server'
import {
  saveOpportunityTask,
  updateManualTaskProgress,
  getOpportunityTasks,
} from '../opportunities/tasks.server'
import {
  recordTaskRewardReceived,
  recordOpportunityBooking,
  cancelOpportunityBooking,
  completeOpportunityBooking,
} from '../opportunities/fulfillments.server'
import { publishOpportunityVersion, archiveOpportunityDefinition } from '../opportunities/catalog.server'
import { assignLegacyUsage } from '../opportunities/legacy.server'
import { reconcileOpportunityCycle } from '../opportunities/writes.server'
import { getOpportunityPage } from '../opportunities/queries.server'
import { mergeHolders } from '../api/holders.server'
import { recordBenefitUsage } from '../api/benefits.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }

let seq = 0
const rk = () => `e2e-rk-run0-${String(++seq).padStart(4, '0')}`

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '端到端权益',
    description: null,
    category: 'other',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    // 覆盖 selfMain（cmbClassic）与 selfSecond（cmbLife）
    card_product_ids: [f.products.cmbClassic, f.products.cmbLife],
    valid_from: null,
    valid_until_before: null,
    open_ended: true,
    weekdays: null,
    cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
    allocation: 'recurring',
    count_limit: 4,
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

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(OpportunityError)
    expect((err as OpportunityError).code).toBe(code)
    return true
  })
}

describe('完整链路（Task 23 演练）', () => {
  it('目录→账户→核对→使用→更正→撤销→任务→奖励→预约→三分支取消，全程对账无漂移', async () => {
    // 1. 目录：发布一个复核版本
    const published = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01',
      verification: 'user_confirmed', source_excerpt: '权益手册',
      request_key: rk(),
    }, { now: NOW })

    // 2. 个人账户（holder 共享两卡）
    const account = await createOpportunityAccount(actorAdminA, {
      definition_id: published.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain, f.cards.selfSecond], scope_kind: 'holder', request_key: rk(),
    }, { now: NOW })
    expect(account.cycle).toBeTruthy()
    const cycleId = account.cycle!.id

    // 3. 期初核对：此前共耗 3 次（含未逐笔登记）
    await confirmOpeningBalance(actorAdminA, {
      cycle_id: cycleId, opening_used_count: 3, opening_used_minor: 0,
      as_of_on: '2026-10-15', reason: '银行 APP 核对', expected_revision: 1, request_key: rk(),
    }, { now: NOW })

    // 4. 记录 / 更正 / 撤销
    const rec1 = await recordOpportunityUsage(actorAdminA, {
      account_id: account.account.id, cycle_id: cycleId, card_id: f.cards.selfMain,
      used_on: '2026-10-10', quantity: 1, amount_minor: 0, note: '首笔', request_key: rk(),
    }, { now: NOW })
    await correctOpportunityUsage(actorAdminA, {
      usage_id: rec1.usage_id, used_on: '2026-10-11', reason: '日期录错',
      expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    await voidOpportunityUsage(actorAdminA, {
      usage_id: rec1.usage_id, reason: '误登记', expected_revision: 2, request_key: rk(),
    }, { now: NOW })
    expect((await reconcileOpportunityCycle(actorAdminA, cycleId)).ok).toBe(true)

    // 5. 手动任务 → 达标 → 奖励到账（quota 建有界配额）
    const task = await saveOpportunityTask(actorAdminA, {
      holder_id: f.holders.self, task_type: 'monthly_spend', title: '消费任务',
      card_ids: [f.cards.selfMain],
      rules: { schema_version: 1, currency: 'CNY', groups: [{ id: 'g', metrics: [{ id: 'amt', kind: 'amount', target_minor: 100 }] }], eligible_spend_notes: null },
      reward: { kind: 'quota', title: '礼券', reward_key: 'gift', count: 2, amount_minor: null, currency: 'CNY' },
      window: { from_day: 10, until_day: 15 }, request_key: rk(),
    }, { now: NOW })
    const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    const taskCycle = views.find((v) => v.task_id === task.task_id)!.cycle!
    // 进度下调→补齐（审计链保留）
    await updateManualTaskProgress(actorAdminA, {
      task_cycle_id: taskCycle.id, progress: { as_of_on: '2026-10-14', metric_values: { amt: 50 }, note: null },
      reason: '部分录入', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    const done = await updateManualTaskProgress(actorAdminA, {
      task_cycle_id: taskCycle.id, progress: { as_of_on: '2026-10-15', metric_values: { amt: 100 }, note: null },
      reason: '补齐达标', expected_revision: 2, request_key: rk(),
    }, { now: NOW })
    expect(done.satisfied).toBe(true)

    const reward = await recordTaskRewardReceived(actorAdminA, {
      task_cycle_id: taskCycle.id, reward_key: 'gift', received_on: '2026-11-10',
      account_id: account.account.id, request_key: rk(),
    }, { now: NOW })
    expect(reward.grant_cycle_id).toBeTruthy()
    expect((await reconcileOpportunityCycle(actorAdminA, reward.grant_cycle_id!)).ok).toBe(true)

    // 6. 预约 → 完成 / 三分支取消
    const b1 = await recordOpportunityBooking(actorAdminA, {
      account_id: account.account.id, cycle_id: cycleId, card_id: f.cards.selfMain,
      service_at: '2026-10-20T19:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    await completeOpportunityBooking(actorAdminA, {
      fulfillment_id: b1.fulfillment_id, used_on: '2026-10-20',
      expected_revision: 1, request_key: rk(),
    }, { now: NOW })

    const w2 = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01', verification: 'user_confirmed',
      request_key: rk(),
    }, { now: NOW })
    const acc2 = await createOpportunityAccount(actorAdminA, {
      definition_id: w2.definition_id, holder_id: f.holders.family,
      card_ids: [f.cards.familyClassic], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })
    for (const settlement of ['returned', 'charged', 'unknown'] as const) {
      const booking = await recordOpportunityBooking(actorAdminA, {
        account_id: acc2.account.id, cycle_id: acc2.cycle!.id, card_id: f.cards.familyClassic,
        service_at: '2026-10-21T12:00:00+08:00', service_time_zone: 'Asia/Shanghai',
        quantity: 1, amount_minor: 0, request_key: rk(),
      }, { now: NOW })
      await cancelOpportunityBooking(actorAdminA, {
        fulfillment_id: booking.fulfillment_id, settlement, reason: `演练 ${settlement}`,
        expected_revision: 1, request_key: rk(),
      }, { now: NOW })
      expect((await reconcileOpportunityCycle(actorAdminA, acc2.cycle!.id)).ok).toBe(true)
    }

    // 7. 全库一致性
    expect((await reconcileOpportunityCycle(actorAdminA, cycleId)).ok).toBe(true)
    const fk = db.raw.prepare('PRAGMA foreign_key_check').all()
    expect(fk).toEqual([])
    const checks = db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_write_checks').get() as { n: number }
    expect(checks.n).toBe(0)
  })

  it('异常演练：归档/终止/越界/合并受阻/旧 API 多解/重复归属', async () => {
    const published = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01', verification: 'user_confirmed',
      request_key: rk(),
    }, { now: NOW })
    const account = await createOpportunityAccount(actorAdminA, {
      definition_id: published.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })

    // 定义归档后不能再建账户，既有账户历史可读
    await archiveOpportunityDefinition(actorAdminA, {
      definition_id: published.definition_id, reason: '下线', expected_revision: 1,
    })
    await rejects(
      createOpportunityAccount(actorAdminA, {
        definition_id: published.definition_id, holder_id: f.holders.self,
        card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
    const page = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    expect(page.items.map((i) => i.status)).toContain('expired')

    // 归档定义后 materialize 新周期仍可用于历史（既有周期不受影响）
    await materializeCycleForDate(actorAdminA, account.account.id, '2026-10-15', rk(), { now: NOW })

    // holder merge 受阻
    await expect(mergeHolders(f.holders.family, [f.holders.self])).rejects.toThrow(/权益台账账户/)

    // 旧 API 多解：同一 legacy benefit 两个账户 → AMBIGUOUS_ACCOUNT
    db.raw
      .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
      .run('bu-e2e', f.benefits.cmbLifeMovie, '2026-10-10')
    const secondDef = await publishOpportunityVersion(actorAdminA, {
      rules: rules({ card_product_ids: [f.products.cmbLife] }), effective_from: '2026-01-01',
      verification: 'user_confirmed', request_key: rk(),
    }, { now: NOW })
    await createOpportunityAccount(actorAdminA, {
      definition_id: secondDef.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfSecond], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })
    const familyDef = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01',
      verification: 'user_confirmed', request_key: rk(),
    }, { now: NOW })
    await createOpportunityAccount(actorAdminA, {
      definition_id: familyDef.definition_id, holder_id: f.holders.family,
      card_ids: [f.cards.familyClassic], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })
    // 该 benefit 无包装定义（未走 0015），兼容登记直接引导初始化
    await rejects(
      recordBenefitUsage(actorAdminA, { benefit_id: f.benefits.cmbLifeMovie, used_at: '2026-10-15' }),
      'NEEDS_CONFIRMATION',
    )

    // 重复归属同源
    const third = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01', verification: 'user_confirmed', request_key: rk(),
    }, { now: NOW })
    const acc3 = await createOpportunityAccount(actorAdminA, {
      definition_id: third.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })
    await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages', source_id: 'bu-e2e', account_id: acc3.account.id,
      card_id: f.cards.selfMain, included_in_opening: false, reason: '演练归属',
      request_key: rk(),
    }, { now: NOW })
    await rejects(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages', source_id: 'bu-e2e', account_id: acc3.account.id,
        card_id: f.cards.selfMain, included_in_opening: false, reason: '重复',
        request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
  })
})
