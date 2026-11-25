// lib/__tests__/recommendation-engine.test.ts — 可解释用卡推荐引擎的纯函数契约
//（AC-1.1–AC-3.2 + 6 级决胜 + 模式权重）。零 DB，直接构造快照喂给
// rankCardsForPurchase，断言每一分的来源而不是只看排序。

import { describe, it, expect } from 'vitest'
import { rankCardsForPurchase, scoreCardForPurchase } from '../recommendations/engine'
import {
  computeProductRuleCompleteness,
  matchRewardRule,
  parseAnnualFeeWaiverRules,
  parseRewardRules,
  validateRewardRulesInput,
  type RewardRuleMatch,
} from '../recommendations/rules'
import type {
  RecommendationCardSnapshot,
  RecommendationEngineInput,
} from '../recommendations/types'
import type { FxRates } from '../fx'

const CNY_RATES: FxRates = {
  base: 'USD',
  rates: { USD: 1, CNY: 7.2, HKD: 7.8 },
  timestamp: 0,
  fetched_at: Date.now(),
}

function product(overrides: Partial<NonNullable<RecommendationCardSnapshot['product']>> = {}) {
  return {
    currency: 'CNY',
    payment_due_type: 'after_billing' as const,
    payment_due_value: 20,
    annual_fee: 3600,
    annual_fee_waiver: null,
    rewards_summary: '餐饮 3 倍积分',
    ftf_rate: null,
    fx_free_currencies_json: null,
    reward_rules_json: null,
    annual_fee_cycle_type: null,
    annual_fee_waiver_rules_json: null,
    ...overrides,
  }
}

function card(overrides: Partial<RecommendationCardSnapshot> & { id: string }): RecommendationCardSnapshot {
  return {
    holder_id: 'h-self',
    holder_name: '我',
    card_currency: 'CNY',
    status: 'active',
    card_type: 'credit',
    billing_day: 5,
    override_billing_day: null,
    override_due_type: null,
    override_due_value: null,
    credit_limit: 50000,
    credit_limit_override: null,
    annual_fee_override: null,
    annual_fee_status: null,
    waiver_progress_json: null,
    next_annual_fee_date: null,
    bank_name: '招商银行',
    card_name: '经典白金卡',
    card_number_last4: '0001',
    is_shared_quota: false,
    pool_limit: null,
    pool_unpaid_total: 0,
    card_unpaid_total: 0,
    product: product(),
    tasks: [],
    opportunities: [],
    promos: [],
    ...overrides,
  }
}

function input(overrides: Partial<RecommendationEngineInput> = {}): RecommendationEngineInput {
  return {
    amount: 1000,
    currency: 'CNY',
    category: 'dining',
    merchant_keyword: null,
    purchase_date: '2026-11-10',
    optimize_for: 'balanced',
    display_currency: null,
    cards: [],
    rates: CNY_RATES,
    ...overrides,
  }
}

function byScore(item: { score_breakdown: Array<{ factor: string; score: number }> }, factor: string) {
  return item.score_breakdown.find(entry => entry.factor === factor)?.score ?? null
}

