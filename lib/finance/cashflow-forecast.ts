import { format } from 'date-fns'
import { normalizeCurrencyOrDefault, sumByCurrency, type FxRates } from '../fx'
import type { InstallmentPlan } from '../types'
import { addMonthsToPayablePeriod, billEffectiveDueDate, billEffectiveStatementDate, getLocalTodayString, nextPayablePeriodOf, payableDueDate, payablePeriodOf } from '../utils'
import { buildExistingBillScopes, computeActiveInstallmentsExposure } from './installments'
import { roundMoney, toCents } from './money'

export const CASHFLOW_HORIZONS = [30, 60, 90] as const
export type CashflowHorizon = (typeof CASHFLOW_HORIZONS)[number]
export type CashflowSource = 'bill' | 'installment' | 'payable'

interface ForecastBill {
  id: string
  card_id: string
  account_id?: string | null
  holder_id?: string | null
  card_tail?: string | null
  card_type?: 'credit' | 'loan'
  title?: string
  bill_month: string
  due_date: string
  due_date_override?: string | null
  statement_date?: string | null
  statement_date_override?: string | null
  statement_end?: string | null
  status: string
  remaining_amount: number
  currency: string
}

type ForecastPayable = NonNullable<Parameters<typeof payablePeriodOf>[1]> & {
  id: string
  name: string
  amount: number
  currency: string
  due_day: number
  is_active: boolean | number
  holder_id?: string | null
}

export interface CashflowForecastInput {
  bills: readonly ForecastBill[]
  installments: readonly InstallmentPlan[]
  payables: readonly ForecastPayable[]
  horizonDays: CashflowHorizon
  baseDate?: string
  displayCurrency?: string
  rates?: FxRates | null
  existingBillScopes?: ReadonlySet<string>
  cardAccountMap?: ReadonlyMap<string, string | null>
  paidByPayablePeriod?: ReadonlyMap<string, number>
}

export interface CashflowEvent {
  source: CashflowSource
  ref_id: string
  title: string
  due_date: string
  days_until_due: number
  amount: number
  currency: string
  holder_id?: string | null
  card_tail?: string | null
  period?: string
}

interface CashflowAmounts {
  bill: number
  installment: number
  payable: number
  total: number
}

function emptyAmounts(): CashflowAmounts {
  return { bill: 0, installment: 0, payable: 0, total: 0 }
}

const DAY_MS = 86_400_000
const sources: readonly CashflowSource[] = ['bill', 'installment', 'payable']
const weeks = [
  ['今日', 0, 0], ['1-7天', 1, 7], ['8-14天', 8, 14], ['15-21天', 15, 21], ['22-30天', 22, 30],
] as const

function shiftDate(day: string, offset: number): string {
  return new Date(Date.parse(day) + offset * DAY_MS).toISOString().slice(0, 10)
}

function forecastBuckets(baseDate: string, horizonDays: CashflowHorizon) {
  if (horizonDays === 30) return weeks.map(([label, from, to]) => ({
    label, start_date: shiftDate(baseDate, from), end_date: shiftDate(baseDate, to),
  }))
  const endDate = shiftDate(baseDate, horizonDays)
  const months = []
  for (let month = baseDate.slice(0, 7); month <= endDate.slice(0, 7); month = addMonthsToPayablePeriod(month, 1)) {
    months.push({
      label: month,
      start_date: month + '-01',
      end_date: shiftDate(addMonthsToPayablePeriod(month, 1) + '-01', -1),
    })
  }
  return months
}

