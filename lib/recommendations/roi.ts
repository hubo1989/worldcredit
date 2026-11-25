// lib/recommendations/roi.ts — 单卡年度年费 ROI 复盘与全家庭多币种汇总（纯函数）。
//
// 口径（Spec 07 / HUB-175 §4）：
//   total_value = 已核销权益估值 + 优惠返现价值 + 手动补录返现
//   net_value  = total_value - annual_fee_cost
//   cost <= 0 时 roi_pct / coverage_pct 一律 null —— 绝不产出 Infinity / NaN。

import { sumByCurrency, type FxRates, type FxSum } from '../fx'
import { round2, type AnnualFeeStatus } from './types'

export type RoiPeriodMode = 'current_cycle' | 'last_12m' | 'year'

export type RoiWindowMode = 'exact_cycle' | 'last_12m_fallback' | 'calendar_year'

export type RoiCostBasis = 'waived' | 'actual_paid' | 'estimated_nominal' | 'zero_fee'

export type RoiDecisionTag =
  | 'free_earning'
  | 'free_idle'
  | 'keep_high_roi'
  | 'borderline_negotiate'
  | 'negative_downgrade_cancel'

export const ROI_DECISION_LABELS: Record<RoiDecisionTag, string> = {
  free_earning: '纯赚持有',
  free_idle: '闲置零成本卡',
  keep_high_roi: '高 ROI · 建议续卡',
  borderline_negotiate: '临界持平 · 观察或谈心',
  negative_downgrade_cancel: '负 ROI · 建议降级或销卡',
}

export interface UnvaluedBenefitRef {
  account_id: string | null
  definition_id: string | null
  quantity: number
}

/**
 * 卡内异币种收益因缺汇率无法折算到卡片主币种时的明细。
 * 这类金额绝不静默按 1:1 混入合计，而是原样保留金额与币种交由调用方披露。
 */
export interface CrossCurrencyUnconverted {
  currency: string
  amount: number
  source: 'benefit' | 'promo' | 'task'
}

export interface CardAnnualFeeRoiDetail {
  card_id: string
  holder_id: string
  holder_name: string
  bank_name: string
  card_name: string
  card_number_last4: string | null
  card_currency: string
  period_mode: RoiPeriodMode
  period_start: string
  period_end_exclusive: string
  window_mode_resolved: RoiWindowMode
  annual_fee_cost: number
  cost_basis: RoiCostBasis
  redeemed_benefits_value: number
  promo_and_reward_value: number
  manual_reward_value: number
  total_value: number
  net_value: number
  coverage_pct: number | null
  roi_pct: number | null
  decision_tag: RoiDecisionTag
  decision_label: string
  unvalued_benefit_count: number
  unvalued_benefit_refs: UnvaluedBenefitRef[]
  /** 卡内异币种、缺汇率未折算的收益明细（金额与币种原样保留，绝不 1:1 混入合计）。 */
  unconverted_values: CrossCurrencyUnconverted[]
  item_counts: {
    benefit_usages: number
    promo_usages: number
    task_results: number
  }
}