describe('recommendation engine · 规则解析', () => {
  it('parses reward rules and rejects dirty JSON', () => {
    const rules = parseRewardRules(
      JSON.stringify({
        schema_version: 1,
        reward_kind: 'points',
        base_rate_pct: 1,
        category_rules: [
          { category: 'dining', rate_pct: 4.5, raw_label: '餐饮 3X 积分' },
          { category: 'not-a-category', rate_pct: 99 },
        ],
      })
    )
    expect(rules?.category_rules).toHaveLength(1)
    expect(rules?.category_rules[0].rate_pct).toBe(4.5)
    expect(parseRewardRules('{broken json')).toBeNull()
    expect(parseRewardRules(JSON.stringify({ schema_version: 2 }))).toBeNull()
  })

  it('computes completeness and matches the highest eligible rate', () => {
    const rules = parseRewardRules(
      JSON.stringify({
        schema_version: 1,
        reward_kind: 'cashback',
        base_rate_pct: 1,
        category_rules: [
          { category: 'dining', rate_pct: 3 },
          { category: 'dining', rate_pct: 4.5, min_txn_amount: 2000 },
        ],
      })
    )
    const belowThreshold = matchRewardRule(rules, 'dining', 1000, 'CNY', 'CNY')
    const aboveThreshold = matchRewardRule(rules, 'dining', 3000, 'CNY', 'CNY')
    expect(belowThreshold.rate_pct).toBe(3)
    expect(aboveThreshold.rate_pct).toBe(4.5)
    expect(
      computeProductRuleCompleteness({
        reward_rules: null,
        ftf_rate: null,
        fx_free_currencies: null,
        annual_fee_cycle_type: null,
        annual_fee_waiver_rules: null,
      })
    ).toBe('none')
  })

  it('validates admin rule input strictly', () => {
    expect(() =>
      validateRewardRulesInput({ schema_version: 1, reward_kind: 'cashback', base_rate_pct: -1, category_rules: [] })
    ).toThrow(/base_rate_pct/)
    const normalized = validateRewardRulesInput({
      schema_version: 1,
      reward_kind: 'cashback',
      base_rate_pct: 1.5,
      category_rules: [{ category: 'travel', rate_pct: 5 }],
    })
    expect(normalized.category_rules[0].currency_scope).toBe('all')
  })

  it('parses annual fee waiver rules with tolerance', () => {
    expect(
      parseAnnualFeeWaiverRules(
        JSON.stringify({ schema_version: 1, waiver_type: 'spend_amount', target_amount: 20000 })
      )?.waiver_type
    ).toBe('spend_amount')
    expect(parseAnnualFeeWaiverRules('{"schema_version":1,"waiver_type":"nope"}')).toBeNull()
  })
})

describe('recommendation engine · 六因子评分', () => {
  it('AC-1.1 category multiplier wins and every point is explained', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [
          card({
            id: 'card-dining',
            product: product({
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'points',
                base_rate_pct: 1,
                category_rules: [{ category: 'dining', rate_pct: 4.5, raw_label: '餐饮 3X 积分' }],
              }),
            }),
          }),
          card({
            id: 'card-base',
            product: product({
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'cashback',
                base_rate_pct: 1.5,
                category_rules: [],
              }),
            }),
          }),
        ],
      })
    )
    expect(result.top_recommendations[0].card_id).toBe('card-dining')
    const winner = result.top_recommendations[0]
    expect(byScore(winner, 'reward')).toBe(4.5)
    expect(byScore(winner, 'ftf')).toBe(0)
    expect(byScore(winner, 'currency_match')).toBe(0.2)
    expect(byScore(winner, 'grace_period')).toBe(0.75)
    expect(winner.total_score).toBe(5.45)
    expect(winner.score_breakdown.map(entry => entry.factor)).toEqual([
      'reward',
      'ftf',
      'currency_match',
      'grace_period',
    ])
    expect(winner.score_breakdown[0].rule_source).toContain('卡产品结构化规则')
  })

  it('AC-1.2 FTF flips a cross-currency ranking', () => {
    const result = rankCardsForPurchase(
      input({
        currency: 'CNY',
        cards: [
          card({
            id: 'card-usd-2pct',
            card_currency: 'USD',
            product: product({
              currency: 'USD',
              ftf_rate: 1.5,
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'cashback',
                base_rate_pct: 2,
                category_rules: [],
              }),
            }),
          }),
          card({
            id: 'card-cny-1.5pct',
            product: product({
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'cashback',
                base_rate_pct: 1.5,
                category_rules: [],
              }),
            }),
          }),
        ],
      })
    )
    expect(result.top_recommendations[0].card_id).toBe('card-cny-1.5pct')
    const usd = result.top_recommendations.find(item => item.card_id === 'card-usd-2pct')!
    expect(byScore(usd, 'ftf')).toBe(-1.5)
    expect(usd.net_rate_pct).toBe(0.5)
    expect(usd.ftf_status).toBe('charged')
  })

  it('AC-1.3 billing-day boundary switches the grace window', () => {
    const graceCard = card({ id: 'card-grace', billing_day: 10 })
    const onBillingDay = scoreCardForPurchase(graceCard, input({ purchase_date: '2026-11-10' }))
    const dayAfter = scoreCardForPurchase(graceCard, input({ purchase_date: '2026-11-11' }))
    expect(onBillingDay.item.grace_days).toBe(20)
    expect(dayAfter.item.grace_days).toBe(49)
    expect(dayAfter.item.grace_days).toBeGreaterThan(onBillingDay.item.grace_days)
  })

  it('AC-1.2 waived currency and unknown FTF degrade explicitly', () => {
    const waived = scoreCardForPurchase(
      card({
        id: 'card-waived',
        product: product({ fx_free_currencies_json: JSON.stringify(['USD']) }),
      }),
      input({ currency: 'USD' })
    )
    expect(waived.item.ftf_status).toBe('waived_currency')
    const unknown = scoreCardForPurchase(
      card({ id: 'card-unknown-ftf', product: product({ ftf_rate: null }) }),
      input({ currency: 'USD' })
    )
    expect(unknown.item.ftf_status).toBe('unknown')
    expect(unknown.item.warnings.join(' ')).toContain('未配置外币手续费')
  })
})