/** Inputs are household-scoped by the service before entering this calculation. */
export function buildCashflowForecast(input: CashflowForecastInput) {
  const baseDate = input.baseDate ?? getLocalTodayString('Asia/Shanghai')
  const target = normalizeCurrencyOrDefault(input.displayCurrency, 'CNY')
  const { horizonDays } = input
  const issuedBills = input.bills.filter(bill => {
    const statement = billEffectiveStatementDate(bill) || bill.statement_end
    return !statement || statement.slice(0, 10) <= baseDate
  })
  const scopes = input.existingBillScopes ?? buildExistingBillScopes(issuedBills)
  const exposure = computeActiveInstallmentsExposure(input.installments, scopes, input.cardAccountMap)
  const timeline: CashflowEvent[] = []
  const overdue: CashflowEvent[] = []

  function addEvent(raw: Omit<CashflowEvent, 'days_until_due'>, allowOverdue = true) {
    const due = raw.due_date.slice(0, 10)
    const days = (Date.parse(due) - Date.parse(baseDate)) / DAY_MS
    if (!Number.isFinite(days) || days > horizonDays || toCents(raw.amount) <= (raw.source === 'installment' ? 0 : 1)) return
    const event = {
      ...raw,
      due_date: due,
      days_until_due: days,
      currency: normalizeCurrencyOrDefault(raw.currency, target),
      amount: roundMoney(raw.amount),
    }
    if (days >= 0) timeline.push(event)
    else if (allowOverdue) overdue.push(event)
  }

  for (const bill of issuedBills) {
    if (bill.status === 'paid' || bill.card_type === 'loan') continue
    addEvent({
      source: 'bill', ref_id: bill.id, title: bill.title ?? bill.bill_month + ' 信用卡账单',
      due_date: billEffectiveDueDate(bill), amount: bill.remaining_amount, currency: bill.currency,
      holder_id: bill.holder_id, card_tail: bill.card_tail,
    })
  }

  for (const plan of input.installments) {
    const periods = exposure.unbilledByCardAndPlan.get(plan.id)?.periods ?? []
    for (const period of periods) {
      if (period.covered_by_statement) continue
      addEvent({
        source: 'installment', ref_id: plan.id, title: plan.title,
        due_date: period.due_date, amount: period.total, currency: plan.currency, period: period.bill_month,
      }, plan.billing_mode === 'independent')
    }
  }

  // Construct a local civil date for the existing recurrence helpers, avoiding UTC/DST shifts.
  const [year, month, day] = baseDate.split('-').map(Number)
  const civilToday = new Date(year, month - 1, day)
  const endDate = shiftDate(baseDate, horizonDays)
  for (const payable of input.payables) {
    if (!payable.is_active) continue
    let period = payablePeriodOf(civilToday, payable)
    for (let iteration = 0; iteration < 6; iteration++, period = nextPayablePeriodOf(period, payable)) {
      const due = format(payableDueDate(payable.due_day, period), 'yyyy-MM-dd')
      if (due > endDate) break
      const paid = input.paidByPayablePeriod?.get([payable.id, period].join(':')) ?? 0
      addEvent({
        source: 'payable', ref_id: payable.id, title: payable.name,
        due_date: due, amount: roundMoney(payable.amount - paid), currency: payable.currency,
        holder_id: payable.holder_id, period,
      })
    }
  }
  const byDate = (a: CashflowEvent, b: CashflowEvent) => a.due_date.localeCompare(b.due_date)
  timeline.sort(byDate)
  overdue.sort(byDate)

  const reserves: Record<string, CashflowAmounts> = {}
  for (const event of timeline) {
    const group = reserves[event.currency] ??= emptyAmounts()
    const cents = toCents(event.amount)
    group[event.source] += cents
    group.total += cents
  }
  for (const group of Object.values(reserves)) {
    for (const source of sources) group[source] /= 100
    group.total /= 100
  }
  const summarize = (events: readonly CashflowEvent[]) => {
    const fx = sumByCurrency(events, event => event, target, input.rates)
    return {
      ...fx,
      by_currency: Object.fromEntries(Object.entries(fx.by_currency).map(([key, value]) => [key, roundMoney(value)])),
      total: roundMoney(fx.total),
    }
  }
  const overdueFx = summarize(overdue)
  return {
    base_date: baseDate,
    horizon_days: horizonDays,
    display_currency: target,
    reserves_by_currency: reserves,
    converted_summary: summarize(timeline),
    buckets: forecastBuckets(baseDate, horizonDays).map(range => {
      const events = timeline.filter(event => event.due_date >= range.start_date && event.due_date <= range.end_date)
      const fx = summarize(events)
      return {
        ...range,
        ...Object.fromEntries(sources.map(source => [source, summarize(events.filter(event => event.source === source)).total])) as Record<CashflowSource, number>,
        total: fx.total,
        by_currency: fx.by_currency,
      }
    }),
    timeline,
    overdue_alert: {
      count: overdue.length,
      by_currency: overdueFx.by_currency,
      total_converted: overdueFx.total,
      fx_converted: overdueFx.converted,
      items: overdue,
    },
  }
}

export type CashflowForecastResult = ReturnType<typeof buildCashflowForecast>
