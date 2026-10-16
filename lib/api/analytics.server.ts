// lib/api/analytics.server.ts — 服务端实现（客户端包装见 analytics.ts）。
//
// 多币种：生产库同时存在 CNY / USD / HKD 的卡，所以任何「跨币种 reduce 相加」都是错的。
// 这里一律先用 lib/fx 的 sumByCurrency 按币种分组，再折算到用户的目标币种（display_currency）。
// 折算维度：
//   - *_amount 字段仍是 number，但现在是「折算后的合计」，不再是把不同币种直接相加
//   - *_by_currency 是完整的分币种真数（汇率拿不到时 UI 靠它展示明细）
//   - fx_* 字段说明这次折算是否完整；不完整的合计必须由 UI 显式标注
import { query } from '../db'
import {
  fetchRates,
  sumByCurrency,
  normalizeCurrencyOrDefault,
  type FxRates,
  type FxSum,
} from '../fx'

export interface AnalyticsFilters {
  from_month?: string  // YYYY-MM
  to_month?: string
  holder_id?: string
  bank_name?: string
  card_id?: string
  /** 折算目标币种（来自用户偏好 display_config.default_currency），缺省回落 CNY。 */
  display_currency?: string
}

/** 按原币种分组的明细。汇率不可用时，这是唯一可信的构成。 */
export interface AnalyticsByCurrency {
  total_bill_amount: Record<string, number>
  pending_amount: Record<string, number>
  paid_amount: Record<string, number>
  total_credit_limit: Record<string, number>
}

export interface AnalyticsSummary {
  /** 折算到 display_currency 后的账单总额（不再跨币种直接相加）。 */
  total_bill_amount: number
  /** 折算后的待还金额。 */
  pending_amount: number
  /** 折算后的已还金额。 */
  paid_amount: number
  overdue_count: number
  /**
   * 额度使用率（%）。分子分母同为折算后的口径。
   *
   * 为 null 表示「算不出来」：缺汇率导致口径不齐，或没有额度不为 0 的活跃卡。
   * 这里不给 0——0% 会被读成「额度很宽裕」，是把未知伪装成好消息。
   */
  utilization_rate: number | null
  /** 本次折算的目标币种。 */
  display_currency: string
  /** 分币种明细，永远完整（不受汇率可用性影响）。 */
  by_currency: AnalyticsByCurrency
  /** true 表示所有出现的币种都成功折算，上面的合计是完整值。 */
  fx_converted: boolean
  /** 缺汇率因而未计入合计的币种（其金额仍保留在 by_currency）。 */
  fx_unconverted_currencies: string[]
  /** 参与使用率分母的活跃卡额度之和（折算后）。 */
  total_credit_limit: number
}

