// lib/api/analytics.ts
import { db } from '../insforge'

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

  let query = db.from('credit_cards').select('id')
  if (filters.holder_id) query = query.eq('holder_id', filters.holder_id)
  if (filters.bank_name) query = query.eq('bank_name', filters.bank_name)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map(card => card.id as string)
}

async function getFilteredBills(filters: AnalyticsFilters) {
  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) return []

  let query = db
    .from('bills')
    .select('*, credit_cards(id, holder_id, bank_name, card_name, credit_limit, status)')
    .in('card_id', cardIds)

  if (filters.from_month) query = query.gte('bill_month', filters.from_month)
  if (filters.to_month) query = query.lte('bill_month', filters.to_month)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

async function getPaymentsForBillIds(billIds: string[]) {
  if (billIds.length === 0) return []
  const { data, error } = await db
    .from('payments')
    .select('bill_id, amount, paid_at')
    .in('bill_id', billIds)
  if (error) throw error
  return data || []
}

export async function getAnalyticsSummary(filters: AnalyticsFilters): Promise<AnalyticsSummary> {
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id as string)
  const payments = await getPaymentsForBillIds(billIds)

  const totalBillAmount = bills.reduce((sum, bill) => sum + (Number(bill.bill_amount) || 0), 0)
  const pendingBills = bills.filter(bill => ['unpaid', 'partial', 'overdue'].includes(bill.status))
  const pendingAmount = pendingBills.reduce((sum, bill) => sum + (Number(bill.bill_amount) || 0), 0)
  const paidAmount = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
  const overdueCount = bills.filter(bill => bill.status === 'overdue').length

  const cardIds = await getFilteredCardIds(filters)
  let totalCreditLimit = 0
  if (cardIds.length > 0) {
    const { data: cards, error } = await db
      .from('credit_cards')
      .select('credit_limit')
      .in('id', cardIds)
      .eq('status', 'active')
    if (error) throw error
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
  const billIds = bills.map(bill => bill.id as string)
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

  const billMonthById = new Map(bills.map(bill => [bill.id as string, bill.bill_month as string]))
  for (const payment of payments) {
    const month = billMonthById.get(payment.bill_id as string)
    if (!month) continue
    ensureMonth(month).paid_amount += Number(payment.amount) || 0
  }

  return Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
}

export async function getCategoryBreakdown(filters: AnalyticsFilters): Promise<CategoryBreakdown[]> {
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id as string)
  if (billIds.length === 0) return []

  const { data: items, error } = await db
    .from('bill_items')
    .select('amount, category, item_type')
    .in('bill_id', billIds)
  if (error) throw error
  if (!items) return []

  const categoryMap = new Map<string, number>()
  let totalAmount = 0

  for (const item of items) {
    const amount = Number(item.amount) || 0
    if (amount <= 0 || ['refund', 'payment', 'adjustment'].includes(item.item_type)) continue

    const category = item.category || '未分类'
    categoryMap.set(category, (categoryMap.get(category) || 0) + amount)
    totalAmount += amount
  }

  return Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export async function getBenefitUsageAnalytics(filters: AnalyticsFilters): Promise<BenefitUsageStats[]> {
  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) return []

  const { data: benefits, error } = await db
    .from('benefits')
    .select('*, benefit_usages(*)')
    .in('card_id', cardIds)
  if (error) throw error
  if (!benefits) return []

  return benefits.map(benefit => {
    const usedCount = benefit.benefit_usages?.length || 0
    return {
      benefit_id: benefit.id,
      benefit_name: benefit.name,
      quota: benefit.quota,
      used_count: usedCount,
      usage_rate: benefit.quota > 0 ? (usedCount / benefit.quota) * 100 : 0,
      expiry_date: benefit.expiry_date || undefined,
    }
  })
}

export async function getPromoUsageAnalytics(filters: AnalyticsFilters): Promise<PromoUsageStats[]> {
  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) return []

  const { data: usages, error } = await db
    .from('promo_usages')
    .select('promo:promos(title)')
    .in('card_id', cardIds)
  if (error) throw error
  if (!usages) return []

  const usageMap = new Map<string, number>()
  for (const usage of usages) {
    const promo = Array.isArray(usage.promo) ? usage.promo[0] : usage.promo
    const title = promo?.title || '未知优惠'
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
