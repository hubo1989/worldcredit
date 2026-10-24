import { describe, it, expect } from 'vitest'
import fixtures from '../../shared/fixtures/billing-dates.json'
import {
  getDueDate,
  getActualBillingDate,
  getEffectiveBillingDay,
  getLoanNextDueDate,
  diffInCalendarDays,
  dueDistanceLabel,
} from '../utils'
import type { CreditCard, CardProduct } from '../types'

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('shared/fixtures/billing-dates.json TS Runner', () => {
  it('validates credit card billing & due date fixtures', () => {
    for (const c of fixtures.cases) {
      const card = {
        billing_day: c.card.billing_day,
        override_billing_day: c.card.override_billing_day ?? undefined,
        override_due_type: (c.card.override_due_type as CreditCard['override_due_type']) ?? undefined,
        override_due_value: c.card.override_due_value ?? undefined,
      } as unknown as CreditCard

      const cardProduct = {
        payment_due_type: c.card_product.payment_due_type,
        payment_due_value: c.card_product.payment_due_value,
      } as unknown as CardProduct

      const billMonth = new Date(c.bill_month)
      const effectiveBillingDay = getEffectiveBillingDay(card)
      const actualBillingDate = getActualBillingDate(effectiveBillingDay, billMonth)
      const calculatedDueDate = getDueDate(card, cardProduct, billMonth)

      expect(formatDate(actualBillingDate), `${c.id} billing date`).toBe(c.expected_billing_date)
      expect(formatDate(calculatedDueDate), `${c.id} due date`).toBe(c.expected_due_date)
    }
  })

  it('validates loan next due date fixtures', () => {
    for (const c of fixtures.loan_cases) {
      const today = new Date(c.today)
      const nextDue = getLoanNextDueDate(c.loan_due_day, today)
      expect(formatDate(nextDue), `${c.id} loan next due`).toBe(c.expected_next_due)
    }
  })

  it('validates calendar diff and due label fixtures', () => {
    for (const c of fixtures.diff_days_cases) {
      const target = new Date(c.target)
      const today = new Date(c.today)
      const diff = diffInCalendarDays(target, today)
      const label = dueDistanceLabel(diff)

      expect(diff, `${c.target} vs ${c.today} diff`).toBe(c.expected_diff)
      expect(label, `${c.target} vs ${c.today} label`).toBe(c.expected_label)
    }
  })
})
