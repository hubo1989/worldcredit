import { describe, expect, it } from 'vitest'
import { buildCashflowForecast, type CashflowForecastInput } from '../finance'
import type { InstallmentPlan } from '../types'

const base = {
  id: 'bill', card_id: 'anchor', account_id: 'merged', bill_month: '2026-11',
  due_date: '2026-11-21', status: 'partial', remaining_amount: 75, currency: 'USD',
}

const plan: InstallmentPlan = {
  id: 'plan', card_id: 'secondary', title: '分期', currency: 'HKD', plan_type: 'purchase',
  principal_amount: 900, total_periods: 3, paid_periods: 0, fee_mode: 'equal_principal_fee',
  fee_charge_mode: 'per_period', fee_rate_per_period: 0.01, start_month: '2026-11', due_day: 12,
  due_month_offset: 0, billing_mode: 'included_in_statement', status: 'active', created_at: '', updated_at: '',
}

describe('cash flow forecast', () => {
  it('expands sources, offsets recurring payments, deduplicates merged installments and isolates arrears', () => {
    const input: CashflowForecastInput = {
      baseDate: '2026-11-01', horizonDays: 90, rates: null, displayCurrency: 'CNY',
      bills: [
        base, { ...base, id: 'overdue', bill_month: '2026-10', due_date: '2026-10-27' },
        { ...base, id: 'unissued', statement_date: '2026-11-02', due_date: '2026-10-15' },
        { ...base, id: 'paid', status: 'paid' },
      ],
      installments: [
        plan, { ...plan, id: 'overdue-plan', billing_mode: 'independent', start_month: '2026-08', paid_periods: 2 },
      ],
      cardAccountMap: new Map([['secondary', 'merged']]),
      payables: [
        { id: 'rent', name: '房租', currency: 'CNY', amount: 1000, due_day: 15, is_active: 1 },
        { id: 'inactive', name: '停用', currency: 'CNY', amount: 500, due_day: 1, is_active: false },
      ],
      paidByPayablePeriod: new Map([['rent:2026-12', 400]]),
    }
    const result = buildCashflowForecast(input)
    expect(result.reserves_by_currency).toEqual({
      USD: { bill: 75, installment: 0, payable: 0, total: 75 },
      HKD: { bill: 0, installment: 618, payable: 0, total: 618 },
      CNY: { bill: 0, installment: 0, payable: 2600, total: 2600 },
    })
    expect(result.converted_summary).toMatchObject({ total: 2600, converted: false, unconverted_currencies: ['HKD', 'USD'] })
    expect(result.overdue_alert.items.map(event => event.ref_id)).toEqual(['overdue-plan', 'overdue'])
    expect(result.timeline.map(event => event.ref_id)).toEqual(['rent', 'bill', 'plan', 'rent', 'plan', 'rent'])
    expect(result.buckets.map(bucket => bucket.label)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(result.buckets[1]).toMatchObject({ by_currency: { CNY: 600, HKD: 309 }, total: 600, payable: 600 })
  })

  it('includes both window endpoints for 30 and 60 days across a month boundary', () => {
    const start = '2026-01-31'
    const input = {
      baseDate: start,
      bills: [
        { ...base, id: 'now', due_date: start }, { ...base, id: '30', due_date: '2026-03-02' },
        { ...base, id: '60', due_date: '2026-04-01' }, { ...base, id: '61', due_date: '2026-04-02' },
      ],
      installments: [], payables: [],
    }
    const short = buildCashflowForecast({ ...input, horizonDays: 30 })
    expect(short.timeline.map(event => event.days_until_due)).toEqual([0, 30])
    expect(short.buckets.map(bucket => bucket.by_currency.USD ?? 0)).toEqual([75, 0, 0, 0, 75])
    const medium = buildCashflowForecast({ ...input, horizonDays: 60 })
    expect(medium.timeline.map(event => event.days_until_due)).toEqual([0, 30, 60])
    expect(medium.buckets.at(-1)?.label).toBe('2026-04')
  })

  it('includes the current unpaid payable in arrears and honors yearly and multi-month anchors', () => {
    const result = buildCashflowForecast({
      baseDate: '2026-11-22', horizonDays: 90, bills: [], installments: [],
      payables: [
        { id: 'rent', name: '房租', amount: 10, currency: 'CNY', due_day: 15, is_active: 1 },
        { id: 'quarter', name: '季付', amount: 50, currency: 'USD', due_day: 31, is_active: 1,
          cycle_type: 'every_n_months', cycle_months: 3, anchor_period: '2026-12' },
        { id: 'year', name: '年费', amount: 60, currency: 'CNY', due_day: 5, is_active: 1,
          cycle_type: 'yearly', due_month: 1, anchor_period: '2027-01' },
      ],
    })
    expect(result.overdue_alert.items.map(event => event.due_date)).toEqual(['2026-11-15'])
    expect(result.timeline.filter(event => event.ref_id === 'quarter').map(event => event.due_date)).toEqual(['2026-12-31'])
    expect(result.timeline.filter(event => event.ref_id === 'year').map(event => event.due_date)).toEqual(['2027-01-05'])
  })
})