describe('recommendation engine · 任务与免年费加权', () => {
  const waiverTask = {
    source: 'annual_fee_waiver' as const,
    id: 'waiver:annual-fee',
    title: '刷满 20000 免次年',
    currency: 'CNY',
    deadline: '2026-11-30',
    amount_gap: 2000,
    count_gap: null,
    per_txn_min_amount: null,
    task_type: 'annual_fee' as const,
  }

  it('AC-2.1 a near-complete waiver task outranks a flat 2% card', () => {
    const result = rankCardsForPurchase(
      input({
        amount: 2000,
        cards: [
          card({ id: 'card-waiver', tasks: [waiverTask] }),
          card({
            id: 'card-flat',
            product: product({
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'cashback',
                base_rate_pct: 2,
                category_rules: [],
              }),
            }),
          }),
        ],
      })
    )
    expect(result.top_recommendations[0].card_id).toBe('card-waiver')
    expect(byScore(result.top_recommendations[0], 'task_bonus')).toBe(2.8)
  })

  it('AC-2.2 per-transaction threshold blocks the bonus and explains why', () => {
    const result = rankCardsForPurchase(
      input({
        amount: 100,
        cards: [
          card({
            id: 'card-threshold',
            tasks: [{ ...waiverTask, per_txn_min_amount: 200, amount_gap: 2000 }],
          }),
        ],
      })
    )
    expect(byScore(result.top_recommendations[0], 'task_bonus')).toBeNull()
    expect(result.top_recommendations[0].skipped_task_hints.join(' ')).toContain('单笔门槛')
  })

  it('dedupes the card-level waiver and an annual_fee task on the same card', () => {
    const result = rankCardsForPurchase(
      input({
        amount: 2000,
        cards: [
          card({
            id: 'card-double',
            tasks: [
              waiverTask,
              { ...waiverTask, id: 'task-annual-fee', source: 'opportunity_task' },
            ],
          }),
        ],
      })
    )
    // 同卡去重取较高者：两任务同分 2.8，只算一次
    expect(byScore(result.top_recommendations[0], 'task_bonus')).toBe(2.8)
  })

  it('max_reward mode disables the task bonus entirely', () => {
    const result = rankCardsForPurchase(
      input({
        amount: 2000,
        optimize_for: 'max_reward',
        cards: [card({ id: 'card-waiver', tasks: [waiverTask] })],
      })
    )
    expect(byScore(result.top_recommendations[0], 'task_bonus')).toBeNull()
  })
})

