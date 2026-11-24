import { describe, expect, it } from 'vitest'
import { estimateBillRepaymentHealth, simulateRepaymentScenarios, type RepaymentHealthInput } from '../finance'

const input: RepaymentHealthInput = {
  bill: { bill_month: '2026-10', bill_amount: 2000, statement_date: '2026-10-15', due_date: '2026-10-24', min_payment: 1000 },
  estimateDate: '2026-10-25',
  items: [
    { amount: 1000, item_type: 'purchase', transaction_date: '2026-10-15' },
    { amount: 1000, item_type: 'purchase', transaction_date: '2026-10-05' },
  ],
  payments: [{ amount: 1000, paid_at: '2026-10-20' }],
}

describe('repayment health', () => {
  it('uses chronological FIFO and exact left-closed day differences', () => {
    expect(estimateBillRepaymentHealth(input)).toMatchObject({
      tier: 'A_items', estimated_interest: 12.5, interest_bearing_principal: 1000,
      min_payment_status: 'covered', is_overdue: true,
    })
    expect(estimateBillRepaymentHealth({ ...input, payments: [
      { amount: 500, paid_at: '2026-10-20' }, { amount: 500, paid_at: '2026-10-05' },
      { amount: 1000, paid_at: '2026-10-26' },
    ] })).toMatchObject({ total_paid: 1000, estimated_interest: 8.75 })
  })

  it('deducts refunds and negative adjustments from newest slices and excludes installment interest', () => {
    const result = estimateBillRepaymentHealth({
      ...input,
      billCurrency: 'CNY',
      items: [
        ...input.items,
        { amount: 300, item_type: 'refund' }, { amount: -100, item_type: 'adjustment' },
        { amount: 500, item_type: 'installment', transaction_date: '2026-09-15' },
        { amount: 999, item_type: 'purchase', currency: 'USD', transaction_date: '2026-09-15' },
      ],
    })
    expect(result).toMatchObject({ estimated_interest: 10.5, interest_bearing_principal: 600 })
  })

  it('falls back through posting date and statement or period day', () => {
    expect(estimateBillRepaymentHealth({
      ...input, items: [{ amount: 1000, item_type: 'purchase', post_date: '2026-10-10' }],
    })).toMatchObject({ estimated_interest: 5, used_fallback_date: true })
    expect(estimateBillRepaymentHealth({ ...input, items: [] })).toMatchObject({
      tier: 'B_statement_fallback', estimated_interest: 7.5,
    })
    expect(estimateBillRepaymentHealth({
      ...input, items: [], bill: { ...input.bill, statement_date: undefined, statement_start: undefined },
    })).toMatchObject({ estimated_interest: 21.5 })
  })

  it.each([undefined, null, 0, -1])('treats a %s minimum amount as unset', minimum => {
    expect(estimateBillRepaymentHealth({
      ...input, bill: { ...input.bill, min_payment: minimum },
    })).toMatchObject({ min_payment_status: 'unset', uncovered_min: 0 })
  })

  it('uses bill and min overrides, applies the cent threshold and exempts loans', () => {
    const bill = { ...input.bill, bill_amount_override: 1000.01, min_payment_override: 1000.02 }
    expect(estimateBillRepaymentHealth({ ...input, bill })).toMatchObject({
      is_fully_paid: true, min_payment_status: 'uncovered', uncovered_min: 0.02, estimated_interest: 0,
    })
    expect(estimateBillRepaymentHealth({ ...input, cardType: 'loan' }).applicable).toBe(false)
  })

  it('uses the Shanghai civil day for timestamp payments and leaves real payments untouched in scenarios', () => {
    expect(estimateBillRepaymentHealth({
      ...input,
      payments: [{ amount: 1000, paid_at: '2026-10-19T16:00:00Z' }],
    }).estimated_interest).toBe(12.5)
    const payments = Object.freeze([{ amount: 500, paid_at: '2026-10-20' }])
    const result = simulateRepaymentScenarios({ ...input, payments, customPayAmount: 300 }, '2026-11-15')
    expect(result.current.remaining_amount).toBe(1500)
    expect(result.min_payment.remaining_amount).toBe(1000)
    expect(result.custom.remaining_amount).toBe(1200)
    expect(result.full_payment).toMatchObject({ is_fully_paid: true, estimated_interest: 0, rollover_total: 0 })
    expect(result.current.rollover_total).toBeGreaterThan(1500)
    expect(payments).toHaveLength(1)
  })
})
