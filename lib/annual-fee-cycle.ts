import { normalizeCurrency } from './fx'
import { formatMoneySingle } from './notifications.shared'
import { addMonthsClamped, isValidCivilDate } from './opportunities/dates'
import { getEffectiveAnnualFee } from './utils'

type CycleType = 'none' | 'anniversary_issued' | 'anniversary_activated' | 'calendar_year' | 'custom_date'
type FeeStatus = 'not_applicable' | 'in_progress' | 'waived' | 'paid' | 'unknown'

export interface AnnualFeeCard {
  annual_fee_cycle_type?: CycleType | null
  annual_fee_override?: number | null
  annual_fee_status?: FeeStatus | null
  next_annual_fee_date?: string | null
  issued_on?: string | null
  activated_on?: string | null
}

export interface AnnualFeeProduct {
  annual_fee?: number | null
  annual_fee_cycle_type?: CycleType | null
}

export interface AnnualFeeCycleState {
  status: FeeStatus
  nominalFee: number
  nextDueDate: string | null
  cycleStartOn: string | null
  /** Suggested next date after an explicit due date passes. Advancing it requires confirmation. */
  rolloverNextDueDate: string | null
}

function anniversaryIndex(anchor: string, today: string): number {
  const yearDelta = Number(today.slice(0, 4)) - Number(anchor.slice(0, 4))
  const year = Math.max(1, yearDelta)
  return addMonthsClamped(anchor, 12 * year) < today ? year + 1 : year
}

export function resolveAnnualFeeCycleState(
  card: AnnualFeeCard,
  product: AnnualFeeProduct | null,
  today: string
): AnnualFeeCycleState | null {
  if (!isValidCivilDate(today)) return null
  if (![card.next_annual_fee_date, card.issued_on, card.activated_on].some(isValidCivilDate)) {
    return null
  }

  const nominalFee = getEffectiveAnnualFee(card, { annual_fee: product?.annual_fee ?? undefined }) ?? 0
  const status = card.annual_fee_status ?? 'in_progress'
  const cycleType = card.annual_fee_cycle_type ?? product?.annual_fee_cycle_type ??
    (nominalFee <= 0 ? 'none' : null)
  let anchor: string | null | undefined
  if (cycleType === 'anniversary_issued') anchor = card.issued_on
  if (cycleType === 'anniversary_activated') anchor = card.activated_on
  const explicit = card.next_annual_fee_date

  if (isValidCivilDate(explicit)) {
    const rolloverAnchor = isValidCivilDate(anchor) ? anchor : explicit
    return {
      status, nominalFee, nextDueDate: explicit,
      cycleStartOn: addMonthsClamped(explicit, -12),
      rolloverNextDueDate: explicit < today && cycleType !== 'none'
        ? addMonthsClamped(rolloverAnchor, 12 * anniversaryIndex(rolloverAnchor, today))
        : null,
    }
  }

  if (cycleType === 'none') {
    return { status: 'not_applicable', nominalFee, nextDueDate: null, cycleStartOn: null, rolloverNextDueDate: null }
  }
  if (!isValidCivilDate(anchor)) return null

  const year = anniversaryIndex(anchor, today)
  return {
    status, nominalFee,
    nextDueDate: addMonthsClamped(anchor, 12 * year),
    cycleStartOn: addMonthsClamped(anchor, 12 * (year - 1)),
    rolloverNextDueDate: null,
  }
}

function parseRuleObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'schema_version' in value && value.schema_version === 1) {
      return value as Record<string, unknown>
    }
  } catch {
    // Older or invalid snapshots provide no usable progress.
  }
  return null
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function describeAnnualFeeWaiverGap(
  ruleJson: string | null,
  progressJson: string | null,
  cycle: { nextDueDate: string; cycleStartOn: string },
  currency: string,
  today: string
): string | undefined {
  const rule = parseRuleObject(ruleJson)
  if (!rule || rule.waiver_type === 'none' || rule.waiver_type === 'first_year_free') return undefined

  const progress = parseRuleObject(progressJson)
  const asOf = progress?.as_of_on
  if (!progress || !isValidCivilDate(asOf) || asOf < cycle.cycleStartOn || asOf > today ||
      (progress.cycle_due_date !== undefined && progress.cycle_due_date !== null && progress.cycle_due_date !== cycle.nextDueDate)) {
    return '免年费进度待更新'
  }

  const gaps: Array<{ remaining: number; label: string }> = []
  const addGap = (target: unknown, current: unknown, label: (remaining: number) => string) => {
    const needed = nonnegative(target)
    const completed = nonnegative(current)
    if (needed === null || completed === null) return
    const remaining = Math.max(0, needed - completed)
    gaps.push({ remaining, label: label(remaining) })
  }
  const { waiver_type: type } = rule
  if (type === 'spend_amount' || type === 'spend_amount_or_count') {
    const targetCurrency = rule.target_currency === undefined || rule.target_currency === null
      ? currency : normalizeCurrency(rule.target_currency)
    if (targetCurrency) {
      addGap(rule.target_amount, progress.amount, n => formatMoneySingle(n, targetCurrency))
    }
  }
  if (type === 'spend_count' || type === 'spend_amount_or_count') {
    addGap(rule.target_count, progress.count, n => `${n} 笔`)
  }
  if (type === 'points_redeem') {
    addGap(rule.points_cost, progress.points_redeemed, n => `${n.toLocaleString('zh-CN')} 积分`)
  }

  if (gaps.some(gap => gap.remaining === 0)) return '已达到免年费条件，待确认'
  if (!gaps.length) return '免年费进度待更新'
  return `距免年费还差 ${gaps.map(gap => gap.label).join(' 或 ')}`
}
