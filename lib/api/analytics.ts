// lib/api/analytics.ts
import { query } from '../db'

export interface AnalyticsFilters {
  from_month?: string  // YYYY-MM
  to_month?: string
  holder_id?: string
  bank_name?: string
  card_id?: string
}

export interface AnalyticsSummary {
  total_bill_amount: number
  pending_amount: number
  paid_amount: number
  overdue_count: number
  utilization_rate: number
}

export interface MonthlyDebtPoint {
  month: string
  bill_amount: number
  paid_amount: number
  pending_amount: number
}

export interface CategoryBreakdown {
  category: string
  amount: number
  percentage: number
}

export interface BenefitUsageStats {
  benefit_id: string
  benefit_name: string
  quota: number
  used_count: number
  usage_rate: number
  expiry_date?: string
}

export interface PromoUsageStats {
  promo_name: string
  usage_count: number
}

async function getFilteredCardIds(filters: AnalyticsFilters): Promise<string[]> {
  if (filters.card_id) return [filters.card_id]
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.holder_id) {
    conditions.push('cc.holder_id = ?')
    params.push(filters.holder_id)
  }
  if (filters.bank_name) {
    conditions.push('cp.bank_name = ?')
    params.push(filters.bank_name)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const { data, error } = await query<{ id: string }>(
    `SELECT cc.id FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id${where}`,
    params
  )
  if (error) throw new Error(error.message)
  return (data || []).map(card => card.id)
}

interface BillRow {
  id: string
  card_id: string
  bill_month: string
  bill_amount: number
  status: string
  due_date: string
  holder_id: string
  bank_name: string | null
  card_name: string | null
  credit_limit: number
  card_status: string
}

async function getFilteredBills(filters: AnalyticsFilters): Promise<BillRow[]> {
  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) return []

  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.from_month) {
    conditions.push('b.bill_month >= ?')
    params.push(filters.from_month)
  }
  if (filters.to_month) {
    conditions.push('b.bill_month <= ?')
    params.push(filters.to_month)
  }
  const cardPlaceholders = cardIds.map(() => '?').join(',')
  const where = conditions.length > 0
    ? ` AND ${conditions.join(' AND ')}`
    : ''
  const fullWhere = `WHERE b.card_id IN (${cardPlaceholders})${where}`

  const { data, error } = await query<BillRow>(
    `SELECT b.id, b.card_id, b.bill_month, b.bill_amount, b.status, b.due_date,
            cc.holder_id, cp.bank_name, cp.card_name, cc.credit_limit, cc.status AS card_status
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     ${fullWhere}`,
    [...cardIds, ...params]
  )
  if (error) throw new Error(error.message)
  return data || []
}

