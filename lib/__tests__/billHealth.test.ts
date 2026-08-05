import { describe, expect, it } from 'vitest'
import { calculateBillPaymentHealth } from '../billHealth'
import type { Bill, BillItem, Payment } from '../types'

const baseBill: Bill = {
  id: 'bill-1',
  card_id: 'card-1',
  bill_month: '2026-01',
  statement_start: '2026-01-01',
  statement_end: '2026-01-31',
  statement_date: '2026-02-01',
  bill_amount: 1000,
  min_payment: 100,
  due_date: '2026-02-20',
  status: 'partial',
  created_at: '2026-02-01',
}

function billItem(overrides: Partial<BillItem>): BillItem {
  return {
    id: 'item-1',
    bill_id: 'bill-1',
    transaction_date: '2026-01-01',
    post_date: '2026-01-02',
    description: '消费',
    amount: 100,
    item_type: 'purchase',
    source: 'manual',
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 'payment-1',
    bill_id: 'bill-1',
    amount: 50,
    paid_at: '2026-02-10',
    channel: '手动还款',
    idempotency_key: 'key-1',
    created_at: '2026-02-10T00:00:00Z',
    ...overrides,
  }
}

describe('calculateBillPaymentHealth', () => {
  it('detects uncovered minimum payment', () => {
    const health = calculateBillPaymentHealth(
      baseBill,
      [],
      [payment({ amount: 50 })],
      { asOf: new Date('2026-02-11') }
    )

    expect(health.totalPaid).toBe(50)
    expect(health.minPaymentCovered).toBe(false)
    expect(health.minPaymentShortfall).toBe(50)
  })

  it('detects covered minimum payment', () => {
    const health = calculateBillPaymentHealth(
      baseBill,
      [],
      [payment({ amount: 100 })],
      { asOf: new Date('2026-02-11') }
    )

    expect(health.minPaymentCovered).toBe(true)
    expect(health.minPaymentShortfall).toBe(0)
  })

  it('returns zero estimated interest for fully paid bills', () => {
    const health = calculateBillPaymentHealth(
      baseBill,
      [billItem({ amount: 1000, transaction_date: '2026-01-01' })],
      [payment({ amount: 1000, paid_at: '2026-02-10' })],
      { asOf: new Date('2026-02-15') }
    )

    expect(health.remainingBalance).toBe(0)
    expect(health.estimatedInterest).toBe(0)
  })

  it('allocates payments to the earliest principal first', () => {
    const health = calculateBillPaymentHealth(
      { ...baseBill, bill_amount: 200 },
      [
        billItem({
          id: 'item-1',
          amount: 100,
          transaction_date: '2026-01-01',
          created_at: '2026-01-01T00:00:00Z',
        }),
        billItem({
          id: 'item-2',
          amount: 100,
          transaction_date: '2026-01-03',
          created_at: '2026-01-03T00:00:00Z',
        }),
      ],
      [payment({ amount: 120, paid_at: '2026-01-05' })],
      { asOf: new Date('2026-01-10') }
    )

    expect(health.estimatedInterest).toBe(0.5)
  })

  it('falls back to bill dates when item transaction dates are missing', () => {
    const health = calculateBillPaymentHealth(
      { ...baseBill, statement_date: '2026-02-01', bill_amount: 100 },
      [billItem({ transaction_date: undefined, post_date: undefined, amount: 100 })],
      [],
      { asOf: new Date('2026-02-03') }
    )

    expect(health.usedFallbackDates).toBe(true)
    expect(health.estimatedInterest).toBe(0.1)
  })
})
