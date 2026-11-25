// lib/recommendations/rules.ts — 卡产品结构化规则的解析与校验（纯函数）。
//
// 两条铁律：
// 1) 存量 500+ 卡产品目录里没有结构化规则，脏 JSON / 缺字段必须安全降级为 null，
//    绝不让一条坏数据把整个推荐接口打成 500；
// 2) 管理端写入路径（admin.updateCardProduct）必须严格校验，把非法结构挡在库外。

import {
  ANNUAL_FEE_WAIVER_TYPES,
  isRecommendationCategory,
  type AnnualFeeCycleType,
  type AnnualFeeWaiverRuleV1,
  type AnnualFeeWaiverType,
  type CategoryRewardRuleV1,
  type RecommendationCategory,
  type RewardRulesV1,
  type RuleCompleteness,
  type WaiverProgressV1,
} from './types'

const CURRENCY_RE = /^[A-Z]{3}$/

const ANNUAL_FEE_CYCLE_TYPES: readonly AnnualFeeCycleType[] = [
  'none',
  'anniversary_issued',
  'anniversary_activated',
  'calendar_year',
  'custom_date',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ---------------------------------------------------------------------------
// 读取路径：宽容解析（坏数据 → null）
// ---------------------------------------------------------------------------

/** 解析 card_products.reward_rules_json；任何结构问题都返回 null。 */
export function parseRewardRules(raw: string | null | undefined): RewardRulesV1 | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schema_version !== 1) return null
  const baseRate = finiteNonNegative(parsed.base_rate_pct)
  if (baseRate === null) return null
  const rewardKind = parsed.reward_kind
  if (rewardKind !== 'cashback' && rewardKind !== 'points' && rewardKind !== 'miles') return null

  const rawRules = Array.isArray(parsed.category_rules) ? parsed.category_rules : []
  const categoryRules: CategoryRewardRuleV1[] = []
  for (const entry of rawRules) {
    if (!isRecord(entry)) continue
    const category = entry.category
    const rate = finiteNonNegative(entry.rate_pct)
    if (!isRecommendationCategory(category) || rate === null) continue
    categoryRules.push({
      category,
      rate_pct: rate,
      raw_label: nullableString(entry.raw_label),
      points_multiplier: finiteNonNegative(entry.points_multiplier),
      currency_scope: normalizeCurrencyScope(entry.currency_scope) ?? 'all',
      monthly_cap_amount: finiteNonNegative(entry.monthly_cap_amount),
      min_txn_amount: finiteNonNegative(entry.min_txn_amount),
    })
  }

  return {
    schema_version: 1,
    reward_kind: rewardKind,
    point_unit_name: nullableString(parsed.point_unit_name),
    point_value_per_unit: finiteNonNegative(parsed.point_value_per_unit),
    base_rate_pct: baseRate,
    base_raw_label: nullableString(parsed.base_raw_label),
    category_rules: categoryRules,
    notes: nullableString(parsed.notes),
  }
}

function normalizeCurrencyScope(value: unknown): 'all' | 'domestic' | 'foreign' | string[] | null {
  if (value === undefined || value === null) return 'all'
  if (value === 'all' || value === 'domestic' || value === 'foreign') return value
  if (Array.isArray(value)) {
    const codes = value.filter(
      (item): item is string => typeof item === 'string' && CURRENCY_RE.test(item)
    )
    return codes.length > 0 ? codes : null
  }
  return null
}

/** 解析 card_products.fx_free_currencies_json（币种代码数组）。 */
export function parseFxFreeCurrencies(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const codes = parsed.filter(
    (item): item is string => typeof item === 'string' && CURRENCY_RE.test(item)
  )
  return codes.length > 0 ? Array.from(new Set(codes)) : null
}

/** 解析 card_products.annual_fee_waiver_rules_json。 */
export function parseAnnualFeeWaiverRules(
  raw: string | null | undefined
): AnnualFeeWaiverRuleV1 | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schema_version !== 1) return null
  const waiverType = parsed.waiver_type
  if (!ANNUAL_FEE_WAIVER_TYPES.includes(waiverType as AnnualFeeWaiverType)) return null
  const rule: AnnualFeeWaiverRuleV1 = {
    schema_version: 1,
    waiver_type: waiverType as AnnualFeeWaiverType,
    first_year_free: parsed.first_year_free === true,
    target_amount: finiteNonNegative(parsed.target_amount),
    target_currency: nullableString(parsed.target_currency),
    target_count: finiteNonNegative(parsed.target_count),
    per_txn_min_amount: finiteNonNegative(parsed.per_txn_min_amount),
    points_cost: finiteNonNegative(parsed.points_cost),
    notes: nullableString(parsed.notes),
  }
  return rule
}