async function getPaymentsForBillIds(billIds: string[]) {
  if (billIds.length === 0) return []
  const placeholders = billIds.map(() => '?').join(',')
  const { data, error } = await query<{ bill_id: string; amount: number; paid_at: string }>(
    `SELECT bill_id, amount, paid_at FROM payments WHERE bill_id IN (${placeholders})`,
    billIds
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function getAnalyticsSummary(filters: AnalyticsFilters): Promise<AnalyticsSummary> {
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)
  const payments = await getPaymentsForBillIds(billIds)

  const totalBillAmount = bills.reduce((sum, bill) => sum + (Number(bill.bill_amount) || 0), 0)
  const pendingBills = bills.filter(bill => ['unpaid', 'partial', 'overdue'].includes(bill.status))
  const pendingAmount = pendingBills.reduce((sum, bill) => sum + (Number(bill.bill_amount) || 0), 0)
  const paidAmount = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
  const overdueCount = bills.filter(bill => bill.status === 'overdue').length

  const cardIds = await getFilteredCardIds(filters)
  let totalCreditLimit = 0
  if (cardIds.length > 0) {
    const placeholders = cardIds.map(() => '?').join(',')
    const { data: cards, error } = await query<{ credit_limit: number }>(
      `SELECT credit_limit FROM credit_cards WHERE id IN (${placeholders}) AND status = 'active'`,
      cardIds
    )
    if (error) throw new Error(error.message)
    totalCreditLimit = (cards || []).reduce((sum, card) => sum + (Number(card.credit_limit) || 0), 0)
  }

  return {
    total_bill_amount: totalBillAmount,
    pending_amount: pendingAmount,
    paid_amount: paidAmount,
    overdue_count: overdueCount,
    utilization_rate: totalCreditLimit > 0 ? (pendingAmount / totalCreditLimit) * 100 : 0,
  }
}

export async function getMonthlyDebtTrend(
  filters: AnalyticsFilters,
  months = 12
): Promise<MonthlyDebtPoint[]> {
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)
  const payments = await getPaymentsForBillIds(billIds)

  const monthlyMap = new Map<string, MonthlyDebtPoint>()
  const ensureMonth = (month: string) => {
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { month, bill_amount: 0, paid_amount: 0, pending_amount: 0 })
    }
    return monthlyMap.get(month)!
  }

  for (const bill of bills) {
    const point = ensureMonth(bill.bill_month)
    point.bill_amount += Number(bill.bill_amount) || 0
    if (['unpaid', 'partial', 'overdue'].includes(bill.status)) {
      point.pending_amount += Number(bill.bill_amount) || 0
    }
  }

  const billMonthById = new Map(bills.map(bill => [bill.id, bill.bill_month]))
  for (const payment of payments) {
    const month = billMonthById.get(payment.bill_id)
    if (!month) continue
    ensureMonth(month).paid_amount += Number(payment.amount) || 0
  }

  return Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
}

export async function getCategoryBreakdown(filters: AnalyticsFilters): Promise<CategoryBreakdown[]> {
  // NOTE: bill_items table does not exist in the current schema. Return empty.
  // TODO(W09): implement once transaction detail model is added
  return []
}

export async function getBenefitUsageAnalytics(filters: AnalyticsFilters): Promise<BenefitUsageStats[]> {
  // NOTE: benefits table has no card_id; it's per-product. Return usage by product instead.
  // TODO(W12): implement properly when benefit instance model is added
  return []
}

export async function getPromoUsageAnalytics(filters: AnalyticsFilters): Promise<PromoUsageStats[]> {
  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) return []

  const placeholders = cardIds.map(() => '?').join(',')
  const { data: usages, error } = await query<{ title: string | null }>(
    `SELECT p.title
     FROM promo_usages pu
     JOIN promos p ON pu.promo_id = p.id
     WHERE pu.card_id IN (${placeholders})`,
    cardIds
  )
  if (error) throw new Error(error.message)

  const usageMap = new Map<string, number>()
  for (const usage of usages || []) {
    const title = usage.title || '未知优惠'
    usageMap.set(title, (usageMap.get(title) || 0) + 1)
  }

  return Array.from(usageMap.entries())
    .map(([promo_name, usage_count]) => ({ promo_name, usage_count }))
    .sort((a, b) => b.usage_count - a.usage_count)
}

export async function getAnalyticsByHolder(holderId: string, startDate: string, endDate: string) {
  const fromMonth = startDate.slice(0, 7)
  const toMonth = endDate.slice(0, 7)
  const filters: AnalyticsFilters = { holder_id: holderId, from_month: fromMonth, to_month: toMonth }

  const [summary, monthlyTrend, categoryBreakdown, benefitUsage, promoUsage] = await Promise.all([
    getAnalyticsSummary(filters),
    getMonthlyDebtTrend(filters, 12),
    getCategoryBreakdown(filters),
    getBenefitUsageAnalytics(filters),
    getPromoUsageAnalytics(filters),
  ])

  return { summary, monthlyTrend, categoryBreakdown, benefitUsage, promoUsage }
}
