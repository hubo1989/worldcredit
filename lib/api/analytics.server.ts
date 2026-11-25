// lib/api/analytics.server.ts — 服务端实现（客户端包装见 analytics.ts）。
//
// 多币种：生产库同时存在 CNY / USD / HKD 的卡，所以任何「跨币种 reduce 相加」都是错的。
// 这里一律先用 lib/fx 的 sumByCurrency 按币种分组，再折算到用户的目标币种（display_currency）。
// 折算维度：
//   - *_amount 字段仍是 number，但现在是「折算后的合计」，不再是把不同币种直接相加
//   - *_by_currency 是完整的分币种真数（汇率拿不到时 UI 靠它展示明细）
//   - fx_* 字段说明这次折算是否完整；不完整的合计必须由 UI 显式标注
import { query, queryByChunks } from '../db'
import {
  fetchRates,
  sumByCurrency,
  normalizeCurrencyOrDefault,
  type FxRates,
  type FxSum,
} from '../fx'
import {
  addMonthsToPayablePeriod,
  billEffectiveDueDate,
  diffInCalendarDays,
  effectiveBillAmount,
  getLocalTodayString,
  isBillUnissued,
  nextPayablePeriodOf,
  payableDueDate,
  payablePeriodOf,
} from '../utils'
import {
  bucketLabelForDate,
  bucketRange,
  categoryLabel,
  generateInstallmentSchedule,
  normalizeMerchantKey,
  orderedBucketLabels,
  round2,
  UNCATEGORIZED_KEY,
  type CashflowEvent,
  type CashflowForecastFilters,
  type CashflowForecastResult,
  type CashflowHorizon,
  type InstallmentPlanLike,
  type LockedPaymentLike,
  type PaymentFxLock,
} from './direction3.shared'
import { sumPaymentsWithLockedFx } from './direction3.shared'
import type { Payment } from '../types'

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
  /** 中文标签；旧调用方不读它，新 UI 直接展示。 */
  category_label?: string
  item_count?: number
  /** 原币分币种真数（缺汇率时唯一可信的构成）。 */
  by_currency?: Record<string, number>
  fx_converted?: boolean
  fx_unconverted_currencies?: string[]
  meta_covered_bills?: number
  meta_total_bills?: number
  meta_unallocated_refunds?: Record<string, number>
}

export interface CategoryBreakdownReport {
  items: CategoryBreakdown[]
  /** 无法归属到任何分类的退款（按原币），不参与分类占比。 */
  unallocated_refunds_by_currency: Record<string, number>
  covered_bills: number
  total_bills: number
  fx_converted: boolean
  fx_unconverted_currencies: string[]
  display_currency: string
  /** 折算后的分类总额（不含无法归属的退款）。 */
  total_amount: number
}

export interface CategoryDrilldownItem {
  item_id: string
  bill_id: string
  bill_month: string
  holder_id: string
  bank_name: string | null
  card_name: string | null
  card_tail: string | null
  description: string
  merchant_name: string | null
  category: string
  item_type: string
  /** 带符号净额：退款为负。 */
  amount: number
  currency: string
  transaction_date: string | null
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
  account_id?: string | null
  bill_month: string
  bill_amount: number
  status: string
  due_date: string
  due_date_override?: string | null
  statement_date?: string | null
  statement_date_override?: string | null
  statement_end?: string | null
  card_number_last4?: string | null
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
  const where = conditions.length > 0
    ? ` AND ${conditions.join(' AND ')}`
    : ''

  const { data, error } = await queryByChunks<BillRow>(cardIds, (chunk, placeholders) => ({
    // 手填金额优先：统计口径必须与账单页一致，否则同一笔钱在两页显示不同
    sql: `SELECT b.id, b.card_id, b.account_id, b.bill_month,
            COALESCE(b.bill_amount_override, b.bill_amount) AS bill_amount,
            b.status, b.due_date, b.due_date_override,
            b.statement_date, b.statement_date_override, b.statement_end,
            cc.card_number_last4,
            cc.holder_id, cp.bank_name, cp.card_name, cp.currency, cc.credit_limit,
            cc.status AS card_status
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE b.card_id IN (${placeholders})${where}`,
    params: [...chunk, ...params],
  }))
  if (error) throw new Error(error.message)
  return data || []
}