/** 解析 credit_cards.waiver_progress_json（用户手动维护的免年费进度）。 */
export function parseWaiverProgress(raw: string | null | undefined): WaiverProgressV1 | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schema_version !== 1) return null
  return {
    schema_version: 1,
    cycle_due_date: nullableString(parsed.cycle_due_date),
    amount: finiteNonNegative(parsed.amount) ?? 0,
    count: finiteNonNegative(parsed.count) ?? 0,
    updated_at: nullableString(parsed.updated_at),
    note: nullableString(parsed.note),
  }
}

/** 解析 card_products.annual_fee_cycle_type（非法值回落 null）。 */
export function parseAnnualFeeCycleType(raw: unknown): AnnualFeeCycleType | null {
  return typeof raw === 'string' && (ANNUAL_FEE_CYCLE_TYPES as readonly string[]).includes(raw)
    ? (raw as AnnualFeeCycleType)
    : null
}

/**
 * 规则完整度：complete = 有分类规则或基础返现率；partial = 只有 FTF/免年费模板；
 * none = 完全没有结构化规则（走旧文本兜底）。
 */
export function computeProductRuleCompleteness(input: {
  reward_rules: RewardRulesV1 | null
  ftf_rate: number | null
  fx_free_currencies: string[] | null
  annual_fee_cycle_type: AnnualFeeCycleType | null
  annual_fee_waiver_rules: AnnualFeeWaiverRuleV1 | null
}): RuleCompleteness {
  if (input.reward_rules) {
    return input.reward_rules.category_rules.length > 0 || input.reward_rules.base_rate_pct > 0
      ? 'complete'
      : 'partial'
  }
  if (
    input.ftf_rate !== null ||
    (input.fx_free_currencies && input.fx_free_currencies.length > 0) ||
    input.annual_fee_cycle_type !== null ||
    input.annual_fee_waiver_rules
  ) {
    return 'partial'
  }
  return 'none'
}

// ---------------------------------------------------------------------------
// 命中判定（供引擎使用）
// ---------------------------------------------------------------------------

export interface RewardRuleMatch {
  rate_pct: number
  raw_label: string | null
  matched_rule: CategoryRewardRuleV1 | null
  monthly_cap_amount: number | null
}

function matchesCurrencyScope(
  scope: CategoryRewardRuleV1['currency_scope'],
  purchaseCurrency: string,
  cardCurrency: string
): boolean {
  if (scope === undefined || scope === 'all') return true
  if (scope === 'domestic') return purchaseCurrency === cardCurrency
  if (scope === 'foreign') return purchaseCurrency !== cardCurrency
  return Array.isArray(scope) && scope.includes(purchaseCurrency)
}

/**
 * 命中当前消费的回报规则：先按币种范围与单笔门槛过滤分类规则，取 rate 最高者；
 * 没有命中分类规则时回落 base_rate_pct。
 */
export function matchRewardRule(
  rules: RewardRulesV1 | null,
  category: RecommendationCategory | null,
  amountInCardCurrency: number,
  purchaseCurrency: string,
  cardCurrency: string
): RewardRuleMatch {
  if (!rules) return { rate_pct: 0, raw_label: null, matched_rule: null, monthly_cap_amount: null }

  let best: CategoryRewardRuleV1 | null = null
  for (const rule of rules.category_rules) {
    if (category && rule.category !== category) continue
    if (!category && rules.category_rules.length > 0) {
      // 未指定类目：只在存在通配类目（other）时用它，否则回落基础返现率
      if (rule.category !== 'other') continue
    }
    if (rule.min_txn_amount != null && rule.min_txn_amount > 0 && amountInCardCurrency < rule.min_txn_amount) {
      continue
    }
    if (!matchesCurrencyScope(rule.currency_scope, purchaseCurrency, cardCurrency)) continue
    if (!best || rule.rate_pct > best.rate_pct) best = rule
  }

  if (best) {
    return {
      rate_pct: best.rate_pct,
      raw_label: best.raw_label ?? null,
      matched_rule: best,
      monthly_cap_amount: best.monthly_cap_amount ?? null,
    }
  }
  return {
    rate_pct: rules.base_rate_pct,
    raw_label: rules.base_raw_label ?? null,
    matched_rule: null,
    monthly_cap_amount: null,
  }
}

