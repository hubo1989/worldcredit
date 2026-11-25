import { billEffectiveDueDate, billEffectiveMinPayment, billEffectiveStatementDate, effectiveBillAmount, getLocalTodayString, isValidCalendarDate } from '../utils'
import { normalizeCurrency } from '../fx'
import { signedItemAmount, type BillItemType } from './categories'
import { roundMoney, toCents } from './money'

interface RepaymentBill {
  bill_month: string
  bill_amount: number
  bill_amount_override?: number | null
  min_payment?: number | null
  min_payment_override?: number | null
  statement_date?: string | null
  statement_date_override?: string | null
  statement_start?: string | null
  statement_end?: string | null
  due_date: string
  due_date_override?: string | null
}

interface RepaymentItem {
  amount: number
  item_type: BillItemType
  currency?: string | null
  transaction_date?: string | null
  post_date?: string | null
}

export interface RepaymentHealthInput {
  bill: RepaymentBill
  cardType?: 'credit' | 'loan'
  billCurrency?: string
  items: readonly RepaymentItem[]
  payments: readonly { amount: number; paid_at: string }[]
  dailyRate?: number
  estimateDate?: string
  customPayAmount?: number
}

const DAY_MS = 86_400_000
const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

function civilDay(raw?: string | null): string | null {
  if (!raw) return null
  if (isValidCalendarDate(raw)) return raw
  if (!isValidCalendarDate(raw.slice(0, 10))) return null
  const instant = new Date(raw)
  return Number.isFinite(instant.getTime()) ? getLocalTodayString(BUSINESS_TIME_ZONE, instant) : null
}

function interestDays(start: string, end: string): number {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / DAY_MS)
}

export function estimateBillRepaymentHealth(input: RepaymentHealthInput) {
  const { bill } = input
  const today = civilDay(input.estimateDate) ?? getLocalTodayString(BUSINESS_TIME_ZONE)
  const due = civilDay(billEffectiveDueDate(bill))
  const statement = civilDay(billEffectiveStatementDate(bill)) ?? civilDay(bill.statement_end)
  const statementFallback = statement ?? civilDay(bill.statement_start) ?? civilDay(bill.bill_month.slice(0, 7) + '-01') ?? today
  const dailyRate = input.dailyRate ?? 0.0005
  const effective = toCents(effectiveBillAmount(bill))
  const payments = input.payments.flatMap(payment => {
    const date = civilDay(payment.paid_at)
    return date && date <= today && payment.amount > 0 ? [{ date, cents: toCents(payment.amount) }] : []
  }).sort((a, b) => a.date.localeCompare(b.date))
  const paid = payments.reduce((sum, payment) => sum + payment.cents, 0)
  const remaining = Math.max(0, effective - paid)
  const min = toCents(billEffectiveMinPayment(bill) ?? 0)
  const minimumStatus = min <= 0 ? 'unset' : paid >= min - 1 ? 'covered' : 'uncovered'
  const applicable = input.cardType !== 'loan'

  const billCurrency = normalizeCurrency(input.billCurrency)
  const currencies = new Set(input.items.map(item => normalizeCurrency(item.currency)).filter(Boolean))
  const items = billCurrency
    ? input.items.filter(item => !item.currency || normalizeCurrency(item.currency) === billCurrency)
    : currencies.size <= 1 ? input.items : []
  const principalItems = items.filter(item =>
    (item.item_type === 'purchase' || item.item_type === 'fee' || item.item_type === 'interest') && item.amount > 0)
  const tier = principalItems.length ? 'A_items' : 'B_statement_fallback'
  const result = {
    applicable,
    tier,
    effective_amount: effective / 100,
    total_paid: paid / 100,
    remaining_amount: remaining <= 1 ? 0 : remaining / 100,
    min_payment: min > 0 ? min / 100 : null,
    min_payment_status: minimumStatus,
    uncovered_min: minimumStatus === 'uncovered' ? (min - paid) / 100 : 0,
    is_fully_paid: remaining <= 1,
    is_overdue: !!due && due < today && remaining > 1 && (!statement || statement <= today),
    estimated_interest: 0,
    daily_rate: dailyRate,
    estimate_date: today,
    used_fallback_date: false,
    interest_bearing_principal: 0,
  } as const
  if (!applicable || result.is_fully_paid) return result

  const slices = tier === 'A_items'
    ? principalItems.map(item => {
      const transaction = civilDay(item.transaction_date)
      return {
        start: transaction ?? civilDay(item.post_date) ?? statement ?? due ?? statementFallback,
        cents: toCents(item.amount),
        fallback: transaction === null,
      }
    }).sort((a, b) => a.start.localeCompare(b.start))
    : [{ start: statementFallback, cents: Math.max(0, effective), fallback: true }]

  if (tier === 'A_items') {
    let credits = items.reduce((sum, item) => sum + Math.max(0, -toCents(signedItemAmount(item))), 0)
    for (let index = slices.length - 1; index >= 0 && credits > 0; index--) {
      const deduction = Math.min(slices[index].cents, credits)
      slices[index].cents -= deduction
      credits -= deduction
    }
    // Known non-interest items still explain part of the statement total.
    const itemNet = items.reduce((sum, item) => sum + toCents(signedItemAmount(item)), 0)
    const unitemized = effective - itemNet
    if (unitemized > 0) {
      slices.push({ start: statementFallback, cents: unitemized, fallback: true })
      slices.sort((a, b) => a.start.localeCompare(b.start))
    }
  }

  let interestCents = 0
  let currentSlice = 0
  for (const payment of payments) {
    let unpaidPayment = payment.cents
    while (unpaidPayment > 0 && currentSlice < slices.length) {
      const slice = slices[currentSlice]
      const deduction = Math.min(unpaidPayment, slice.cents)
      interestCents += deduction * interestDays(slice.start, payment.date) * dailyRate
      slice.cents -= deduction
      unpaidPayment -= deduction
      if (slice.cents === 0) currentSlice++
    }
  }
  let bearingCents = 0
  for (const slice of slices.slice(currentSlice)) {
    interestCents += slice.cents * interestDays(slice.start, today) * dailyRate
    bearingCents += slice.cents
  }
  return {
    ...result,
    estimated_interest: roundMoney(interestCents / 100),
    used_fallback_date: slices.some(slice => slice.fallback),
    interest_bearing_principal: bearingCents / 100,
  }
}

export type BillRepaymentHealth = ReturnType<typeof estimateBillRepaymentHealth>

export function simulateRepaymentScenarios(input: RepaymentHealthInput, nextStatementDate: string) {
  const paymentDate = civilDay(input.estimateDate) ?? getLocalTodayString(BUSINESS_TIME_ZONE)
  const asOfToday = estimateBillRepaymentHealth({ ...input, estimateDate: paymentDate })
  const scenario = (amount: number) => {
    const additional = Math.min(asOfToday.remaining_amount, Math.max(0, roundMoney(amount)))
    const payments = additional > 0
      ? [...input.payments, { amount: additional, paid_at: paymentDate }]
      : input.payments
    const health = estimateBillRepaymentHealth({ ...input, payments, estimateDate: nextStatementDate })
    return { ...health, rollover_total: roundMoney(health.remaining_amount + health.estimated_interest) }
  }
  return {
    nextStatementDate,
    current: scenario(0),
    min_payment: scenario(asOfToday.uncovered_min),
    full_payment: scenario(asOfToday.remaining_amount),
    custom: scenario(input.customPayAmount ?? 0),
  }
}