export interface FamilyAnnualFeeRoiBoard {
  period_mode: RoiPeriodMode
  window_start: string
  window_end_exclusive: string
  display_currency: string
  fx_available: boolean
  cards: CardAnnualFeeRoiDetail[]
  totals: {
    annual_fee_cost: FxSum
    redeemed_benefits_value: FxSum
    promo_and_reward_value: FxSum
    manual_reward_value: FxSum
    total_value: FxSum
    net_value: FxSum
  }
  unconverted_currencies: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// 日期工具（与 HUB-176 的 lib/annual-fee-cycle.ts 同源口径，但此处不依赖该文件：
// 该模块由数据侧并行交付，ROI 引擎只复刻同一套闰年钳制算法）
// ---------------------------------------------------------------------------

function isValidCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return false
  const d = new Date(parsed)
  return d.toISOString().slice(0, 10) === value
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 加 n 个月并钳制到目标月最后一天（2024-02-29 → 2025-02-28 → 2028-02-29 无漂移还原）。 */
export function addMonthsClamped(dateStr: string, deltaMonths: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const total = year * 12 + (month - 1) + deltaMonths
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth))
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const parsed = Date.parse(`${dateStr}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return dateStr
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10)
}

export interface RoiWindowInput {
  period_mode: RoiPeriodMode
  today_on: string
  year?: number | null
  /** 卡片下次扣费日；current_cycle 的锚点 */
  next_due_date?: string | null
}

/**
 * 统计窗口（半开区间 [start, end)）。
 * - current_cycle：已知扣费日 → [扣费日 - 12 个月, 扣费日)；未知 → 近 12 个月并标记 fallback
 * - last_12m：[today - 365, today + 1)
 * - year：自然年 [YYYY-01-01, YYYY+1-01-01)
 */
export function resolveRoiWindow(input: RoiWindowInput): {
  period_start: string
  period_end_exclusive: string
  window_mode_resolved: RoiWindowMode
} {
  const today = isValidCivilDate(input.today_on) ? input.today_on : new Date().toISOString().slice(0, 10)
  if (input.period_mode === 'year') {
    const year = Number.isInteger(input.year) && input.year ? (input.year as number) : Number(today.slice(0, 4))
    return {
      period_start: `${year}-01-01`,
      period_end_exclusive: `${year + 1}-01-01`,
      window_mode_resolved: 'calendar_year',
    }
  }
  if (input.period_mode === 'current_cycle' && input.next_due_date && isValidCivilDate(input.next_due_date)) {
    return {
      period_start: addMonthsClamped(input.next_due_date, -12),
      period_end_exclusive: input.next_due_date,
      window_mode_resolved: 'exact_cycle',
    }
  }
  return {
    period_start: addDays(today, -365),
    period_end_exclusive: addDays(today, 1),
    window_mode_resolved: 'last_12m_fallback',
  }
}

// ---------------------------------------------------------------------------
// 单卡 ROI
// ---------------------------------------------------------------------------

export interface CardRoiInput {
  card: {
    id: string
    holder_id: string
    holder_name: string
    bank_name: string
    card_name: string
    card_number_last4: string | null
    currency: string
    annual_fee_status: AnnualFeeStatus | null
    actual_fee_paid: number | null
    manual_reward_value: number | null
    annual_fee_override: number | null
    product_annual_fee: number | null
  }
  period_mode: RoiPeriodMode
  period_start: string
  period_end_exclusive: string
  window_mode_resolved: RoiWindowMode
  redeemed_benefits_value: number
  promo_and_reward_value: number
  task_reward_value: number
  benefit_usage_count: number
  promo_usage_count: number
  task_result_count: number
  unvalued_benefit_count: number
  unvalued_benefit_refs: UnvaluedBenefitRef[]
  unconverted_values?: CrossCurrencyUnconverted[]
}

/** 年费成本：waived → 0；实付优先；其余按名义年费估算。 */
export function resolveAnnualFeeCost(card: CardRoiInput['card']): {
  annual_fee_cost: number
  cost_basis: RoiCostBasis
} {
  if (card.annual_fee_status === 'waived') {
    return { annual_fee_cost: 0, cost_basis: 'waived' }
  }
  if (card.actual_fee_paid !== null && card.actual_fee_paid !== undefined) {
    return { annual_fee_cost: Math.max(0, card.actual_fee_paid), cost_basis: 'actual_paid' }
  }
  const nominal =
    card.annual_fee_override !== null && card.annual_fee_override !== undefined
      ? Number(card.annual_fee_override)
      : card.product_annual_fee !== null && card.product_annual_fee !== undefined
        ? Number(card.product_annual_fee)
        : 0
  const cost = Math.max(0, Number.isFinite(nominal) ? nominal : 0)
  return { annual_fee_cost: cost, cost_basis: cost > 0 ? 'estimated_nominal' : 'zero_fee' }
}

function decideTag(cost: number, totalValue: number, netValue: number): RoiDecisionTag {
  if (cost === 0) return totalValue > 0 ? 'free_earning' : 'free_idle'
  if (netValue >= 0) return 'keep_high_roi'
  return totalValue / cost >= 0.8 ? 'borderline_negotiate' : 'negative_downgrade_cancel'
}

/** 百分比统一保留 1 位小数（113.9% 而不是 113.89%）。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function computeCardAnnualFeeRoi(input: CardRoiInput): CardAnnualFeeRoiDetail {
  const { annual_fee_cost, cost_basis } = resolveAnnualFeeCost(input.card)
  const manualRewardValue = round2(input.card.manual_reward_value ?? 0)
  const redeemed = round2(input.redeemed_benefits_value)
  const promo = round2(input.promo_and_reward_value + input.task_reward_value)
  const totalValue = round2(redeemed + promo + manualRewardValue)
  const netValue = round2(totalValue - annual_fee_cost)
  const roiPct = annual_fee_cost > 0 ? round1((netValue / annual_fee_cost) * 100) : null
  const coveragePct = annual_fee_cost > 0 ? round1((totalValue / annual_fee_cost) * 100) : null
  const decisionTag = decideTag(annual_fee_cost, totalValue, netValue)

  return {
    card_id: input.card.id,
    holder_id: input.card.holder_id,
    holder_name: input.card.holder_name,
    bank_name: input.card.bank_name,
    card_name: input.card.card_name,
    card_number_last4: input.card.card_number_last4,
    card_currency: input.card.currency,
    period_mode: input.period_mode,
    period_start: input.period_start,
    period_end_exclusive: input.period_end_exclusive,
    window_mode_resolved: input.window_mode_resolved,
    annual_fee_cost,
    cost_basis,
    redeemed_benefits_value: redeemed,
    promo_and_reward_value: promo,
    manual_reward_value: manualRewardValue,
    total_value: totalValue,
    net_value: netValue,
    coverage_pct: coveragePct,
    roi_pct: roiPct,
    decision_tag: decisionTag,
    decision_label: ROI_DECISION_LABELS[decisionTag],
    unvalued_benefit_count: input.unvalued_benefit_count,
    unvalued_benefit_refs: input.unvalued_benefit_refs,
    unconverted_values: input.unconverted_values ?? [],
    item_counts: {
      benefit_usages: input.benefit_usage_count,
      promo_usages: input.promo_usage_count,
      task_results: input.task_result_count,
    },
  }
}

// ---------------------------------------------------------------------------
// 全家庭多币种汇总
// ---------------------------------------------------------------------------

/**
 * 全家庭汇总：每个指标分别走 sumByCurrency，缺汇率币种排除出合计并显式列出，
 * 绝不把 USD 当 CNY 1:1 相加。
 */
export function aggregateFamilyAnnualFeeRoi(
  cards: CardAnnualFeeRoiDetail[],
  displayCurrency: string | null,
  rates: FxRates | null
): FamilyAnnualFeeRoiBoard {
  const target = displayCurrency || 'CNY'
  const sum = (pick: (card: CardAnnualFeeRoiDetail) => number): FxSum =>
    sumByCurrency(cards, card => ({ amount: pick(card), currency: card.card_currency }), target, rates)

  const totals = {
    annual_fee_cost: sum(card => card.annual_fee_cost),
    redeemed_benefits_value: sum(card => card.redeemed_benefits_value),
    promo_and_reward_value: sum(card => card.promo_and_reward_value),
    manual_reward_value: sum(card => card.manual_reward_value),
    total_value: sum(card => card.total_value),
    net_value: sum(card => card.net_value),
  }

  // 卡内异币种收益缺汇率未折算的币种，与「卡币种 → 展示币种」缺汇率一并披露。
  const cardUnconverted = Array.from(
    new Set(cards.flatMap(card => (card.unconverted_values ?? []).map(item => item.currency)))
  ).sort()
  const unconverted = Array.from(
    new Set([
      ...Object.values(totals).flatMap(entry => entry.unconverted_currencies),
      ...cardUnconverted,
    ])
  ).sort()

  const warnings: string[] = []
  if (unconverted.length > 0) {
    warnings.push(`未含汇率：${unconverted.join('、')} 未计入合计（单卡仍展示原币金额）`)
  }
  if (cardUnconverted.length > 0) {
    warnings.push(
      `卡内异币种收益缺汇率未折算：${cardUnconverted.join('、')} 未计入合计（明细见各卡 unconverted_values）`
    )
  }
  if (cards.length === 0) {
    warnings.push('当前统计窗口内没有可复盘的卡片')
  }

  return {
    period_mode: cards[0]?.period_mode ?? 'last_12m',
    window_start: cards.reduce(
      (min, card) => (card.period_start < min ? card.period_start : min),
      cards[0]?.period_start ?? ''
    ),
    window_end_exclusive: cards.reduce(
      (max, card) => (card.period_end_exclusive > max ? card.period_end_exclusive : max),
      cards[0]?.period_end_exclusive ?? ''
    ),
    display_currency: target,
    fx_available: rates !== null,
    cards,
    totals,
    unconverted_currencies: unconverted,
    warnings,
  }
}