async function getPaymentsForBillIds(billIds: string[]) {
  if (billIds.length === 0) return []
  // SELECT * 而不是显式列出锁定三列：0042 之前的老库没有这些列，
  // 显式列名会让整条查询直接失败；SELECT * 在老库上只是少几个字段。
  const { data, error } = await queryByChunks<Payment & Partial<PaymentFxLock>>(
    billIds,
    (chunk, placeholders) => ({
      sql: `SELECT * FROM payments WHERE bill_id IN (${placeholders})`,
      params: chunk,
    })
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
  // 历史已还：锁定过实付币种/金额的还款直接按实付金额计入，免疫实时汇率漂移
  const paid = sumPaymentsWithLockedFx(
    payments.map(payment => ({
      amount: Number(payment.amount) || 0,
      bill_currency: billById.get(payment.bill_id)?.currency ?? displayCurrency,
      settled_currency: payment.settled_currency ?? null,
      settled_amount: payment.settled_amount ?? null,
      locked_fx_rate: payment.locked_fx_rate ?? null,
    })),
    displayCurrency,
    rates
  )
  const overdueCount = bills.filter(bill => bill.status === 'overdue').length

  const cardIds = await getFilteredCardIds(filters)
  let creditLimit = emptySum(displayCurrency)
  if (cardIds.length > 0) {
    const { data: cards, error } = await queryByChunks<{
      id: string
      holder_id: string
      credit_limit: number
      account_id: string | null
      currency: string | null
      bank_id: string | null
      bank_name: string | null
      account_quota_mode: string | null
      shared_credit_limit: number | null
      bank_quota_mode: string | null
    }>(cardIds, (chunk, placeholders) => ({
      sql: `SELECT cc.id, cc.holder_id, cc.credit_limit, cc.account_id,
              cp.currency, cp.bank_id, cp.bank_name,
              ca.quota_mode AS account_quota_mode, ca.shared_credit_limit,
              b.quota_mode AS bank_quota_mode
       FROM credit_cards cc
       LEFT JOIN card_products cp ON cc.card_product_id = cp.id
       LEFT JOIN banks b ON cp.bank_id = b.id
       LEFT JOIN credit_accounts ca ON cc.account_id = ca.id
       WHERE cc.id IN (${placeholders}) AND cc.status = 'active'`,
      params: chunk,
    }))
    if (error) throw new Error(error.message)

    // 两级聚合：独立账户/卡逐卡累加，共享额度池同一 (holder_id, bank, currency) 每池仅计 1 次
    const limitItems: Array<{ amount: number; currency: string }> = []
    const sharedPools: Record<string, { currency: string; sharedLimit?: number; maxCardLimit: number }> = {}

    for (const card of cards || []) {
      const cardLimit = Number(card.credit_limit) || 0
      const isShared =
        card.account_quota_mode === 'shared' ||
        (!card.account_quota_mode && card.bank_quota_mode === 'shared')

      if (!isShared) {
        if (cardLimit > 0) {
          limitItems.push({
            amount: cardLimit,
            currency: card.currency ?? displayCurrency,
          })
        }
      } else {
        const bankKey = card.bank_id || card.bank_name || 'unknown'
        const poolKey = `${card.holder_id}_${bankKey}_${card.currency ?? displayCurrency}`
        if (!sharedPools[poolKey]) {
          sharedPools[poolKey] = {
            currency: card.currency ?? displayCurrency,
            sharedLimit:
              card.shared_credit_limit != null ? Number(card.shared_credit_limit) : undefined,
            maxCardLimit: cardLimit,
          }
        } else {
          if (card.shared_credit_limit != null) {
            sharedPools[poolKey].sharedLimit = Math.max(
              sharedPools[poolKey].sharedLimit ?? 0,
              Number(card.shared_credit_limit)
            )
          }
          sharedPools[poolKey].maxCardLimit = Math.max(
            sharedPools[poolKey].maxCardLimit,
            cardLimit
          )
        }
      }
    }

    for (const pool of Object.values(sharedPools)) {
      const poolAmount = pool.sharedLimit ?? pool.maxCardLimit
      if (poolAmount > 0) {
        limitItems.push({
          amount: poolAmount,
          currency: pool.currency,
        })
      }
    }

    creditLimit = sumByCurrency(
      limitItems,
      item => item,
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
    paid: LockedPaymentLike[]
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
      bill_currency: bill?.currency ?? displayCurrency,
      settled_currency: payment.settled_currency ?? null,
      settled_amount: payment.settled_amount ?? null,
      locked_fx_rate: payment.locked_fx_rate ?? null,
    })
  }

  return Array.from(monthlyMap.entries())
    .map(([month, bucket]) => {
      const billAmount = sumByCurrency(bucket.bill, item => item, displayCurrency, rates)
      const pendingAmount = sumByCurrency(bucket.pending, item => item, displayCurrency, rates)
      const paidAmount = sumPaymentsWithLockedFx(bucket.paid, displayCurrency, rates)
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

interface ItemAggregateRow {
  bill_id: string
  currency: string
  category: string
  item_type: string
  merchant_key: string | null
  amount: number
  item_count: number
}

/**
 * 分类聚合的三次分片查询（固定 3 次 D1 往返，与账单数量无关）：
 *   1) 正向消费按 (bill, currency, category) 汇总；
 *   2) 退款按 (bill, currency, category, merchant) 汇总（用于同商户回冲）；
 *   3) 已分类消费按 (bill, currency, category, merchant) 汇总（用于无分类退款的商户归属）。
 * 明细行数再大也只在 SQL 内分组，传输量始终是「桶数」而不是「条数」。
 */
async function getItemAggregates(
  billIds: string[],
  includeFees: boolean,
): Promise<{
  spend: ItemAggregateRow[]
  refunds: ItemAggregateRow[]
  merchantSpend: ItemAggregateRow[]
}> {
  const itemTypes = includeFees
 ? "('purchase','fee','interest','installment')"
    : "('purchase','installment')"
  const [spend, refunds, merchantSpend] = await Promise.all([
    queryByChunks<ItemAggregateRow>(billIds, (chunk, placeholders) => ({
      sql: `SELECT bill_id, currency, COALESCE(category, '') AS category, item_type,
                   '' AS merchant_key, SUM(amount) AS amount, COUNT(*) AS item_count
            FROM bill_items
            WHERE bill_id IN (${placeholders}) AND item_type IN ${itemTypes}
            GROUP BY bill_id, currency, COALESCE(category, ''), item_type`,
      params: chunk,
    })),
    queryByChunks<ItemAggregateRow>(billIds, (chunk, placeholders) => ({
      sql: `SELECT bill_id, currency, COALESCE(category, '') AS category, 'refund' AS item_type,
                   COALESCE(merchant_name, description, '') AS merchant_key,
                   SUM(amount) AS amount, COUNT(*) AS item_count
            FROM bill_items
            WHERE bill_id IN (${placeholders}) AND item_type = 'refund'
            GROUP BY bill_id, currency, COALESCE(category, ''),
                     COALESCE(merchant_name, description, '')`,
      params: chunk,
    })),
    queryByChunks<ItemAggregateRow>(billIds, (chunk, placeholders) => ({
      sql: `SELECT bill_id, currency, COALESCE(category, '') AS category, item_type,
                   COALESCE(merchant_name, description, '') AS merchant_key,
                   SUM(amount) AS amount, COUNT(*) AS item_count
            FROM bill_items
            WHERE bill_id IN (${placeholders})
              AND item_type IN ${itemTypes}
              AND category IS NOT NULL
            GROUP BY bill_id, currency, COALESCE(category, ''), item_type,
                     COALESCE(merchant_name, description, '')`,
      params: chunk,
    })),
  ])
  for (const result of [spend, refunds, merchantSpend]) {
    if (result.error) throw new Error(result.error.message)
  }
  return {
    spend: spend.data || [],
    refunds: refunds.data || [],
    merchantSpend: merchantSpend.data || [],
  }
}

/**
 * fee / interest 默认归 `fees_interest`；用户显式指定了别的分类时保留显式值
 * （`other` 是导入默认值，视同未指定）。
 */
function normalizeItemCategory(row: { category: string; item_type: string }): string {
  const category = row.category || UNCATEGORIZED_KEY
  if (row.item_type !== 'fee' && row.item_type !== 'interest') return category
  if (
    category === UNCATEGORIZED_KEY ||
    category === 'other' ||
    category === 'fees_interest'
  ) {
    return 'fees_interest'
  }
  return category
}

/** 单个 (bill, currency) 内的退款回冲桶。 */
interface BillCategoryBucket {
  spendByCategory: Map<string, number>
  itemCountByCategory: Map<string, number>
  covered: boolean
}

/**
 * 真实分类聚合（AC-1.4）：
 * - fee / interest 默认归 `fees_interest`，`include_fees=false` 时整体剔除；
 * - 同账单退款优先冲减其显式分类，否则按同账单同归一化商户的消费分类回冲，
 *   桶内扣减下限钳制为 0，溢出部分进 `unallocated_refunds_by_currency`；
 * - 缺汇率币种绝不 1:1 混入 amount / percentage，保留在 by_currency 并标记未折算。
 */
export async function getCategoryBreakdownReport(
  filters: AnalyticsFilters & { include_fees?: boolean },
): Promise<CategoryBreakdownReport> {
  const displayCurrency = normalizeCurrencyOrDefault(filters.display_currency, 'CNY')
  const rates: FxRates | null = await fetchRates()
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)

  const buckets = new Map<string, BillCategoryBucket>()
  /** 无法归属的退款（按原币累计），不参与分类占比，报表单独披露。 */
  const unallocatedRefunds: Record<string, number> = {}
  const ensureBucket = (billId: string, currency: string): BillCategoryBucket => {
    const key = `${billId}|${currency}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        spendByCategory: new Map<string, number>(),
        itemCountByCategory: new Map<string, number>(),
        covered: false,
      }
      buckets.set(key, bucket)
    }
    return bucket
  }

  if (billIds.length > 0) {
    const { spend, refunds, merchantSpend } = await getItemAggregates(
      billIds,
      filters.include_fees !== false,
    )

    for (const row of spend) {
      const bucket = ensureBucket(row.bill_id, row.currency)
      const category = normalizeItemCategory(row)
      bucket.spendByCategory.set(
        category,
        (bucket.spendByCategory.get(category) ?? 0) + Number(row.amount),
      )
      bucket.itemCountByCategory.set(
        category,
        (bucket.itemCountByCategory.get(category) ?? 0) + Number(row.item_count),
      )
      bucket.covered = true
    }

    // 商户 → 分类：同账单同币种下，取消费金额最大的那个已分类桶。
    const merchantCategory = new Map<string, string>()
    const merchantAmount = new Map<string, number>()
    for (const row of merchantSpend) {
      const key = `${row.bill_id}|${row.currency}|${normalizeMerchantKey(row.merchant_key)}`
      const current = merchantAmount.get(key) ?? 0
      const next = current + Number(row.amount)
      merchantAmount.set(key, next)
      if (!merchantCategory.has(key) || next > current) {
        merchantCategory.set(key, normalizeItemCategory(row))
      }
    }

    for (const row of refunds) {
      const bucket = ensureBucket(row.bill_id, row.currency)
      bucket.covered = true
      let target = normalizeItemCategory(row)
      if (!target || target === UNCATEGORIZED_KEY) {
        const key = `${row.bill_id}|${row.currency}|${normalizeMerchantKey(row.merchant_key)}`
        target = merchantCategory.get(key) ?? UNCATEGORIZED_KEY
      }
      // 笔数记在最终归属的分类上（无分类退款按商户回冲后归入该分类）
      bucket.itemCountByCategory.set(
        target,
        (bucket.itemCountByCategory.get(target) ?? 0) + Number(row.item_count),
      )
      let remaining = Number(row.amount)
      const available = bucket.spendByCategory.get(target) ?? 0
      if (available > 0) {
        const taken = Math.min(remaining, available)
        bucket.spendByCategory.set(target, available - taken)
        remaining -= taken
      }
      if (remaining > 0.005) {
        // 无法归属的退款：不硬塞进「其他」，交给报表单独披露。
        unallocatedRefunds[row.currency] = round2(
          (unallocatedRefunds[row.currency] ?? 0) + remaining,
        )
      }
    }
  }

  // 按 (category, currency) 合并全部账单
  const merged = new Map<string, Map<string, { amount: number; count: number }>>()
  for (const [bucketKey, bucket] of buckets.entries()) {
    const currency = bucketKey.slice(bucketKey.indexOf('|') + 1)
    for (const [category, amount] of bucket.spendByCategory) {
      let perCurrency = merged.get(category)
      if (!perCurrency) {
        perCurrency = new Map<string, { amount: number; count: number }>()
        merged.set(category, perCurrency)
      }
      const entry = perCurrency.get(currency) ?? { amount: 0, count: 0 }
      entry.amount += amount
      entry.count += bucket.itemCountByCategory.get(category) ?? 0
      perCurrency.set(currency, entry)
    }
  }

  const items: CategoryBreakdown[] = []
  const unconverted = new Set<string>()
  for (const [category, perCurrency] of merged) {
    const entries = Array.from(perCurrency.entries()).map(([currency, entry]) => ({
      amount: round2(entry.amount),
      currency,
    }))
    const sum = sumByCurrency(entries, entry => entry, displayCurrency, rates)
    const itemCount = Array.from(perCurrency.values()).reduce((total, entry) => total + entry.count, 0)
    for (const currency of sum.unconverted_currencies) unconverted.add(currency)
    items.push({
      category,
      amount: round2(sum.total),
      percentage: 0,
      category_label: categoryLabel(category),
      item_count: itemCount,
      by_currency: sum.by_currency,
      fx_converted: sum.converted,
      fx_unconverted_currencies: sum.unconverted_currencies,
    })
  }

  const totalAmount = round2(items.reduce((total, item) => total + item.amount, 0))
  for (const item of items) {
    item.percentage = totalAmount > 0 ? round2((item.amount / totalAmount) * 100) : 0
  }
  items.sort((a, b) => b.amount - a.amount)

  return {
    items,
    unallocated_refunds_by_currency: unallocatedRefunds,
    covered_bills: new Set(Array.from(buckets.entries()).filter(([, bucket]) => bucket.covered).map(([key]) => key.split('|')[0])).size,
    total_bills: bills.length,
    fx_converted: unconverted.size === 0,
    fx_unconverted_currencies: Array.from(unconverted).sort(),
    display_currency: displayCurrency,
    total_amount: totalAmount,
  }
}

/**
 * 分类饼图数据源。保持数组返回以兼容既有调用方（lib/export.ts、analytics 页面），
 * 元数据挂在每个元素上，需要完整元数据的调用方走 getCategoryBreakdownReport。
 */
export async function getCategoryBreakdown(
  filters: AnalyticsFilters & { include_fees?: boolean },
): Promise<CategoryBreakdown[]> {
  return (await getCategoryBreakdownReport(filters)).items
}

/** 分类下钻明细列表（点饼图某块时调用）。 */
export async function getCategoryDrilldownItems(
  filters: AnalyticsFilters & { category?: string | null },
): Promise<CategoryDrilldownItem[]> {
  const bills = await getFilteredBills(filters)
  const billIds = bills.map(bill => bill.id)
  if (billIds.length === 0) return []

  const categoryFilter =
    filters.category && filters.category !== UNCATEGORIZED_KEY ? filters.category : null
  const { data, error } = await queryByChunks<CategoryDrilldownItem>(
    billIds,
    (chunk, placeholders) => ({
      sql: `SELECT bi.id AS item_id, bi.bill_id, b.bill_month, cc.holder_id,
                   cp.bank_name, COALESCE(cc.name_override, cp.card_name) AS card_name,
                   cc.card_number_last4 AS card_tail,
                   bi.description, bi.merchant_name,
                   COALESCE(bi.category, '${UNCATEGORIZED_KEY}') AS category,
                   bi.item_type, bi.amount, bi.currency, bi.transaction_date
            FROM bill_items bi
            JOIN bills b ON b.id = bi.bill_id
            JOIN credit_cards cc ON cc.id = b.card_id
            LEFT JOIN card_products cp ON cc.card_product_id = cp.id
            WHERE bi.bill_id IN (${placeholders})
              AND (? IS NULL OR COALESCE(bi.category, '${UNCATEGORIZED_KEY}') = ?)`,
      params: [...chunk, categoryFilter, categoryFilter],
    }),
    78,
  )
  if (error) throw new Error(error.message)
  return (data || []).sort((a, b) => {
    const left = a.transaction_date || a.bill_month
    const right = b.transaction_date || b.bill_month
    return right.localeCompare(left)
  })
}

interface InstallmentRow extends InstallmentPlanLike {
  id: string
  card_id: string
  account_id: string | null
  card_tail: string | null
  holder_id: string
  title: string
}

interface PayableRow {
  id: string
  created_by: string
  name: string
  category: string
  amount: number
  currency: string
  cycle_type?: string | null
  cycle_months?: number | null
  due_month?: number | null
  anchor_period?: string | null
  due_day: number
  holder_id: string | null
}

/**
 * 未来 30/60/90 天按币种现金流预测（AC-4.1–AC-4.3）。
 *
 * 三源展开：
 *   1. 未结清信用卡账单（remaining > 0.01，days_until_due ∈ [0, horizon]）；
 *   2. 活跃分期未出账期次（`included_in_statement` 且该卡/该账户当月已出账的期次剔除，
 *      由已出账单承接，避免双计）；
 *   3. 固定支出多期展开（月付在 90 天窗口内精确产出 3 期，扣减已付）。
 *
 * 逾期硬隔离：`days_until_due < 0` 的账单 / 独立分期期次 / 逾期固定支出只进
 * `overdue_alert`，绝不计入未来 N 天准备金与柱状图。
 *
 * 固定支出隐私：成员只能看到自己 holder 名下或自己创建且未绑定 holder 的支出，
 * 绝不泄露管理员名下未绑定该成员的家庭公共支出（AC-4.3）。
 */
export async function getCashflowForecast(
  filters: CashflowForecastFilters,
  userId?: string,
): Promise<CashflowForecastResult> {
  const horizon = filters.horizon_days
  const displayCurrency = normalizeCurrencyOrDefault(filters.display_currency, 'CNY')
  const rates: FxRates | null = await fetchRates()
  const baseDate = getLocalTodayString('Asia/Shanghai')
  const baseDateObj = new Date(`${baseDate}T00:00:00`)

  const cardIds = await getFilteredCardIds(filters)
  if (cardIds.length === 0) {
    return emptyCashflowForecast(baseDate, horizon, displayCurrency)
  }

  const analyticsFilters: AnalyticsFilters = {
    holder_id: filters.holder_id,
    card_id: filters.card_id,
    display_currency: displayCurrency,
  }
  const bills = await getFilteredBills(analyticsFilters)
  const billIds = bills.map(bill => bill.id)

  const billScopeKeys = new Set<string>()
  for (const bill of bills) {
    billScopeKeys.add(`card:${bill.card_id}:${bill.bill_month}`)
    if (bill.account_id) billScopeKeys.add(`acc:${bill.account_id}:${bill.bill_month}`)
  }

  // 固定支出窗口：多期展开最多 6 期，先取足够宽的账期区间再一次查回已付合计
  const payableWindowStart = baseDate.slice(0, 7)
  const payableWindowEnd = addMonthsToPayablePeriod(
    payableWindowStart,
    Math.ceil(horizon / 28) + 1,
  )
  const scopedUserId = typeof userId === 'string' ? userId : ''

  const [paymentsResult, installmentsResult, payablesResult] = await Promise.all([
    billIds.length > 0
      ? queryByChunks<{ bill_id: string; amount: number }>(billIds, (chunk, placeholders) => ({
          sql: 'SELECT bill_id, amount FROM payments WHERE bill_id IN (' + placeholders + ')',
          params: chunk,
        }))
      : Promise.resolve({ data: [], error: null }),
    queryByChunks<InstallmentRow>(cardIds, (chunk, placeholders) => ({
      sql: `SELECT ip.*, cc.account_id, cc.card_number_last4 AS card_tail, cc.holder_id
            FROM installment_plans ip
            JOIN credit_cards cc ON cc.id = ip.card_id
            WHERE ip.card_id IN (${placeholders}) AND ip.status = 'active'`,
      params: chunk,
    })),
    query<PayableRow>(
      `SELECT * FROM recurring_payables
       WHERE is_active = 1
         AND (
           (? IS NOT NULL AND (holder_id = ? OR (created_by = ? AND holder_id IS NULL)))
           OR (? IS NULL AND created_by = ?)
         )`,
      [
        filters.holder_id ?? null,
        filters.holder_id ?? null,
        scopedUserId,
        filters.holder_id ?? null,
        scopedUserId,
      ],
    ),
  ])
  if (paymentsResult.error) throw new Error(paymentsResult.error.message)
  if (installmentsResult.error) throw new Error(installmentsResult.error.message)
  if (payablesResult.error) throw new Error(payablesResult.error.message)

  const payables = payablesResult.data || []
  const payableIds = payables.map(payable => payable.id)
  const paidByPayablePeriod = new Map<string, number>()
  if (payableIds.length > 0) {
    const paidResult = await queryByChunks<{ payable_id: string; period: string; amount: number }>(
      payableIds,
      (chunk, placeholders) => ({
        sql: `SELECT payable_id, period, SUM(amount) AS amount
              FROM recurring_payable_payments
              WHERE payable_id IN (${placeholders}) AND period >= ? AND period <= ?
              GROUP BY payable_id, period`,
        params: [...chunk, payableWindowStart, payableWindowEnd],
      }),
      78,
    )
    if (paidResult.error) throw new Error(paidResult.error.message)
    for (const row of paidResult.data || []) {
      paidByPayablePeriod.set(`${row.payable_id}:${row.period}`, Number(row.amount) || 0)
    }
  }

  const paidByBill = new Map<string, number>()
  for (const row of paymentsResult.data || []) {
    paidByBill.set(row.bill_id, (paidByBill.get(row.bill_id) ?? 0) + (Number(row.amount) || 0))
  }

  const events: CashflowEvent[] = []
  const overdueEvents: CashflowEvent[] = []
  const push = (event: CashflowEvent): void => {
    if (event.days_until_due < 0) overdueEvents.push(event)
    else events.push(event)
  }

  // 源 1：未结清账单
  for (const bill of bills) {
    const remaining = round2(
      effectiveBillAmount({ bill_amount: bill.bill_amount }) - (paidByBill.get(bill.id) ?? 0),
    )
    if (remaining <= 0.01 || bill.status === 'paid') continue
    const dueDate = billEffectiveDueDate({
      due_date: bill.due_date,
      due_date_override: bill.due_date_override ?? null,
    })
    const days = diffInCalendarDays(dueDate, baseDateObj)
    if (days > horizon) continue
    if (days < 0 && isBillUnissued(bill, baseDateObj)) continue
    push({
      source: 'bill',
      ref_id: bill.id,
      title: `${bill.bill_month} ${bill.bank_name ?? ''} ${bill.card_name ?? ''}`.trim(),
      due_date: dueDate,
      days_until_due: days,
      amount: remaining,
      currency: bill.currency ?? displayCurrency,
      holder_id: bill.holder_id,
      card_tail: bill.card_number_last4 ?? null,
    })
  }

  // 源 2：活跃分期未出账期次
  for (const plan of installmentsResult.data || []) {
    const schedule = generateInstallmentSchedule(plan)
    for (const period of schedule) {
      if (period.period_index <= plan.paid_periods) continue
      const covered =
        plan.billing_mode !== 'independent' &&
        (billScopeKeys.has(`card:${plan.card_id}:${period.bill_month}`) ||
          (plan.account_id
            ? billScopeKeys.has(`acc:${plan.account_id}:${period.bill_month}`)
            : false))
      if (covered) continue
      const days = diffInCalendarDays(period.due_date, baseDateObj)
      if (days > horizon) continue
      push({
        source: 'installment',
        ref_id: plan.id,
        title: `${plan.title} 第${period.period_index}/${plan.total_periods}期`,
        due_date: period.due_date,
        days_until_due: days,
        amount: period.total,
        currency: plan.currency,
        holder_id: plan.holder_id,
        card_tail: plan.card_tail,
      })
    }
  }

  // 源 3：固定支出多期展开
  for (const payable of payables) {
    const cycle = {
      cycle_type: (payable.cycle_type ?? 'monthly') as
        | 'monthly'
        | 'every_n_months'
        | 'yearly',
      cycle_months: payable.cycle_months ?? undefined,
      due_month: payable.due_month ?? undefined,
    }
    let period = payablePeriodOf(baseDateObj, cycle)
    for (let step = 0; step < 6; step++) {
      const dueDate = payableDueDate(payable.due_day, period)
      const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(
        dueDate.getDate(),
      ).padStart(2, '0')}`
      const paid = paidByPayablePeriod.get(`${payable.id}:${period}`) ?? 0
      const remaining = round2((Number(payable.amount) || 0) - paid)
      if (remaining > 0.01) {
        const days = diffInCalendarDays(dueDateStr, baseDateObj)
        if (days <= horizon) {
          push({
            source: 'payable',
            ref_id: payable.id,
            title: payable.name,
            due_date: dueDateStr,
            days_until_due: days,
            amount: remaining,
            currency: payable.currency || displayCurrency,
            holder_id: payable.holder_id,
          })
        }
      }
      period = nextPayablePeriodOf(period, cycle)
    }
  }

  return buildCashflowResult({
    baseDate,
    horizon,
    displayCurrency,
    rates,
    events,
    overdueEvents,
  })
}

function emptyCashflowForecast(
  baseDate: string,
  horizon: CashflowHorizon,
  displayCurrency: string,
): CashflowForecastResult {
  return {
    base_date: baseDate,
    horizon_days: horizon,
    display_currency: displayCurrency,
    reserves_by_currency: {},
    converted_summary: {
      converted_currency: displayCurrency,
      by_currency: {},
      total: 0,
      converted: true,
      unconverted_currencies: [],
      mixed: false,
    },
    buckets: orderedBucketLabels(horizon, baseDate).map(label => ({
      label,
      ...bucketRange(horizon, label, baseDate),
      by_currency: {},
      bill: 0,
      installment: 0,
      payable: 0,
      total: 0,
    })),
    timeline: [],
    overdue_alert: {
      count: 0,
      by_currency: {},
      total_converted: 0,
      fx_converted: true,
      items: [],
    },
  }
}

function buildCashflowResult(input: {
  baseDate: string
  horizon: CashflowHorizon
  displayCurrency: string
  rates: FxRates | null
  events: CashflowEvent[]
  overdueEvents: CashflowEvent[]
}): CashflowForecastResult {
  const { baseDate, horizon, displayCurrency, rates, events, overdueEvents } = input

  const reserves: CashflowForecastResult['reserves_by_currency'] = {}
  const ensureReserve = (currency: string) => {
    let entry = reserves[currency]
    if (!entry) {
      entry = { bill: 0, installment: 0, payable: 0, total: 0 }
      reserves[currency] = entry
    }
    return entry
  }
  for (const event of events) {
    const entry = ensureReserve(event.currency)
    entry[event.source] = round2(entry[event.source] + event.amount)
    entry.total = round2(entry.total + event.amount)
  }

  const converted = sumByCurrency(
    events,
    event => ({ amount: event.amount, currency: event.currency }),
    displayCurrency,
    rates,
  )

  const buckets = new Map<string, CashflowForecastResult['buckets'][number]>()
  for (const label of orderedBucketLabels(horizon, baseDate)) {
    buckets.set(label, {
      label,
      ...bucketRange(horizon, label, baseDate),
      by_currency: {},
      bill: 0,
      installment: 0,
      payable: 0,
      total: 0,
    })
  }
  for (const event of events) {
    const label = bucketLabelForDate(horizon, event.due_date, baseDate)
    const bucket = buckets.get(label)
    if (!bucket) continue
    bucket.by_currency[event.currency] = round2(
      (bucket.by_currency[event.currency] ?? 0) + event.amount,
    )
    bucket[event.source] = round2(bucket[event.source] + event.amount)
    bucket.total = round2(bucket.total + event.amount)
  }

  const overdueByCurrency: Record<string, number> = {}
  for (const event of overdueEvents) {
    overdueByCurrency[event.currency] = round2(
      (overdueByCurrency[event.currency] ?? 0) + event.amount,
    )
  }
  const overdueConverted = sumByCurrency(
    overdueEvents,
    event => ({ amount: event.amount, currency: event.currency }),
    displayCurrency,
    rates,
  )

  return {
    base_date: baseDate,
    horizon_days: horizon,
    display_currency: displayCurrency,
    reserves_by_currency: reserves,
    converted_summary: {
      converted_currency: displayCurrency,
      by_currency: converted.by_currency,
      total: round2(converted.total),
      converted: converted.converted,
      unconverted_currencies: converted.unconverted_currencies,
      mixed: converted.mixed,
    },
    buckets: Array.from(buckets.values()),
    timeline: [...events].sort(
      (a, b) => a.due_date.localeCompare(b.due_date) || a.source.localeCompare(b.source),
    ),
    overdue_alert: {
      count: overdueEvents.length,
      by_currency: overdueByCurrency,
      total_converted: round2(overdueConverted.total),
      fx_converted: overdueConverted.converted,
      items: [...overdueEvents].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    },
  }
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

  const { data: usages, error } = await queryByChunks<{ title: string | null }>(
    cardIds,
    (chunk, placeholders) => ({
      sql: `SELECT p.title
     FROM promo_usages pu
     JOIN promos p ON pu.promo_id = p.id
     WHERE pu.card_id IN (${placeholders})`,
      params: chunk,
    })
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