// ---------------------------------------------------------------------------
// 写入路径：严格校验（管理端保存结构化规则）
// ---------------------------------------------------------------------------

function fail(field: string, message: string): never {
  throw new Error(`规则校验失败（${field}）：${message}`)
}

/** 严格校验并归一化 RewardRulesV1；非法结构直接抛错，绝不落库。 */
export function validateRewardRulesInput(input: unknown): RewardRulesV1 {
  if (!isRecord(input)) fail('reward_rules', '必须是对象')
  if (input.schema_version !== 1) fail('reward_rules.schema_version', '必须是 1')
  if (!['cashback', 'points', 'miles'].includes(input.reward_kind as string)) {
    fail('reward_rules.reward_kind', '必须是 cashback / points / miles')
  }
  const baseRate = input.base_rate_pct
  if (typeof baseRate !== 'number' || !Number.isFinite(baseRate) || baseRate < 0) {
    fail('reward_rules.base_rate_pct', '必须是 >= 0 的数字')
  }
  const rawRules = Array.isArray(input.category_rules) ? input.category_rules : []
  const categoryRules: CategoryRewardRuleV1[] = []
  for (const [index, entry] of rawRules.entries()) {
    if (!isRecord(entry)) fail(`reward_rules.category_rules.${index}`, '必须是对象')
    if (!isRecommendationCategory(entry.category)) {
      fail(`reward_rules.category_rules.${index}.category`, '非法消费类目')
    }
    const rate = entry.rate_pct
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
      fail(`reward_rules.category_rules.${index}.rate_pct`, '必须是 >= 0 的数字')
    }
    const scope = normalizeCurrencyScope(entry.currency_scope)
    if (scope === null) {
      fail(`reward_rules.category_rules.${index}.currency_scope`, '币种范围不合法')
    }
    categoryRules.push({
      category: entry.category,
      rate_pct: rate,
      raw_label: nullableString(entry.raw_label),
      points_multiplier: finiteNonNegative(entry.points_multiplier),
      currency_scope: scope ?? 'all',
      monthly_cap_amount: finiteNonNegative(entry.monthly_cap_amount),
      min_txn_amount: finiteNonNegative(entry.min_txn_amount),
    })
  }

  return {
    schema_version: 1,
    reward_kind: input.reward_kind as RewardRulesV1['reward_kind'],
    point_unit_name: nullableString(input.point_unit_name),
    point_value_per_unit: finiteNonNegative(input.point_value_per_unit),
    base_rate_pct: baseRate,
    base_raw_label: nullableString(input.base_raw_label),
    category_rules: categoryRules,
    notes: nullableString(input.notes),
  }
}

/** 严格校验并归一化 AnnualFeeWaiverRuleV1。 */
export function validateAnnualFeeWaiverRulesInput(input: unknown): AnnualFeeWaiverRuleV1 {
  if (!isRecord(input)) fail('annual_fee_waiver_rules', '必须是对象')
  if (input.schema_version !== 1) fail('annual_fee_waiver_rules.schema_version', '必须是 1')
  const waiverType = input.waiver_type as AnnualFeeWaiverType
  if (!ANNUAL_FEE_WAIVER_TYPES.includes(waiverType)) {
    fail('annual_fee_waiver_rules.waiver_type', '非法免年费类型')
  }
  if (waiverType !== 'none' && waiverType !== 'first_year_free' && waiverType !== 'points_redeem') {
    if (input.target_amount == null && input.target_count == null) {
      fail('annual_fee_waiver_rules', '消费满额/满笔免年费必须填写 target_amount 或 target_count')
    }
  }
  return {
    schema_version: 1,
    waiver_type: waiverType,
    first_year_free: input.first_year_free === true,
    target_amount: finiteNonNegative(input.target_amount),
    target_currency: nullableString(input.target_currency),
    target_count: finiteNonNegative(input.target_count),
    per_txn_min_amount: finiteNonNegative(input.per_txn_min_amount),
    points_cost: finiteNonNegative(input.points_cost),
    notes: nullableString(input.notes),
  }
}

/** 把币种数组序列化为 fx_free_currencies_json；空数组归一为 null（表示未配置）。 */
export function serializeFxFreeCurrencies(currencies: string[] | null | undefined): string | null {
  if (!currencies || currencies.length === 0) return null
  const codes = Array.from(
    new Set(currencies.map(code => code.trim().toUpperCase()).filter(code => CURRENCY_RE.test(code)))
  )
  return codes.length > 0 ? JSON.stringify(codes) : null
}
