// lib/__tests__/annual-fee-roi-rpc.test.ts — 单卡/全家庭年费 ROI 聚合 RPC 契约
//（AC-6.1–AC-6.3 + 权限隔离 + 防双算 + D1 100 参数上限）。
//
// 真实 SQLite：0043/0044 由 HUB-176 交付，本分支在 beforeEach 里用 PRAGMA table_info
// 幂等补列（不提交迁移文件），保证合入前后都能跑。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setDb } from '../db/client'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import {
  getCardAnnualFeeRoi,
  getCardRecommendations,
  getCardCycleSpendEstimate,
  getFamilyAnnualFeeRoi,
  upsertPromoUsageCashback,
} from '../api/recommendations.server'
import { guardRecommendationScope, MemberScopeError } from '../api/member-scope'
import { RPC_REGISTRY } from '../api/registry'
import { createCardProduct, updateCardProduct } from '../api/admin.server'
import type { OpportunityActor } from '../opportunities/types'
import type { FxRates } from '../fx'

// 汇率必须可控：ROI 的缺汇率降级（AC-6.3）只有在 rates = null 时才可断言。
const fxState = vi.hoisted(() => ({ rates: null as FxRates | null }))
vi.mock('../fx', async importOriginal => {
  const actual = await importOriginal<typeof import('../fx')>()
  return { ...actual, fetchRates: async () => fxState.rates }
})

const ADMIN: OpportunityActor = { user_id: 'u-admin', role: 'admin' }
const MEMBER: OpportunityActor = { user_id: 'u-member', role: 'member' }

/**
 * 幂等补齐 0043/0044 新增列（仅测试环境；生产由 HUB-176 的迁移文件负责）。
 * 用 PRAGMA table_info 判断，重复执行不报错。
 */
