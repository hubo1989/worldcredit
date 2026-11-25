import { currencySymbol } from '@/lib/fx'
import { addMonthsClamped, isValidCivilDate } from '@/lib/opportunities/dates'
import { getEffectiveAnnualFee } from '@/lib/utils'
import type {
  AnnualFeeCycleType,
  AnnualFeeStatus,
  AnnualFeeWaiverRuleV1,
  CardProductWithRules,
  CreditCardWithAnnualFee,
  RewardRulesV1,
  WaiverProgressV1,
} from './types'

export function parseRewardRules(raw: string | null | undefined): RewardRulesV1 | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as Partial<RewardRulesV1>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.base_rate_pct !== 'number' || !Number.isFinite(parsed.base_rate_pct)) {
      return null
    }
    return {
      schema_version: 1,
      reward_kind:
        parsed.reward_kind === 'points' || parsed.reward_kind === 'miles'
          ? parsed.reward_kind
          : 'cashback',
      point_unit_name: parsed.point_unit_name ?? null,
      point_value_per_unit:
        typeof parsed.point_value_per_unit === 'number' &&
        Number.isFinite(parsed.point_value_per_unit)
          ? parsed.point_value_per_unit
          : null,
      base_rate_pct: Math.max(0, parsed.base_rate_pct),
      base_raw_label: parsed.base_raw_label ?? null,
      category_rules: Array.isArray(parsed.category_rules) ? parsed.category_rules : [],
      notes: parsed.notes ?? null,
    }
  } catch {
    return null
  }
}

export function parseFxFreeCurrencies(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && /^[A-Z]{3}$/.test(item.trim().toUpperCase()))
      .map((item) => item.trim().toUpperCase())
  } catch {
    return []
  }
}

export function parseAnnualFeeWaiverRules(
  raw: string | null | undefined
): AnnualFeeWaiverRuleV1 | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as Partial<AnnualFeeWaiverRuleV1>
    if (!parsed || typeof parsed !== 'object' || !parsed.waiver_type) return null
    return {
      schema_version: 1,
      waiver_type: parsed.waiver_type,
      first_year_free: Boolean(parsed.first_year_free),
      target_amount:
        typeof parsed.target_amount === 'number' && Number.isFinite(parsed.target_amount)
          ? parsed.target_amount
          : null,
      target_currency: parsed.target_currency ?? null,
      target_count:
        typeof parsed.target_count === 'number' && Number.isFinite(parsed.target_count)
          ? parsed.target_count
          : null,
      per_txn_min_amount:
        typeof parsed.per_txn_min_amount === 'number' &&
        Number.isFinite(parsed.per_txn_min_amount)
          ? parsed.per_txn_min_amount
          : null,
      points_cost:
        typeof parsed.points_cost === 'number' && Number.isFinite(parsed.points_cost)
          ? parsed.points_cost
          : null,
      notes: parsed.notes ?? null,
    }
  } catch {
    return null
  }
}

export function parseWaiverProgress(raw: string | null | undefined): WaiverProgressV1 | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as Partial<WaiverProgressV1>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      schema_version: 1,
      cycle_due_date: typeof parsed.cycle_due_date === 'string' ? parsed.cycle_due_date : null,
      amount: typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? Math.max(0, parsed.amount) : 0,
      count: typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? Math.max(0, Math.trunc(parsed.count)) : 0,
      points_redeemed:
        typeof parsed.points_redeemed === 'number' && Number.isFinite(parsed.points_redeemed)
          ? parsed.points_redeemed
          : null,
      as_of_on: typeof parsed.as_of_on === 'string' ? parsed.as_of_on : '',
      source:
        parsed.source === 'bill_items_estimate' || parsed.source === 'bills_estimate'
          ? parsed.source
          : 'manual',
      note: typeof parsed.note === 'string' ? parsed.note : null,
    }
  } catch {
    return null
  }
}

export function computeProductRuleCompleteness(
  product: Pick<CardProductWithRules, 'reward_rules_json' | 'ftf_rate'>
): 'complete' | 'partial' | 'none' {
  const hasReward = parseRewardRules(product.reward_rules_json) !== null
  const hasFtf = product.ftf_rate !== null && product.ftf_rate !== undefined
  if (hasReward && hasFtf) return 'complete'
  if (hasReward || hasFtf) return 'partial'
  return 'none'
}

