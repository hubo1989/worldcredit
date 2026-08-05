import { compareAsc, differenceInCalendarDays, format, isValid, parseISO, startOfDay } from 'date-fns'
import type { Bill, BillItem, Payment } from './types'

export const DEFAULT_DAILY_INTEREST_RATE = 0.0005

const INTEREST_BEARING_TYPES: ReadonlySet<BillItem['item_type']> = new Set([
  'purchase',
  'fee',
  'interest',
  'other',
])

export interface BillPaymentHealth {
  totalPaid: number
  remainingBalance: number
  minPaymentCovered: boolean
  minPaymentShortfall: number
  estimatedInterest: number
  dailyInterestRate: number
  interestBearingPrincipal: number
  interestItemCount: number
  usedFallbackDates: boolean
  estimatedThrough: string
}

interface InterestPrincipal {
  amount: number
  startDate: Date
  usedFallbackDate: boolean
  createdAt: string
}

interface PaymentAllocation {
  amount: number
  paidAt: Date
  createdAt: string
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseDate(value?: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return isValid(parsed) ? startOfDay(parsed) : null
}

function formatDateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function getInterestStartDate(bill: Bill, item: BillItem): { date: Date; usedFallbackDate: boolean } {
  const candidates: Array<{ value?: string; fallback: boolean }> = [
    { value: item.transaction_date, fallback: false },
    { value: item.post_date, fallback: true },
    { value: bill.statement_date, fallback: true },
    { value: bill.statement_end, fallback: true },
    { value: bill.due_date, fallback: true },
  ]

  for (const candidate of candidates) {
    const date = parseDate(candidate.value)
    if (date) return { date, usedFallbackDate: candidate.fallback }
  }

  return { date: startOfDay(new Date()), usedFallbackDate: true }
}

function toInterestPrincipals(bill: Bill, items: BillItem[]): InterestPrincipal[] {
  return items
    .filter(item => INTEREST_BEARING_TYPES.has(item.item_type))
    .map(item => {
      const amount = Number(item.amount)
      if (!Number.isFinite(amount) || amount <= 0) return null

      const start = getInterestStartDate(bill, item)
      return {
        amount,
        startDate: start.date,
        usedFallbackDate: start.usedFallbackDate,
        createdAt: item.created_at,
      }
    })
    .filter((item): item is InterestPrincipal => item !== null)
    .sort((a, b) => {
      const byDate = compareAsc(a.startDate, b.startDate)
      if (byDate !== 0) return byDate
      return a.createdAt.localeCompare(b.createdAt)
    })
}

function toPaymentAllocations(payments: Payment[], asOf: Date): PaymentAllocation[] {
  return payments
    .map(payment => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return null
      return {
        amount,
        paidAt: parseDate(payment.paid_at) ?? asOf,
        createdAt: payment.created_at,
      }
    })
    .filter((payment): payment is PaymentAllocation => payment !== null)
    .sort((a, b) => {
      const byDate = compareAsc(a.paidAt, b.paidAt)
      if (byDate !== 0) return byDate
      return a.createdAt.localeCompare(b.createdAt)
    })
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, differenceInCalendarDays(end, start))
}

export function calculateBillPaymentHealth(
  bill: Bill,
  items: BillItem[],
  payments: Payment[],
  options: { asOf?: Date; dailyInterestRate?: number } = {}
): BillPaymentHealth {
  const asOf = startOfDay(options.asOf ?? new Date())
  const dailyInterestRate = options.dailyInterestRate ?? DEFAULT_DAILY_INTEREST_RATE
  const billAmount = Number(bill.bill_amount)
  const minPayment = Number(bill.min_payment)
  const totalPaid = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount)
    return Number.isFinite(amount) ? sum + amount : sum
  }, 0)
  const remainingBalance = Math.max((Number.isFinite(billAmount) ? billAmount : 0) - totalPaid, 0)
  const minPaymentShortfall = Math.max((Number.isFinite(minPayment) ? minPayment : 0) - totalPaid, 0)
  const minPaymentCovered = minPaymentShortfall <= 0
  const principals = toInterestPrincipals(bill, items)
  const interestBearingPrincipal = principals.reduce((sum, item) => sum + item.amount, 0)
  const usedFallbackDates = principals.some(item => item.usedFallbackDate)

  if (remainingBalance <= 0 || principals.length === 0) {
    return {
      totalPaid: roundMoney(totalPaid),
      remainingBalance: roundMoney(remainingBalance),
      minPaymentCovered,
      minPaymentShortfall: roundMoney(minPaymentShortfall),
      estimatedInterest: 0,
      dailyInterestRate,
      interestBearingPrincipal: roundMoney(interestBearingPrincipal),
      interestItemCount: principals.length,
      usedFallbackDates,
      estimatedThrough: formatDateOnly(asOf),
    }
  }

  const paymentAllocations = toPaymentAllocations(payments, asOf)
  let interest = 0

  for (const principal of principals) {
    let remainingPrincipal = principal.amount
    let cursor = principal.startDate

    for (const payment of paymentAllocations) {
      if (remainingPrincipal <= 0 || payment.amount <= 0) continue

      const applied = Math.min(remainingPrincipal, payment.amount)
      if (applied <= 0) continue

      if (compareAsc(payment.paidAt, cursor) > 0) {
        interest += remainingPrincipal * dailyInterestRate * daysBetween(cursor, payment.paidAt)
        cursor = payment.paidAt
      }

      remainingPrincipal -= applied
      payment.amount -= applied
    }

    if (remainingPrincipal > 0 && compareAsc(asOf, cursor) > 0) {
      interest += remainingPrincipal * dailyInterestRate * daysBetween(cursor, asOf)
    }
  }

  return {
    totalPaid: roundMoney(totalPaid),
    remainingBalance: roundMoney(remainingBalance),
    minPaymentCovered,
    minPaymentShortfall: roundMoney(minPaymentShortfall),
    estimatedInterest: roundMoney(interest),
    dailyInterestRate,
    interestBearingPrincipal: roundMoney(interestBearingPrincipal),
    interestItemCount: principals.length,
    usedFallbackDates,
    estimatedThrough: formatDateOnly(asOf),
  }
}