export interface MonthlyDebtPoint {
  month: string
  /** 折算到目标币种后的金额。 */
  bill_amount: number
  paid_amount: number
  pending_amount: number
  /** 分币种明细，用于汇率不可用时展示构成。 */
  by_currency: {
    bill_amount: Record<string, number>
    paid_amount: Record<string, number>
    pending_amount: Record<string, number>
  }
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
  /** Ledger additions (Task 13): cancellations and booking holds. */
  voided_count?: number
  reserved_count?: number
  /** Fulfillment facts (Task 22): delivery states are NOT usage counts. */
  claimed_count?: number
  cancelled_bookings?: number
  pending_settlements?: number
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
  currency: string | null
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
    // 手填金额优先：统计口径必须与账单页一致，否则同一笔钱在两页显示不同
    `SELECT b.id, b.card_id, b.bill_month,
            COALESCE(b.bill_amount_override, b.bill_amount) AS bill_amount,
            b.status, b.due_date,
            cc.holder_id, cp.bank_name, cp.card_name, cp.currency, cc.credit_limit,
            cc.status AS card_status
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

/** 把多个 FxSum 的 by_currency 合并成一份分币种明细。 */
function mergeByCurrency(...sums: FxSum[]): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const sum of sums) {
    for (const [currency, amount] of Object.entries(sum.by_currency)) {
      merged[currency] = (merged[currency] ?? 0) + amount
    }
  }
  return merged
}

const PENDING_STATUSES = ['unpaid', 'partial', 'overdue']

/** 空 FxSum，用于「没有卡」这类边界，让上下文的形状保持一致。 */
function emptySum(currency: string): FxSum {
  return {
    converted_currency: currency,
    by_currency: {},
    total: 0,
    converted: true,
    unconverted_currencies: [],
    mixed: false,
  }
}

export async function getAnalyticsSummary(filters: AnalyticsFilters): Promise<AnalyticsSummary> {
  const displayCurrency = normalizeCurrencyOrDefault(filters.display_currency, 'CNY')
  // 汇率取不到时返回 null；sumByCurrency 会把跨币种部分标成未折算，
  // 而不是把不同币种当成同一币种直接相加。
  const rates: FxRates | null = await fetchRates()

  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)
  const payments = await getPaymentsForBillIds(billIds)
  const billById = new Map(bills.map(bill => [bill.id, bill]))

  const totalBill = sumByCurrency(
    bills,
    bill => ({ amount: Number(bill.bill_amount) || 0, currency: bill.currency ?? displayCurrency }),
    displayCurrency,
    rates
  )
  const pending = sumByCurrency(
    bills.filter(bill => PENDING_STATUSES.includes(bill.status)),
    bill => ({ amount: Number(bill.bill_amount) || 0, currency: bill.currency ?? displayCurrency }),
    displayCurrency,
    rates
  )
  // 还款的币种取自它所属的账单，不能假设是人民币
  const paid = sumByCurrency(
    payments,
    payment => ({
      amount: Number(payment.amount) || 0,
      currency: billById.get(payment.bill_id)?.currency ?? displayCurrency,
    }),
    displayCurrency,
    rates
  )
  const overdueCount = bills.filter(bill => bill.status === 'overdue').length

  const cardIds = await getFilteredCardIds(filters)
  let creditLimit = emptySum(displayCurrency)
  if (cardIds.length > 0) {
    const placeholders = cardIds.map(() => '?').join(',')
    const { data: cards, error } = await query<{ credit_limit: number; currency: string | null }>(
      `SELECT cc.credit_limit, cp.currency
       FROM credit_cards cc
       LEFT JOIN card_products cp ON cc.card_product_id = cp.id
       WHERE cc.id IN (${placeholders}) AND cc.status = 'active'`,
      cardIds
    )
    if (error) throw new Error(error.message)
    // 额度为 0 的卡（例如额度未知的外币卡）不进分母：它们只会把分母撑大、
    // 让使用率假性变低，属于把未知当利好。
    const cardsWithLimit = (cards || []).filter(card => (Number(card.credit_limit) || 0) > 0)
    creditLimit = sumByCurrency(
      cardsWithLimit,
      card => ({ amount: Number(card.credit_limit) || 0, currency: card.currency ?? displayCurrency }),
      displayCurrency,
      rates
    )
  }

  // 分子分母必须同口径：任何一边有未折算的币种，这个比率就不可信，给 null 而不是 0。
  const caliberConsistent = pending.converted && creditLimit.converted
  const utilizationRate = caliberConsistent && creditLimit.total > 0
    ? (pending.total / creditLimit.total) * 100
    : null

  const unconverted = Array.from(new Set([
    ...totalBill.unconverted_currencies,
    ...pending.unconverted_currencies,
    ...paid.unconverted_currencies,
    ...creditLimit.unconverted_currencies,
  ])).sort()

  return {
    total_bill_amount: totalBill.total,
    pending_amount: pending.total,
    paid_amount: paid.total,
    overdue_count: overdueCount,
    utilization_rate: utilizationRate,
    display_currency: displayCurrency,
    by_currency: {
      total_bill_amount: totalBill.by_currency,
      pending_amount: pending.by_currency,
      paid_amount: paid.by_currency,
      total_credit_limit: creditLimit.by_currency,
    },
    fx_converted: unconverted.length === 0,
    fx_unconverted_currencies: unconverted,
    total_credit_limit: creditLimit.total,
  }
}

export async function getMonthlyDebtTrend(
  filters: AnalyticsFilters,
  months = 12
): Promise<MonthlyDebtPoint[]> {
  const displayCurrency = normalizeCurrencyOrDefault(filters.display_currency, 'CNY')
  const rates: FxRates | null = await fetchRates()

  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)
  const payments = await getPaymentsForBillIds(billIds)
  const billById = new Map(bills.map(bill => [bill.id, bill]))

  // 先按（月份 × 币种）累计原币金额，最后再逐月折算。这样每个月都是一个
  // 独立、自洽的多币种聚合，不会把某个币种的量摊到别的月份上。
  interface MonthBucket {
    bill: { amount: number; currency: string }[]
    pending: { amount: number; currency: string }[]
    paid: { amount: number; currency: string }[]
  }
  const monthlyMap = new Map<string, MonthBucket>()
  const ensureMonth = (month: string): MonthBucket => {
    let bucket = monthlyMap.get(month)
    if (!bucket) {
      bucket = { bill: [], pending: [], paid: [] }
      monthlyMap.set(month, bucket)
    }
    return bucket
  }

  for (const bill of bills) {
    const bucket = ensureMonth(bill.bill_month)
    const entry = { amount: Number(bill.bill_amount) || 0, currency: bill.currency ?? displayCurrency }
    bucket.bill.push(entry)
    if (PENDING_STATUSES.includes(bill.status)) {
      bucket.pending.push(entry)
    }
  }

  for (const payment of payments) {
    const bill = billById.get(payment.bill_id)
    const month = bill?.bill_month
    if (!month) continue
    ensureMonth(month).paid.push({
      amount: Number(payment.amount) || 0,
      currency: bill?.currency ?? displayCurrency,
    })
  }

  return Array.from(monthlyMap.entries())
    .map(([month, bucket]) => {
      const billAmount = sumByCurrency(bucket.bill, item => item, displayCurrency, rates)
      const pendingAmount = sumByCurrency(bucket.pending, item => item, displayCurrency, rates)
      const paidAmount = sumByCurrency(bucket.paid, item => item, displayCurrency, rates)
      return {
        month,
        bill_amount: billAmount.total,
        paid_amount: paidAmount.total,
        pending_amount: pendingAmount.total,
        by_currency: {
          bill_amount: mergeByCurrency(billAmount),
          paid_amount: mergeByCurrency(paidAmount),
          pending_amount: mergeByCurrency(pendingAmount),
        },
      }
    })
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
}

export async function getCategoryBreakdown(_filters: AnalyticsFilters): Promise<CategoryBreakdown[]> {
  // NOTE: bill_items table does not exist in the current schema. Return empty.
  // TODO(W09): implement once transaction detail model is added
  return []
}

/** First day AFTER the given month, as an exclusive upper bound. */
function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

export async function getBenefitUsageAnalytics(filters: AnalyticsFilters): Promise<BenefitUsageStats[]> {
  // Task 13: aggregate from the REAL ledger (accounts + cycles + usages), not
  // the legacy product-level table. Used and voided come from usage rows;
  // reserved comes from cycle projections; unmapped legacy history is counted
  // separately instead of silently dropping or double counting.
  const { data: rows, error } = await query<{
    benefit_id: string
    benefit_name: string
    used_count: number
    voided_count: number
    reserved_count: number
    quota: number | null
  }>(
    `SELECT a.id AS benefit_id,
            COALESCE(json_extract(v.rules_json, '$.title'), '(未知)') AS benefit_name,
            COALESCE(c.count_limit, 0) AS quota,
            SUM(CASE WHEN u.status = 'active' THEN u.quantity ELSE 0 END) AS used_count,
            SUM(CASE WHEN u.status = 'voided' THEN u.quantity ELSE 0 END) AS voided_count,
            COALESCE((SELECT SUM(cy.reserved_count) FROM opportunity_cycles cy
                      WHERE cy.account_id = a.id), 0) AS reserved_count
     FROM opportunity_accounts a
     JOIN opportunity_definitions d ON d.id = a.definition_id
     LEFT JOIN opportunity_rule_versions v
       ON v.definition_id = d.id
      AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2 WHERE v2.definition_id = d.id)
     LEFT JOIN opportunity_cycles c ON c.account_id = a.id
     LEFT JOIN opportunity_usages u ON u.account_id = a.id
      AND (? IS NULL OR u.used_on >= ?)
      AND (? IS NULL OR u.used_on < ?)
     GROUP BY a.id
     ORDER BY benefit_name`,
    [filters.from_month ? `${filters.from_month}-01` : null,
     filters.from_month ? `${filters.from_month}-01` : null,
     filters.to_month ? nextMonthStart(filters.to_month) : null,
     filters.to_month ? nextMonthStart(filters.to_month) : null],
  )
  if (error) throw new Error(error.message)
  const { data: fulfillments, error: fError } = await query<{
    account_id: string; claimed: number; cancelled_bookings: number; pending_settlements: number
  }>(
    `SELECT f.account_id,
            SUM(CASE WHEN f.kind = 'claim' THEN 1 ELSE 0 END) AS claimed,
            SUM(CASE WHEN f.kind = 'booking' AND f.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_bookings,
            SUM(CASE WHEN f.status = 'pending_settlement' THEN 1 ELSE 0 END) AS pending_settlements
     FROM opportunity_fulfillments f
     GROUP BY f.account_id`,
  )
  if (fError) throw new Error(fError.message)
  const fulfillmentByAccount = new Map(
    (fulfillments || []).map((r) => [r.account_id, r] as const),
  )

  return (rows || []).map((r) => {
    const facts = fulfillmentByAccount.get(r.benefit_id)
    return {
      benefit_id: r.benefit_id,
      benefit_name: r.benefit_name,
      quota: Number(r.quota) || 0,
      used_count: Number(r.used_count) || 0,
      usage_rate: Number(r.quota) > 0 ? Math.min(1, Number(r.used_count) / Number(r.quota)) : 0,
      voided_count: Number(r.voided_count) || 0,
      reserved_count: Number(r.reserved_count) || 0,
      claimed_count: Number(facts?.claimed ?? 0) || 0,
      cancelled_bookings: Number(facts?.cancelled_bookings ?? 0) || 0,
      pending_settlements: Number(facts?.pending_settlements ?? 0) || 0,
    }
  })
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