export function diffCivilDays(targetDate: string, fromDate: string): number {
  if (!isValidCivilDate(targetDate) || !isValidCivilDate(fromDate)) return 0
  return Math.round((Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000)
}

export interface LocalAnnualFeeCycleState {
  nominalFee: number
  cycleType: AnnualFeeCycleType | null
  status: AnnualFeeStatus
  nextDueDate: string | null
  cycleStartOn: string | null
  daysUntilDue: number | null
  isOverdueDueDate: boolean
  rolloverNextDueDate: string | null
}

/**
 * 纯客户端预览年费周期（严格与服务端 WC-BEN-12 口径对齐：绝不读取 created_at 编造日期）。
 */
export function resolveAnnualFeeCycleLocal(
  card: Pick<
    CreditCardWithAnnualFee,
    | 'annual_fee_override'
    | 'annual_fee_cycle_type'
    | 'next_annual_fee_date'
    | 'annual_fee_status'
    | 'issued_on'
    | 'activated_on'
  >,
  product: Pick<CardProductWithRules, 'annual_fee' | 'annual_fee_cycle_type'> | null | undefined,
  todayStr: string
): LocalAnnualFeeCycleState {
  const nominalFee = Math.max(0, getEffectiveAnnualFee(card, product) ?? 0)
  const cycleType =
    card.annual_fee_cycle_type ??
    product?.annual_fee_cycle_type ??
    (nominalFee <= 0 ? 'none' : null)

  if (cycleType === 'none' && !isValidCivilDate(card.next_annual_fee_date)) {
    return {
      nominalFee,
      cycleType: 'none',
      status: card.annual_fee_status ?? 'not_applicable',
      nextDueDate: null,
      cycleStartOn: null,
      daysUntilDue: null,
      isOverdueDueDate: false,
      rolloverNextDueDate: null,
    }
  }

  let nextDueDate: string | null = null
  let cycleStartOn: string | null = null
  let rolloverNextDueDate: string | null = null

  if (isValidCivilDate(card.next_annual_fee_date)) {
    nextDueDate = card.next_annual_fee_date
    cycleStartOn = addMonthsClamped(nextDueDate, -12)
    if (nextDueDate < todayStr) {
      let k = 1
      while (addMonthsClamped(nextDueDate, 12 * k) < todayStr) k += 1
      rolloverNextDueDate = addMonthsClamped(nextDueDate, 12 * k)
    }
  } else {
    const anchor =
      cycleType === 'anniversary_issued' && isValidCivilDate(card.issued_on)
        ? card.issued_on
        : cycleType === 'anniversary_activated' && isValidCivilDate(card.activated_on)
          ? card.activated_on
          : null

    if (anchor) {
      const anchorYear = Number(anchor.slice(0, 4))
      const todayYear = Number(todayStr.slice(0, 4))
      let k = Math.max(1, todayYear - anchorYear - 1)
      while (addMonthsClamped(anchor, 12 * k) < todayStr) k += 1
      nextDueDate = addMonthsClamped(anchor, 12 * k)
      cycleStartOn = addMonthsClamped(anchor, 12 * (k - 1))
    }
  }

  const daysUntilDue = nextDueDate ? diffCivilDays(nextDueDate, todayStr) : null
  const status: AnnualFeeStatus =
    card.annual_fee_status ?? (nominalFee <= 0 ? 'not_applicable' : 'in_progress')

  return {
    nominalFee,
    cycleType,
    status,
    nextDueDate,
    cycleStartOn,
    daysUntilDue,
    isOverdueDueDate: nextDueDate !== null && nextDueDate < todayStr,
    rolloverNextDueDate,
  }
}

export function formatCurrencyAmount(amount: number, currency: string, showPlus = false): string {
  const numeric = Number.isFinite(amount) ? amount : 0
  const absFormatted = `${currencySymbol(currency)}${Math.abs(numeric).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
  if (numeric < 0) return `-${absFormatted}`
  if (showPlus && numeric > 0) return `+${absFormatted}`
  return absFormatted
}

export function formatPct1(value: number | null | undefined, showPlus = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const prefix = showPlus && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

/** 精确将非负十进制金额字符串转换为整数分（避免浮点乘法精度漂移） */
export function parseAmountToMinor(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  const whole = Number(intPart)
  if (!Number.isSafeInteger(whole)) return null
  const padded = (fracPart + '000').slice(0, 3)
  const baseCents = Number(padded.slice(0, 2))
  const roundUp = Number(padded[2]) >= 5 ? 1 : 0
  return whole * 100 + baseCents + roundUp
}
