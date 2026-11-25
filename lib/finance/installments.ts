import { format } from 'date-fns'
import type { InstallmentPlan } from '../types'
import { addMonthsToPayablePeriod, payableDueDate } from '../utils'
import { toCents } from './money'

export type InstallmentPlanLike = Pick<InstallmentPlan,
  'principal_amount' | 'total_periods' | 'fee_mode' | 'start_month' | 'due_day'> &
  Partial<Pick<InstallmentPlan,
    'paid_periods' | 'fee_charge_mode' | 'fee_rate_per_period' | 'custom_period_fee' | 'apr' | 'due_month_offset'>>

export interface InstallmentPeriod {
  period_index: number
  bill_month: string
  due_date: string
  principal: number
  fee: number
  total: number
  remaining_principal_after: number
  is_paid: boolean
  covered_by_statement?: boolean
}

export function generateInstallmentSchedule(plan: InstallmentPlanLike): InstallmentPeriod[] {
  const count = plan.total_periods
  const principal = toCents(plan.principal_amount)
  if (!Number.isInteger(count) || count < 2 || count > 60 || !Number.isSafeInteger(principal) || principal < 0) {
    throw new RangeError('分期金额或期数无效')
  }

  const monthlyRate = plan.fee_mode === 'equal_installment_apr' ? (plan.apr ?? 0) / 12 : 0
  const equalPrincipal = Math.round(principal / count)
  const annuity = monthlyRate > 0
    ? Math.round(principal * (monthlyRate / -Math.expm1(-count * Math.log1p(monthlyRate))))
    : 0
  const flatFee = plan.fee_mode === 'equal_principal_fee'
    ? toCents(plan.custom_period_fee ?? plan.principal_amount * (plan.fee_rate_per_period ?? 0))
    : 0

  let remaining = principal
  return Array.from({ length: count }, (_, index) => {
    const period = index + 1
    const fee = monthlyRate > 0
      ? Math.round(remaining * monthlyRate)
      : (plan.fee_charge_mode === 'upfront' && index > 0 ? 0 : flatFee)
    const scheduled = monthlyRate > 0 ? Math.max(0, annuity - fee) : equalPrincipal
    const paidPrincipal = period === count ? remaining : Math.min(remaining, scheduled)
    remaining -= paidPrincipal
    const billMonth = addMonthsToPayablePeriod(plan.start_month, index)
    const dueMonth = addMonthsToPayablePeriod(billMonth, plan.due_month_offset ?? 0)
    return {
      period_index: period,
      bill_month: billMonth,
      due_date: format(payableDueDate(plan.due_day, dueMonth), 'yyyy-MM-dd'),
      principal: paidPrincipal / 100,
      fee: fee / 100,
      total: (paidPrincipal + fee) / 100,
      remaining_principal_after: remaining / 100,
      is_paid: period <= (plan.paid_periods ?? 0),
    }
  })
}

export function remainingInstallmentPrincipal(plan: InstallmentPlanLike): number {
  return generateInstallmentSchedule(plan).reduce((remaining, period) =>
    remaining + (period.is_paid ? 0 : toCents(period.principal)), 0) / 100
}

export function nextInstallmentPeriod(plan: InstallmentPlanLike): InstallmentPeriod | null {
  return generateInstallmentSchedule(plan).find(period => !period.is_paid) ?? null
}

interface BillScope {
  card_id: string
  account_id?: string | null
  bill_month: string
}

export function buildExistingBillScopes(bills: readonly BillScope[]): Set<string> {
  const result = new Set<string>()
  for (const bill of bills) {
    result.add(['card', bill.card_id, bill.bill_month].join(':'))
    if (bill.account_id) result.add(['acc', bill.account_id, bill.bill_month].join(':'))
  }
  return result
}

export function computeActiveInstallmentsExposure(
  plans: readonly InstallmentPlan[],
  existingBillScopes: ReadonlySet<string>,
  cardAccountMap?: ReadonlyMap<string, string | null>,
) {
  const unbilledByCardAndPlan = new Map<string, { unbilledPrincipal: number; periods: InstallmentPeriod[] }>()
  const unbilledEntries: Array<{ plan: InstallmentPlan; amount: number; currency: string }> = []

  for (const plan of plans) {
    if (plan.status !== 'active') continue
    const account = cardAccountMap?.get(plan.card_id)
    const periods = generateInstallmentSchedule(plan).filter(period => !period.is_paid).map(period => ({
      ...period,
      covered_by_statement: plan.billing_mode === 'included_in_statement' && (
        existingBillScopes.has(['card', plan.card_id, period.bill_month].join(':')) ||
        (!!account && existingBillScopes.has(['acc', account, period.bill_month].join(':')))
      ),
    }))
    const unbilledPrincipal = periods.reduce((sum, period) =>
      sum + (period.covered_by_statement ? 0 : toCents(period.principal)), 0) / 100
    unbilledByCardAndPlan.set(plan.id, { unbilledPrincipal, periods })
    if (unbilledPrincipal > 0) unbilledEntries.push({ plan, amount: unbilledPrincipal, currency: plan.currency })
  }
  return { unbilledByCardAndPlan, unbilledEntries }
}