describe('recommendation engine · 额度池与边界降级', () => {
  it('AC-2.3 shared pool insufficiency excludes the card with a precise reason', () => {
    const result = rankCardsForPurchase(
      input({
        amount: 1000,
        cards: [
          card({
            id: 'card-pool-a',
            is_shared_quota: true,
            pool_limit: 10000,
            pool_unpaid_total: 9500,
          }),
          card({ id: 'card-single' }),
        ],
      })
    )
    expect(result.top_recommendations.map(item => item.card_id)).toEqual(['card-single'])
    expect(result.excluded_cards[0]).toMatchObject({
      card_id: 'card-pool-a',
      exclude_code: 'shared_pool_insufficient_credit',
    })
    expect(result.excluded_cards[0].reason).toContain('共享额度池')
  })

  it('AC-2.3 frozen and cancelled cards never reach the ranking', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [
          card({ id: 'card-frozen', status: 'frozen' }),
          card({ id: 'card-cancelled', status: 'cancelled' }),
          card({ id: 'card-ok' }),
        ],
      })
    )
    expect(result.top_recommendations.map(item => item.card_id)).toEqual(['card-ok'])
    expect(result.excluded_cards.map(item => item.exclude_code).sort()).toEqual([
      'card_cancelled',
      'card_frozen',
    ])
  })

  it('AC-3.1 all-unconfigured cards fall back to currency + grace ordering', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [
          card({ id: 'card-cny', product: product({ reward_rules_json: null }) }),
          card({
            id: 'card-usd',
            card_currency: 'USD',
            product: product({ currency: 'USD', reward_rules_json: null }),
          }),
        ],
      })
    )
    expect(result.all_cards_unconfigured).toBe(true)
    expect(result.banner_warnings.join(' ')).toContain('保底排序')
    expect(result.top_recommendations[0].card_id).toBe('card-cny')
    expect(result.top_recommendations[0].rule_completeness).toBe('none')
    expect(result.top_recommendations[0].rewards_summary_fallback).toBe('餐饮 3 倍积分')
  })

  it('AC-3.2 unknown credit limit keeps the card ranked with a warning', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [card({ id: 'card-no-limit', credit_limit: 0, credit_limit_override: null })],
      })
    )
    expect(result.top_recommendations[0].credit_check).toBe('unknown_limit')
    expect(result.top_recommendations[0].warnings.join(' ')).toContain('未设置卡片额度')
  })

  it('AC-3.2 missing FX never degrades into a 1:1 conversion', () => {
    const result = rankCardsForPurchase(
      input({
        currency: 'USD',
        rates: null,
        cards: [card({ id: 'card-usd-no-fx' })],
      })
    )
    expect(result.fx_available).toBe(false)
    expect(result.top_recommendations[0].credit_check).toBe('unknown_fx')
    expect(result.top_recommendations[0].warnings.join(' ')).toContain('汇率暂缺')
  })

  it('reports empty reasons instead of an empty list', () => {
    expect(rankCardsForPurchase(input({ cards: [] })).empty_reason).toBe('no_credit_cards')
    const allFrozen = rankCardsForPurchase(
      input({ cards: [card({ id: 'card-frozen', status: 'frozen' })] })
    )
    expect(allFrozen.empty_reason).toBe('all_frozen_or_cancelled')
  })
})

describe('recommendation engine · 确定性决胜', () => {
  it('breaks exact ties by card id deterministically', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [card({ id: 'card-b' }), card({ id: 'card-a' })],
      })
    )
    expect(result.top_recommendations.map(item => item.card_id)).toEqual(['card-a', 'card-b'])
  })

  it('ranks a more complete rule set ahead on a tie', () => {
    const result = rankCardsForPurchase(
      input({
        category: null,
        cards: [
          card({
            id: 'card-complete',
            product: product({
              reward_rules_json: JSON.stringify({
                schema_version: 1,
                reward_kind: 'cashback',
                base_rate_pct: 0,
                category_rules: [{ category: 'other', rate_pct: 0 }],
              }),
            }),
          }),
          card({ id: 'card-none', product: product({ reward_rules_json: null }) }),
        ],
      })
    )
    expect(result.top_recommendations[0].card_id).toBe('card-complete')
  })
})

describe('recommendation engine · 权益机会协同', () => {
  it('adds an expiring-soon opportunity bonus capped at 2.00', () => {
    const result = rankCardsForPurchase(
      input({
        cards: [
          card({
            id: 'card-opp',
            opportunities: [
              {
                id: 'opp-1',
                kind: 'benefit',
                title: '机场贵宾厅',
                status_label: '即将到期（剩 3 天）',
                status: 'expiring_soon',
                category: 'food',
                target_url: '',
              },
              {
                id: 'opp-2',
                kind: 'benefit',
                title: '餐饮 5 折',
                status_label: '即将到期（剩 3 天）',
                status: 'expiring_soon',
                category: 'food',
                target_url: '',
              },
            ],
          }),
        ],
      })
    )
    expect(byScore(result.top_recommendations[0], 'opportunity_bonus')).toBe(2)
    expect(result.top_recommendations[0].matched_opportunities).toHaveLength(2)
  })
})

describe('reward rule matching edge cases', () => {
  const match: RewardRuleMatch = {
    rate_pct: 0,
    raw_label: null,
    matched_rule: null,
    monthly_cap_amount: null,
  }
  it('returns a zero match for missing rules', () => {
    expect(matchRewardRule(null, 'dining', 100, 'CNY', 'CNY')).toEqual(match)
  })
})
