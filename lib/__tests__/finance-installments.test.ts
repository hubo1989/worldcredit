import { describe, expect, it } from 'vitest'
import {
  buildExistingBillScopes, computeActiveInstallmentsExposure, generateInstallmentSchedule,
  nextInstallmentPeriod, remainingInstallmentPrincipal,
} from '../finance'
import type { InstallmentPlan } from '../types'

const plan: InstallmentPlan = {
  id: 'plan', card_id: 'secondary', title: '分期', currency: 'CNY', plan_type: 'purchase',
  principal_amount: 1000, total_periods: 3, paid_periods: 0, fee_mode: 'interest_free',
  fee_charge_mode: 'per_period', start_month: '2028-01', due_day: 31, due_month_offset: 1,
  billing_mode: 'included_in_statement', status: 'active', created_at: '', updated_at: '',
}

describe('installment amortization', () => {
  it('conserves raw principal cents and clamps leap-year, short-month and offset dates', () => {
    const schedule = generateInstallmentSchedule(plan)
    expect(schedule.map(period => period.principal)).toEqual([333.33, 333.33, 333.34])
    expect(schedule.map(period => period.fee)).toEqual([0, 0, 0])
    expect(schedule.map(period => period.due_date)).toEqual(['2028-02-29', '2028-03-31', '2028-04-30'])
    expect(schedule[2].remaining_principal_after).toBe(0)
    expect(remainingInstallmentPrincipal({ ...plan, paid_periods: 1 })).toBe(666.67)
    expect(nextInstallmentPeriod({ ...plan, paid_periods: 3 })).toBeNull()
  })

  it('applies flat fees per period or up front and honors a zero override', () => {
    const feePlan = { ...plan, fee_mode: 'equal_principal_fee' as const, fee_rate_per_period: 0.01 }
    expect(generateInstallmentSchedule(feePlan).map(period => period.fee)).toEqual([10, 10, 10])
    expect(generateInstallmentSchedule({ ...feePlan, fee_charge_mode: 'upfront' }).map(period => period.fee)).toEqual([10, 0, 0])
    expect(generateInstallmentSchedule({ ...feePlan, custom_period_fee: 0 }).map(period => period.fee)).toEqual([0, 0, 0])
  })

  it('amortizes APR on remaining cents and handles zero and negligible rates', () => {
    const aprPlan = { ...plan, fee_mode: 'equal_installment_apr' as const, apr: 0.12 }
    const schedule = generateInstallmentSchedule(aprPlan)
    expect(schedule.map(period => period.fee)).toEqual([10, 6.7, 3.37])
    expect(schedule.map(period => period.principal)).toEqual([330.02, 333.32, 336.66])
    expect(generateInstallmentSchedule({ ...aprPlan, apr: 1e-17 })).toEqual(generateInstallmentSchedule(plan))
    expect(generateInstallmentSchedule({ ...aprPlan, apr: 0 })).toEqual(generateInstallmentSchedule(plan))
  })

  it.each(['interest_free', 'equal_principal_fee', 'equal_installment_apr'] as const)(
    'never creates negative tails in long, small-balance %s plans', mode => {
      for (let cents = 1; cents <= 125; cents++) {
        const schedule = generateInstallmentSchedule({
          ...plan, fee_mode: mode, total_periods: 60, principal_amount: cents / 100, apr: 0.12,
        })
        expect(schedule.every(period => period.principal >= 0 && period.fee >= 0)).toBe(true)
        expect(schedule.reduce((sum, period) => sum + Math.round(period.principal * 100), 0)).toBe(cents)
      }
    },
  )

  it('excludes covered periods on anchor and secondary cards and keeps independent installments', () => {
    const scopes = buildExistingBillScopes([
      { card_id: 'primary', account_id: 'merged', bill_month: '2028-01' },
      { card_id: 'secondary', bill_month: '2028-02' },
    ])
    const result = computeActiveInstallmentsExposure([
      plan, { ...plan, id: 'independent', billing_mode: 'independent' },
      { ...plan, id: 'complete', status: 'completed' },
    ], scopes, new Map([['secondary', 'merged']]))
    expect(result.unbilledByCardAndPlan.get('plan')?.periods.map(period => period.covered_by_statement)).toEqual([true, true, false])
    expect(result.unbilledEntries.map(row => row.amount)).toEqual([333.34, 1000])
  })
})