function ensureDirection4Columns(db: SqliteD1): void {
  const columnsOf = (table: string) =>
    new Set(
      (db.raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>).map(
        row => row.name
      )
    )

  const productCols = columnsOf('card_products')
  const productAdditions: Array<[string, string]> = [
    ['ftf_rate', 'REAL'],
    ['fx_free_currencies_json', 'TEXT'],
    ['reward_rules_json', 'TEXT'],
    ['annual_fee_cycle_type', 'TEXT'],
    ['annual_fee_waiver_rules_json', 'TEXT'],
    ['rules_updated_at', 'TEXT'],
  ]
  for (const [column, type] of productAdditions) {
    if (!productCols.has(column)) db.exec(`ALTER TABLE card_products ADD COLUMN ${column} ${type}`)
  }

  const cardCols = columnsOf('credit_cards')
  const cardAdditions: Array<[string, string]> = [
    ['annual_fee_cycle_type', 'TEXT'],
    ['next_annual_fee_date', 'TEXT'],
    ['annual_fee_status', 'TEXT'],
    ['waiver_progress_json', 'TEXT'],
    ['actual_fee_paid', 'REAL'],
    ['manual_reward_value', 'REAL'],
  ]
  for (const [column, type] of cardAdditions) {
    if (!cardCols.has(column)) db.exec(`ALTER TABLE credit_cards ADD COLUMN ${column} ${type}`)
  }

  const promoCols = columnsOf('promo_usages')
  for (const [column, type] of [
    ['cashback_amount', 'REAL'],
    ['cashback_currency', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!promoCols.has(column)) db.exec(`ALTER TABLE promo_usages ADD COLUMN ${column} ${type}`)
  }

  const definitionCols = columnsOf('opportunity_definitions')
  for (const [column, type] of [
    ['estimated_unit_value_minor', 'INTEGER'],
    ['estimated_value_currency', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!definitionCols.has(column)) {
      db.exec(`ALTER TABLE opportunity_definitions ADD COLUMN ${column} ${type}`)
    }
  }
  const accountCols = columnsOf('opportunity_accounts')
  for (const [column, type] of [
    ['estimated_unit_value_minor', 'INTEGER'],
    ['estimated_value_currency', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!accountCols.has(column)) {
      db.exec(`ALTER TABLE opportunity_accounts ADD COLUMN ${column} ${type}`)
    }
  }
}

const SEED_SQL = `
INSERT INTO users (id, email, password_hash, name, role) VALUES
  ('u-admin', 'admin@example.test', 'x', '管理员', 'admin'),
  ('u-member', 'member@example.test', 'x', '成员', 'member');

INSERT INTO banks (id, name, country) VALUES
  ('bk-cmb', '招商银行', 'CN'),
  ('bk-chase', 'Chase', 'US');

INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, annual_fee, annual_fee_waiver,
  reward_rules_json, ftf_rate, annual_fee_waiver_rules_json, rules_updated_at) VALUES
  ('p-main', 'bk-cmb', '招商银行', '经典白金卡', 'CNY', 3600, '刷满 6 次免次年',
   '{"schema_version":1,"reward_kind":"points","base_rate_pct":1,"category_rules":[{"category":"dining","rate_pct":4.5}]}',
   1.5, '{"schema_version":1,"waiver_type":"spend_count","target_count":6}', '2026-01-01T00:00:00Z'),
  ('p-promo', 'bk-chase', 'Chase', 'Sapphire', 'USD', 100, NULL, NULL, NULL, NULL, NULL),
  ('p-zero', 'bk-cmb', '招商银行', '免年费卡', 'CNY', 0, NULL, NULL, NULL, NULL, NULL);

INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
  ('h-self', 'u-admin', 'u-admin', '我', NULL),
  ('h-member', 'u-member', 'u-member', '成员本人', 'u-member'),
  ('h-empty', 'u-admin', 'u-admin', '空档案', NULL);

INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day,
  status, card_type, annual_fee_status, next_annual_fee_date, manual_reward_value) VALUES
  ('c-main', 'h-self', 'p-main', '0001', 50000, 5, 'active', 'credit', 'in_progress', '2026-12-01', 0),
  ('c-promo', 'h-self', 'p-promo', '0002', 10000, 5, 'active', 'credit', NULL, NULL, NULL),
  ('c-zero', 'h-self', 'p-zero', '0003', 20000, 5, 'active', 'credit', 'waived', NULL, NULL),
  ('c-manual', 'h-self', 'p-zero', '0004', 20000, 5, 'active', 'credit', 'not_applicable', NULL, 300),
  ('c-frozen', 'h-self', 'p-main', '0005', 50000, 5, 'frozen', 'credit', NULL, NULL, NULL),
  ('c-member', 'h-member', 'p-main', '0006', 20000, 5, 'active', 'credit', NULL, NULL, NULL);

INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES
  ('pr-legacy', 'p-promo', 'bk-chase', 'Chase', '餐饮 5 折', '2026-01-01', '2026-12-31', 1);

INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at) VALUES
  ('d-benefit', 'benefit', 'shared', NULL, 'u-admin', '2026-01-01T00:00:00Z'),
  ('d-promo', 'promo', 'shared', NULL, 'u-admin', '2026-01-01T00:00:00Z');

INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at) VALUES
  ('rv-benefit', 'd-benefit', 1, '2026-01-01',
   '{"schema_version":1,"title":"机场贵宾厅","description":null,"category":"food","time_zone":"Asia/Shanghai","bank_id":null,"card_product_ids":[],"valid_from":null,"valid_until_before":null,"open_ended":true,"weekdays":null,"cycle":{"kind":"annual","anchor_month":null,"anchor_day":null,"anchor_source":null},"allocation":"recurring","count_limit":null,"amount_limit_minor":null,"currency":null,"unit_label":"次","eligibility_text":null,"requires_personal_confirmation":false,"claim_window":null,"booking_window":null,"workflow_time_basis":"fixed","booking_consumes":"reserve_then_use","cancellation_rule":"confirm_with_issuer","entry":{"website_url":null,"app_name":null,"app_path":null}}',
   'unverified', '2026-01-01T00:00:00Z'),
  ('rv-promo', 'd-promo', 1, '2026-01-01',
   '{"schema_version":1,"title":"餐饮 5 折","description":null,"category":"food","time_zone":"Asia/Shanghai","bank_id":null,"card_product_ids":[],"valid_from":null,"valid_until_before":null,"open_ended":true,"weekdays":null,"cycle":{"kind":"annual","anchor_month":null,"anchor_day":null,"anchor_source":null},"allocation":"recurring","count_limit":null,"amount_limit_minor":null,"currency":null,"unit_label":"次","eligibility_text":null,"requires_personal_confirmation":false,"claim_window":null,"booking_window":null,"workflow_time_basis":"fixed","booking_consumes":"reserve_then_use","cancellation_rule":"confirm_with_issuer","entry":{"website_url":null,"app_name":null,"app_path":null}}',
   'unverified', '2026-01-01T00:00:00Z');

INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at) VALUES
  ('acc-benefit', 'd-benefit', 'h-self', 'card', 'card:c-main', 'u-admin', '2026-01-01T00:00:00Z'),
  ('acc-promo', 'd-promo', 'h-self', 'card', 'card:c-promo', 'u-admin', '2026-01-01T00:00:00Z');

INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id) VALUES
  ('acc-benefit', 'd-benefit', 'h-self', 'c-main'),
  ('acc-benefit', 'd-benefit', 'h-self', 'c-zero'),
  ('acc-promo', 'd-promo', 'h-self', 'c-promo');

INSERT INTO opportunity_cycles (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
  period_start_on, period_end_before, usable_start_on, usable_end_before, time_zone, count_limit, created_at) VALUES
  ('cyc-benefit', 'acc-benefit', 'rv-benefit', '2026-01-01', '2026', 'regular',
   '2026-01-01', '2027-01-01', '2026-01-01', '2027-01-01', 'Asia/Shanghai', 12, '2026-01-01T00:00:00Z'),
  ('cyc-promo', 'acc-promo', 'rv-promo', '2026-01-01', '2026', 'regular',
   '2026-01-01', '2027-01-01', '2026-01-01', '2027-01-01', 'Asia/Shanghai', 12, '2026-01-01T00:00:00Z');

INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, status,
  revision, created_by, updated_by, created_at, updated_at) VALUES
  ('u-1', 'acc-benefit', 'cyc-benefit', 'c-main', '2026-06-01', 1, 130000, 'active', 1, 'u-admin', 'u-admin', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
  ('u-2', 'acc-benefit', 'cyc-benefit', 'c-main', '2026-07-01', 1, 280000, 'active', 1, 'u-admin', 'u-admin', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('u-3', 'acc-benefit', 'cyc-benefit', 'c-zero', '2026-08-01', 2, 0, 'active', 1, 'u-admin', 'u-admin', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
  ('u-4', 'acc-promo', 'cyc-promo', 'c-promo', '2026-09-01', 1, 50000, 'active', 1, 'u-admin', 'u-admin', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO promo_usages (id, promo_id, card_id, used_at, cashback_amount, cashback_currency) VALUES
  ('pu-legacy', 'pr-legacy', 'c-promo', '2026-09-10', 100, 'USD');

INSERT INTO opportunity_legacy_links (source_table, source_id, target_usage_id, included_in_opening,
  offset_opening_count, offset_opening_minor, assigned_by, reason, assigned_at) VALUES
  ('promo_usages', 'pu-legacy', 'u-4', 0, 0, 0, 'u-admin', 'legacy migration', '2026-10-01T00:00:00Z');

INSERT INTO opportunity_tasks (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json,
  status, revision, created_by, created_at, updated_at) VALUES
  ('task-1', 'h-self', 'annual_fee', '刷满 6 次免次年', '["c-promo"]',
   '{"schema_version":1,"currency":"USD","groups":[{"id":"g1","metrics":[{"id":"m1","kind":"count","target_count":6,"per_txn_min_minor":null}]}],"eligible_spend_notes":null}',
   '{"amount_minor":20000}', 'active', 1, 'u-admin', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT INTO opportunity_task_cycles (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json,
  period_start_on, period_end_before, deadline_at, progress_json, revision, updated_at) VALUES
  ('tc-1', 'task-1', '2026',
   '{"schema_version":1,"currency":"USD","groups":[{"id":"g1","metrics":[{"id":"m1","kind":"count","target_count":6,"per_txn_min_minor":null}]}],"eligible_spend_notes":null}',
   '{"amount_minor":20000}', '2026-01-01', '2027-01-01', '2026-12-31T23:59:59Z', '{}', 1, '2026-01-01T00:00:00Z');

INSERT INTO opportunity_fulfillments (id, holder_id, kind, task_cycle_id, reward_key, source_key, card_id,
  status, quantity, amount_minor, recorded_on, entry_json, revision, created_by, updated_by, created_at, updated_at) VALUES
  ('f-task', 'h-self', 'task_result', 'tc-1', 'reward:task-1', 'task-1:2026', 'c-promo', 'recorded', 1, 20000,
   '2026-10-01', '{}', 1, 'u-admin', 'u-admin', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
`

let db: SqliteD1 | null = null

async function setup(): Promise<SqliteD1> {
  const fresh = createOpportunityDb()
  ensureDirection4Columns(fresh)
  fresh.exec(SEED_SQL)
  setDb(fresh as unknown as D1Database)
  db = fresh
  return fresh
}

beforeEach(async () => {
  fxState.rates = null
  await setup()
})

afterEach(() => {
  setDb(null)
  db?.close()
  db = null
})

describe('annual fee ROI · AC-6.1 正 ROI 核算', () => {
  it('computes cost vs benefit value with exact percentages and a decision tag', async () => {
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-main', { period_mode: 'current_cycle' })
    expect(roi.card_id).toBe('c-main')
    expect(roi.annual_fee_cost).toBe(3600)
    expect(roi.cost_basis).toBe('estimated_nominal')
    expect(roi.redeemed_benefits_value).toBe(4100)
    expect(roi.total_value).toBe(4100)
    expect(roi.net_value).toBe(500)
    expect(roi.coverage_pct).toBe(113.9)
    expect(roi.roi_pct).toBe(13.9)
    expect(roi.decision_tag).toBe('keep_high_roi')
    expect(roi.window_mode_resolved).toBe('exact_cycle')
    expect(roi.item_counts.benefit_usages).toBe(2)
  })

  it('AC-6.2 zero fee never produces Infinity or NaN', async () => {
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-zero', { period_mode: 'current_cycle' })
    expect(roi.annual_fee_cost).toBe(0)
    expect(roi.cost_basis).toBe('waived')
    expect(roi.roi_pct).toBeNull()
    expect(roi.coverage_pct).toBeNull()
    expect(roi.decision_tag).toBe('free_idle')
    expect(roi.unvalued_benefit_count).toBe(2)
    expect(roi.unvalued_benefit_refs[0]).toMatchObject({ account_id: 'acc-benefit', quantity: 2 })
  })

  it('counts a manual reward value on a zero-fee card', async () => {
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-manual', { period_mode: 'current_cycle' })
    expect(roi.manual_reward_value).toBe(300)
    expect(roi.decision_tag).toBe('free_earning')
    expect(roi.roi_pct).toBeNull()
  })
})

describe('annual fee ROI · 防双算与估值降级', () => {
  it('excludes legacy-linked promo usages and counts task_result rewards only', async () => {
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-promo', { period_mode: 'current_cycle' })
    // 500（机会台账 promo 核销）+ 200（task_result 奖励）；legacy promo_usages 100 已迁移不得双算
    expect(roi.promo_and_reward_value).toBe(700)
    expect(roi.item_counts.promo_usages).toBe(1)
    expect(roi.item_counts.task_results).toBe(1)
  })

  it('falls back to estimated unit value when the usage has no amount', async () => {
    // 给 c-zero 的 usage 补上目录级估值：2 次 × 50 元 = 100
    db!.exec(`UPDATE opportunity_definitions SET estimated_unit_value_minor = 5000, estimated_value_currency = 'CNY'
              WHERE id = 'd-benefit'`)
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-zero', { period_mode: 'current_cycle' })
    expect(roi.redeemed_benefits_value).toBe(100)
    expect(roi.unvalued_benefit_count).toBe(0)
    expect(roi.decision_tag).toBe('free_earning')
  })
})

describe('annual fee ROI · 全家庭多币种汇总', () => {
  it('filters the union-window fetch back to each card own cycle window', async () => {
    db!.exec(`UPDATE credit_cards SET next_annual_fee_date = '2026-01-01' WHERE id = 'c-zero'`)
    db!.exec(`
      INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor,
        status, revision, created_by, updated_by, created_at, updated_at) VALUES
        ('u-5', 'acc-benefit', 'cyc-benefit', 'c-zero', '2026-03-01', 1, 10000, 'active', 1,
         'u-admin', 'u-admin', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
    `)
    const board = await getFamilyAnnualFeeRoi(ADMIN, { period_mode: 'current_cycle' })
    const zero = board.cards.find(entry => entry.card_id === 'c-zero')!
    // c-zero 的窗口是 [2025-01-01, 2026-01-01)：并集取数会带回 2026-03-01 那条，必须被过滤掉
    expect(zero.redeemed_benefits_value).toBe(0)
    expect(zero.window_mode_resolved).toBe('exact_cycle')
    const main = board.cards.find(entry => entry.card_id === 'c-main')!
    expect(main.redeemed_benefits_value).toBe(4100)
  })

  it('AC-6.3 keeps unconverted currencies out of the family total', async () => {
    const board = await getFamilyAnnualFeeRoi(ADMIN, {
      period_mode: 'year',
      year: 2026,
      display_currency: 'CNY',
    })
    expect(board.cards).toHaveLength(5)
    expect(board.unconverted_currencies).toEqual(['USD'])
    expect(board.warnings.join(' ')).toContain('未含汇率')
    // CNY 卡成本：c-main 3600 + c-frozen 3600 = 7200；收益：4100 + 300（手动补录）= 4400
    expect(board.totals.annual_fee_cost.total).toBe(7200)
    expect(board.totals.total_value.total).toBe(4400)
    expect(board.totals.annual_fee_cost.by_currency.USD).toBe(100)
  })

  it('returns an empty board without throwing when the family has no cards', async () => {
    const board = await getFamilyAnnualFeeRoi(ADMIN, {
      holder_id: 'h-empty',
      period_mode: 'year',
      year: 2026,
    })
    expect(board.cards).toHaveLength(0)
    expect(board.warnings.join(' ')).toContain('没有可复盘的卡片')
  })
})

describe('annual fee ROI · 权限隔离', () => {
  it('AC-4.1 member cannot read another holder card ROI', async () => {
    await expect(getCardAnnualFeeRoi(MEMBER, 'c-main')).rejects.toThrow()
    await expect(getCardAnnualFeeRoi(MEMBER, 'c-member', { period_mode: 'year', year: 2026 })).resolves.toBeTruthy()
  })

  it('AC-4.1 guardRecommendationScope rejects "all" and foreign holder ids', async () => {
    const ctx = { userId: 'u-member', role: 'member' as const, holderIds: ['h-member'] }
    await expect(guardRecommendationScope([{ amount: 100, holder_id: 'all' }], ctx)).rejects.toBeInstanceOf(
      MemberScopeError
    )
    await expect(
      guardRecommendationScope([{ amount: 100, holder_id: 'h-self' }], ctx)
    ).rejects.toBeInstanceOf(MemberScopeError)
    await expect(
      guardRecommendationScope([{ amount: 100, holder_id: 'h-member' }], ctx)
    ).resolves.toBeUndefined()
  })

  it('keeps the member-scoped registry entries guarded', () => {
    expect(RPC_REGISTRY.recommendations.getCardRecommendations.prependActor).toBe(true)
    expect(RPC_REGISTRY.recommendations.getCardRecommendations.memberGuard).toBeDefined()
    expect(RPC_REGISTRY.recommendations.getFamilyAnnualFeeRoi.memberGuard).toBeDefined()
    expect(RPC_REGISTRY.recommendations.getCardAnnualFeeRoi.memberGuard).toBeDefined()
    expect(RPC_REGISTRY.admin.previewCardProductRules.admin).toBe(true)
  })
})

describe('recommendations · 消费前 Top 3 推荐（DB 端到端）', () => {
  it('returns Top 3 with explainable breakdown and excludes frozen cards', async () => {
    const result = await getCardRecommendations(ADMIN, {
      amount: 1000,
      currency: 'CNY',
      category: 'dining',
      purchase_date: '2026-11-10',
    })
    expect(result.top_recommendations).toHaveLength(3)
    expect(result.top_recommendations[0].card_id).toBe('c-main')
    expect(result.top_recommendations[0].score_breakdown[0].factor).toBe('reward')
    expect(result.excluded_cards.map(item => item.card_id)).toContain('c-frozen')
    expect(result.empty_reason).toBeNull()
  })

  it('scoping by holder_id only returns that holder', async () => {
    const result = await getCardRecommendations(MEMBER, {
      amount: 100,
      currency: 'CNY',
      holder_id: 'h-member',
      purchase_date: '2026-11-10',
    })
    expect(result.top_recommendations.map(item => item.card_id)).toEqual(['c-member'])
    // 管理员只看自己名下（created_by / managed_by）的持卡人，成员的卡不可见
    const adminView = await getCardRecommendations(ADMIN, {
      amount: 100,
      currency: 'CNY',
      holder_id: 'h-member',
      purchase_date: '2026-11-10',
    })
    expect(adminView.top_recommendations).toHaveLength(0)
  })

  it('rejects an invalid input with a clear message', async () => {
    await expect(
      getCardRecommendations(ADMIN, { amount: -5, currency: 'CNY' })
    ).rejects.toThrow(/amount/)
  })
})

describe('recommendations · 辅助接口', () => {
  it('estimates cycle spend from bill_items', async () => {
    db!.exec(`
      INSERT INTO bills (id, card_id, bill_month, statement_date, bill_amount, due_date, status) VALUES
        ('b-1', 'c-main', '2026-09', '2026-09-05', 800, '2026-09-25', 'paid');
      INSERT INTO bill_items (id, bill_id, card_id, description, amount, currency, created_at) VALUES
        ('bi-1', 'b-1', 'c-main', '餐饮', 500, 'CNY', '2026-09-01 12:00:00'),
        ('bi-2', 'b-1', 'c-main', '超市', 300, 'CNY', '2026-09-02 12:00:00');
    `)
    const estimate = await getCardCycleSpendEstimate(ADMIN, 'c-main')
    expect(estimate.source).toBe('bill_items')
    expect(estimate.spend_amount).toBe(800)
    expect(estimate.spend_count).toBe(2)
  })

  it('upserts a promo usage cashback row for ROI', async () => {
    const created = await upsertPromoUsageCashback(ADMIN, {
      promo_id: 'pr-legacy',
      card_id: 'c-promo',
      used_at: '2026-10-05',
      cashback_amount: 88,
      cashback_currency: 'USD',
    })
    expect(created.usage_id).toBeTruthy()
    const roi = await getCardAnnualFeeRoi(ADMIN, 'c-promo', { period_mode: 'year', year: 2026 })
    expect(roi.promo_and_reward_value).toBe(788)
  })
})

describe('annual fee ROI · D1 参数上限', () => {
  it('aggregates more than 80 cards without hitting the 100-bind limit', async () => {
    const statements: string[] = []
    for (let index = 0; index < 90; index += 1) {
      statements.push(
        `INSERT INTO credit_cards (id, holder_id, card_product_id, credit_limit, billing_day, status, card_type)
         VALUES ('c-bulk-${index}', 'h-self', 'p-zero', 1000, 5, 'active', 'credit')`
      )
    }
    db!.exec(statements.join(';'))
    const board = await getFamilyAnnualFeeRoi(ADMIN, { period_mode: 'year', year: 2026 })
    expect(board.cards.length).toBeGreaterThanOrEqual(90)
  })
})

describe('admin · 卡产品结构化规则编辑（admin-only）', () => {
  it('validates and persists structured rules with rules_updated_at', async () => {
    const created = await createCardProduct({
      bank_name: '招商银行',
      card_name: '测试白金卡',
      currency: 'CNY',
      ftf_rate: 1.5,
      reward_rules_json: JSON.stringify({
        schema_version: 1,
        reward_kind: 'cashback',
        base_rate_pct: 1,
        category_rules: [{ category: 'dining', rate_pct: 4.5 }],
      }),
      annual_fee_waiver_rules_json: JSON.stringify({
        schema_version: 1,
        waiver_type: 'spend_amount',
        target_amount: 20000,
      }),
      is_active: true,
    })
    const row = created as unknown as Record<string, unknown>
    expect(row.ftf_rate).toBe(1.5)
    expect(row.rules_updated_at).toBeTruthy()
    expect(JSON.parse(row.reward_rules_json as string).category_rules[0].rate_pct).toBe(4.5)
    expect(JSON.parse(row.annual_fee_waiver_rules_json as string).waiver_type).toBe('spend_amount')
  })

  it('rejects invalid rules and out-of-range FTF before touching the database', async () => {
    await expect(
      createCardProduct({
        bank_name: '招商银行',
        card_name: '非法规则卡',
        currency: 'CNY',
        reward_rules_json: JSON.stringify({
          schema_version: 1,
          reward_kind: 'cashback',
          base_rate_pct: -1,
          category_rules: [],
        }),
      })
    ).rejects.toThrow(/base_rate_pct/)
    await expect(updateCardProduct('p-main', { ftf_rate: 99 })).rejects.toThrow(/外币手续费率/)
    await expect(
      updateCardProduct('p-main', { annual_fee_waiver_rules_json: '{"schema_version":1,"waiver_type":"nope"}' })
    ).rejects.toThrow(/waiver_type/)
    const rows = db!.raw.prepare("SELECT ftf_rate FROM card_products WHERE id = 'p-main'").all()
    expect((rows[0] as { ftf_rate: number }).ftf_rate).toBe(1.5)
  })

  it('keeps the AI draft RPC admin-only', () => {
    expect(RPC_REGISTRY.admin.previewCardProductRules.admin).toBe(true)
    expect(RPC_REGISTRY.admin.previewCardProductRules.memberGuard).toBeUndefined()
  })
})
