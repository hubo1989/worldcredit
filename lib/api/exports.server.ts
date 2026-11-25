// lib/api/exports.server.ts — 全家庭合并对账导出（月报 / 年报同源）。
//
// 服务端聚合 + 服务端权限校验（guardFamilyExport 在 registry 的 memberGuard 里执行），
// 浏览器只负责弹窗交互与下载。所有 IN 查询走 queryByChunks 规避 D1 100 参数上限。

import { query, queryByChunks } from '../db'
import { fetchRates, normalizeCurrencyOrDefault, sumByCurrency, type FxRates } from '../fx'
import {
  addMonthsToPayablePeriod,
  diffInCalendarDays,
  getLocalTodayString,
  payableDueDate,
  payablePeriodOf,
} from '../utils'
import { RpcDomainError } from './errors'
import {
  categoryLabel,
  nextInstallmentPeriod,
  remainingInstallmentPrincipal,
  round2,
  type InstallmentPlanLike,
  type LockedPaymentLike,
  sumPaymentsWithLockedFx,
} from './direction3.shared'
import { getCategoryBreakdownReport, type CategoryBreakdown } from './analytics.server'

export const EXPORT_TABLES = [
  'bills',
  'payments',
  'bill_items',
  'installments',
  'benefit_usages',
  'promo_usages',
  'opportunity_usages',
] as const

export type ExportTable = (typeof EXPORT_TABLES)[number]

export interface FamilyExportRequest {
  /** family = 全家庭（仅管理员）；holder = 单持卡人。 */
  scope?: 'family' | 'holder'
  holder_id?: string
  mode?: 'monthly' | 'annual'
  /** monthly: YYYY-MM；annual: YYYY。 */
  period?: string
  table?: ExportTable
  display_currency?: string
  card_id?: string
}

export interface CsvRowsResult {
  headers: string[]
  rows: Record<string, string | number | null | undefined>[]
  filename: string
}

export interface StatementHolderSummary {
  holder_id: string
  holder_name: string
  bill_count: number
  total_billed: number
  total_paid: number
  outstanding: number
}

export interface StatementBill {
  id: string
  holder_id: string
  holder_name: string
  bank_name: string | null
  card_name: string | null
  card_tail: string | null
  bill_month: string
  bill_amount: number
  currency: string
  min_payment: number | null
  due_date: string
  status: string
}

export interface StatementPayment {
  id: string
  holder_id: string
  holder_name: string
  bank_name: string | null
  card_name: string | null
  card_tail: string | null
  bill_month: string
  paid_at: string
  amount: number
  currency: string
  settled_currency: string | null
  settled_amount: number | null
  locked_fx_rate: number | null
  channel: string | null
  note: string | null
}

export interface StatementItem {
  id: string
  holder_id: string
  holder_name: string
  bank_name: string | null
  card_name: string | null
  card_tail: string | null
  bill_month: string
  transaction_date: string | null
  description: string
  merchant_name: string | null
  category: string | null
  item_type: string
  amount: number
  currency: string
}

export interface StatementInstallment {
  id: string
  holder_id: string
  holder_name: string
  bank_name: string | null
  card_name: string | null
  card_tail: string | null
  title: string
  plan_type: string
  currency: string
  principal_amount: number
  total_periods: number
  paid_periods: number
  remaining_principal: number
  fee_mode: string
  billing_mode: string
  status: string
  next_due_date: string | null
  next_amount: number | null
}

export interface StatementPayable {
  id: string
  holder_id: string | null
  holder_name: string | null
  name: string
  category: string
  amount: number
  currency: string
  due_day: number
  period: string
  due_date: string
  paid_amount: number
  remaining: number
  status: string
}

export interface FamilyStatementReport {
  mode: 'monthly' | 'annual'
  period: string
  period_start: string
  period_end: string
  scope: 'family' | 'holder'
  display_currency: string
  holders: StatementHolderSummary[]
  bills: StatementBill[]
  payments: StatementPayment[]
  bill_items: StatementItem[]
  installments: StatementInstallment[]
  payables: StatementPayable[]
  category_breakdown: CategoryBreakdown[]
  /** 分币种真数：账单 / 已还 / 未还。 */
  totals_by_currency: Record<string, { billed: number; paid: number; outstanding: number }>
  /** 折算后的合计与汇率元数据。 */
  converted_totals: {
    billed: number
    paid: number
    outstanding: number
    fx_converted: boolean
    fx_unconverted_currencies: string[]
  }
}

interface PeriodRange {
  mode: 'monthly' | 'annual'
  period: string
  startMonth: string
  endMonth: string
  startDate: string
  endDate: string
}

function resolvePeriod(req: FamilyExportRequest): PeriodRange {
  const mode = req.mode === 'annual' ? 'annual' : 'monthly'
  const raw = typeof req.period === 'string' ? req.period.trim() : ''
  if (mode === 'annual') {
    if (!/^\d{4}$/.test(raw)) {
      throw new RpcDomainError('VALIDATION_FAILED', '年度报表的 period 必须是 YYYY')
    }
    return {
      mode,
      period: raw,
      startMonth: `${raw}-01`,
      endMonth: `${raw}-12`,
      startDate: `${raw}-01-01`,
      endDate: `${raw}-12-31`,
    }
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    throw new RpcDomainError('VALIDATION_FAILED', '月度报表的 period 必须是 YYYY-MM')
  }
  const [year, month] = raw.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return {
    mode,
    period: raw,
    startMonth: raw,
    endMonth: raw,
    startDate: `${raw}-01`,
    endDate: `${raw}-${String(lastDay).padStart(2, '0')}`,
  }
}

/**
 * 带持卡人过滤的查询：holderIds 为 null 表示全家庭（不加任何过滤），
 * 否则按 78 个一批分片，规避 D1 100 绑定参数上限。
 */
async function queryWithHolders<T>(
  holderIds: string[] | null,
  buildSql: (holderPlaceholders: string | null) => string,
  params: unknown[],
): Promise<T[]> {
  if (!holderIds) {
    const { data, error } = await query<T>(buildSql(null), params)
    if (error) throw new Error(error.message)
    return data || []
  }
  if (holderIds.length === 0) return []
  const { data, error } = await queryByChunks<T>(
    holderIds,
    (chunk, placeholders) => ({ sql: buildSql(placeholders), params: [...params, ...chunk] }),
    78,
  )
  if (error) throw new Error(error.message)
  return data || []
}

interface ReportContext {
  range: PeriodRange
  holderIds: string[] | null
  displayCurrency: string
  rates: FxRates | null
}

async function loadBills(ctx: ReportContext): Promise<StatementBill[]> {
  return queryWithHolders<StatementBill>(
    ctx.holderIds,
    placeholders => `SELECT b.id, cc.holder_id, ch.name AS holder_name,
        cp.bank_name, COALESCE(cc.name_override, cp.card_name) AS card_name,
        cc.card_number_last4 AS card_tail, b.bill_month,
        COALESCE(b.bill_amount_override, b.bill_amount) AS bill_amount,
        cp.currency, b.min_payment, b.due_date, b.status
     FROM bills b
     JOIN credit_cards cc ON cc.id = b.card_id
     LEFT JOIN card_products cp ON cp.id = cc.card_product_id
     LEFT JOIN card_holders ch ON ch.id = cc.holder_id
     WHERE b.bill_month BETWEEN ? AND ?
       ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
     ORDER BY b.bill_month DESC, cc.holder_id`,
    [ctx.range.startMonth, ctx.range.endMonth],
  )
}

async function loadPayments(ctx: ReportContext): Promise<StatementPayment[]> {
  return queryWithHolders<StatementPayment>(
    ctx.holderIds,
    placeholders => `SELECT p.*, cc.holder_id, ch.name AS holder_name,
        cp.bank_name, COALESCE(cc.name_override, cp.card_name) AS card_name,
        cc.card_number_last4 AS card_tail, b.bill_month, p.paid_at, p.amount,
        COALESCE(cp.currency, 'CNY') AS currency,
        p.channel, p.note
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     JOIN credit_cards cc ON cc.id = b.card_id
     LEFT JOIN card_products cp ON cp.id = cc.card_product_id
     LEFT JOIN card_holders ch ON ch.id = cc.holder_id
     WHERE b.bill_month BETWEEN ? AND ?
       ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
     ORDER BY p.paid_at DESC`,
    [ctx.range.startMonth, ctx.range.endMonth],
  )
}

async function loadBillItems(ctx: ReportContext): Promise<StatementItem[]> {
  return queryWithHolders<StatementItem>(
    ctx.holderIds,
    placeholders => `SELECT bi.id, cc.holder_id, ch.name AS holder_name,
        cp.bank_name, COALESCE(cc.name_override, cp.card_name) AS card_name,
        cc.card_number_last4 AS card_tail, b.bill_month, bi.transaction_date,
        bi.description, bi.merchant_name, bi.category, bi.item_type, bi.amount,
        COALESCE(bi.currency, cp.currency, 'CNY') AS currency
     FROM bill_items bi
     JOIN bills b ON b.id = bi.bill_id
     JOIN credit_cards cc ON cc.id = b.card_id
     LEFT JOIN card_products cp ON cp.id = cc.card_product_id
     LEFT JOIN card_holders ch ON ch.id = cc.holder_id
     WHERE b.bill_month BETWEEN ? AND ?
       ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
     ORDER BY b.bill_month DESC, bi.transaction_date DESC`,
    [ctx.range.startMonth, ctx.range.endMonth],
  )
}

async function loadInstallments(ctx: ReportContext): Promise<StatementInstallment[]> {
  const rows = await queryWithHolders<
    InstallmentPlanLike & {
      id: string
      card_id: string
      holder_id: string
      holder_name: string | null
      bank_name: string | null
      card_name: string | null
      card_tail: string | null
      title: string
      plan_type: string
      paid_periods: number
      total_periods: number
      fee_mode: string
      billing_mode: string
      status: string
      principal_amount: number
      currency: string
    }
  >(
    ctx.holderIds,
    placeholders => `SELECT ip.*, cc.holder_id, ch.name AS holder_name,
        cp.bank_name, COALESCE(cc.name_override, cp.card_name) AS card_name,
        cc.card_number_last4 AS card_tail
     FROM installment_plans ip
     JOIN credit_cards cc ON cc.id = ip.card_id
     LEFT JOIN card_products cp ON cp.id = cc.card_product_id
     LEFT JOIN card_holders ch ON ch.id = cc.holder_id
     WHERE 1 = 1 ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
     ORDER BY ip.start_month DESC`,
    [],
  )
  return rows.map(row => {
    const next = nextInstallmentPeriod(row)
    return {
      id: row.id,
      holder_id: row.holder_id,
      holder_name: row.holder_name || '未知持卡人',
      bank_name: row.bank_name,
      card_name: row.card_name,
      card_tail: row.card_tail,
      title: row.title,
      plan_type: row.plan_type,
      currency: row.currency,
      principal_amount: round2(row.principal_amount),
      total_periods: row.total_periods,
      paid_periods: row.paid_periods,
      remaining_principal: round2(remainingInstallmentPrincipal(row)),
      fee_mode: row.fee_mode,
      billing_mode: row.billing_mode ?? 'included_in_statement',
      status: row.status ?? 'active',
      next_due_date: next?.due_date ?? null,
      next_amount: next ? round2(next.total) : null,
    }
  })
}

async function loadPayables(ctx: ReportContext, userId: string): Promise<StatementPayable[]> {
  const today = getLocalTodayString('Asia/Shanghai')
  const todayObj = new Date(`${today}T00:00:00`)
  const rows = await queryWithHolders<{
    id: string
    holder_id: string | null
    holder_name: string | null
    name: string
    category: string
    amount: number
    currency: string
    due_day: number
    cycle_type: string | null
    cycle_months: number | null
    due_month: number | null
    created_by: string
  }>(
    // 固定支出按 created_by / holder_id 双维度过滤，与现金流预测同一隐私口径。
    null,
    () => `SELECT rp.*, ch.name AS holder_name
     FROM recurring_payables rp
     LEFT JOIN card_holders ch ON ch.id = rp.holder_id
     WHERE rp.is_active = 1
       AND (
         (? IS NULL AND rp.created_by = ?)
         OR (? IS NOT NULL AND (rp.holder_id = ? OR (rp.created_by = ? AND rp.holder_id IS NULL)))
       )
     ORDER BY rp.due_day`,
    [
      ctx.holderIds ? ctx.holderIds[0] : null,
      userId,
      ctx.holderIds ? ctx.holderIds[0] : null,
      ctx.holderIds ? ctx.holderIds[0] : null,
      userId,
    ],
  )
  if (rows.length === 0) return []

  const payableIds = rows.map(row => row.id)
  const paidMap = new Map<string, number>()
  const paidRows = await queryByChunks<{ payable_id: string; period: string; amount: number }>(
    payableIds,
    (chunk, placeholders) => ({
      sql: `SELECT payable_id, period, SUM(amount) AS amount
            FROM recurring_payable_payments
            WHERE payable_id IN (${placeholders})
            GROUP BY payable_id, period`,
      params: chunk,
    }),
  )
  if (paidRows.error) throw new Error(paidRows.error.message)
  for (const row of paidRows.data || []) {
    paidMap.set(`${row.payable_id}:${row.period}`, Number(row.amount) || 0)
  }

  return rows.map(row => {
    const cycle = {
      cycle_type: (row.cycle_type ?? 'monthly') as 'monthly' | 'every_n_months' | 'yearly',
      cycle_months: row.cycle_months ?? undefined,
      due_month: row.due_month ?? undefined,
    }
    const period = payablePeriodOf(todayObj, cycle)
    const dueDate = payableDueDate(row.due_day, period)
    const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(
      dueDate.getDate(),
    ).padStart(2, '0')}`
    const paid = paidMap.get(`${row.id}:${period}`) ?? 0
    const remaining = round2((Number(row.amount) || 0) - paid)
    return {
      id: row.id,
      holder_id: row.holder_id,
      holder_name: row.holder_name,
      name: row.name,
      category: row.category,
      amount: Number(row.amount) || 0,
      currency: row.currency || ctx.displayCurrency,
      due_day: row.due_day,
      period,
      due_date: dueDateStr,
      paid_amount: round2(paid),
      remaining,
      status: remaining <= 0.01 ? 'paid' : diffInCalendarDays(dueDateStr, todayObj) < 0 ? 'overdue' : 'unpaid',
    }
  })
}

async function collectReport(
  req: FamilyExportRequest,
  userId: string,
): Promise<FamilyStatementReport> {
  const range = resolvePeriod(req)
  const displayCurrency = normalizeCurrencyOrDefault(req.display_currency, 'CNY')
  const holderIds = req.holder_id ? [req.holder_id] : null
  const rates: FxRates | null = await fetchRates()
  const ctx: ReportContext = { range, holderIds, displayCurrency, rates }

  const [bills, payments, billItems, installments, payables] = await Promise.all([
    loadBills(ctx),
    loadPayments(ctx),
    loadBillItems(ctx),
    loadInstallments(ctx),
    loadPayables(ctx, userId),
  ])

  const holderNames = new Map<string, string>()
  for (const bill of bills) holderNames.set(bill.holder_id, bill.holder_name)
  const ensureHolder = (id: string, name: string | null) =>
    holderNames.get(id) || name || '未知持卡人'

  // 已还按持卡人分组后走锁定汇率聚合：锁定过实付币种的还款免疫实时汇率漂移
  const paymentsByHolder = new Map<string, LockedPaymentLike[]>()
  for (const payment of payments) {
    const list = paymentsByHolder.get(payment.holder_id) ?? []
    list.push({
      amount: payment.amount,
      bill_currency: payment.currency,
      settled_currency: payment.settled_currency ?? null,
      settled_amount: payment.settled_amount ?? null,
      locked_fx_rate: payment.locked_fx_rate ?? null,
    })
    paymentsByHolder.set(payment.holder_id, list)
  }
  const billedByHolder = new Map<string, number>()
  for (const bill of bills) {
    billedByHolder.set(bill.holder_id, (billedByHolder.get(bill.holder_id) ?? 0) + Number(bill.bill_amount))
  }
  const holders: StatementHolderSummary[] = Array.from(
    new Set([...bills.map(bill => bill.holder_id), ...payments.map(p => p.holder_id)]),
  ).map(holderId => {
    const billed = round2(billedByHolder.get(holderId) ?? 0)
    const paid = round2(
      sumPaymentsWithLockedFx(paymentsByHolder.get(holderId) ?? [], displayCurrency, rates).total,
    )
    return {
      holder_id: holderId,
      holder_name: ensureHolder(holderId, null),
      bill_count: bills.filter(bill => bill.holder_id === holderId).length,
      total_billed: billed,
      total_paid: paid,
      outstanding: round2(Math.max(0, billed - paid)),
    }
  })

  const categoryBreakdown = await getCategoryBreakdownReport({
    from_month: range.startMonth,
    to_month: range.endMonth,
    holder_id: req.holder_id,
    display_currency: displayCurrency,
  })

  const totalsByCurrency: FamilyStatementReport['totals_by_currency'] = {}
  const ensureTotal = (currency: string) => {
    let entry = totalsByCurrency[currency]
    if (!entry) {
      entry = { billed: 0, paid: 0, outstanding: 0 }
      totalsByCurrency[currency] = entry
    }
    return entry
  }
  for (const bill of bills) {
    const entry = ensureTotal(bill.currency)
    entry.billed = round2(entry.billed + Number(bill.bill_amount))
  }
  for (const payment of payments) {
    const entry = ensureTotal(payment.currency)
    entry.paid = round2(entry.paid + payment.amount)
  }
  for (const entry of Object.values(totalsByCurrency)) {
    entry.outstanding = round2(Math.max(0, entry.billed - entry.paid))
  }

  const billedSum = sumByCurrency(
    bills,
    bill => ({ amount: Number(bill.bill_amount) || 0, currency: bill.currency }),
    displayCurrency,
    rates,
  )
  const paidSum = sumPaymentsWithLockedFx(
    payments.map(payment => ({
      amount: payment.amount,
      bill_currency: payment.currency,
      settled_currency: payment.settled_currency ?? null,
      settled_amount: payment.settled_amount ?? null,
      locked_fx_rate: payment.locked_fx_rate ?? null,
    })),
    displayCurrency,
    rates,
  )

  return {
    mode: range.mode,
    period: range.period,
    period_start: range.startDate,
    period_end: range.endDate,
    scope: holderIds ? 'holder' : 'family',
    display_currency: displayCurrency,
    holders,
    bills,
    payments,
    bill_items: billItems,
    installments,
    payables,
    category_breakdown: categoryBreakdown.items,
    totals_by_currency: totalsByCurrency,
    converted_totals: {
      billed: round2(billedSum.total),
      paid: round2(paidSum.total),
      outstanding: round2(Math.max(0, billedSum.total - paidSum.total)),
      fx_converted: billedSum.converted && paidSum.converted,
      fx_unconverted_currencies: Array.from(
        new Set([...billedSum.unconverted_currencies, ...paidSum.unconverted_currencies]),
      ).sort(),
    },
  }
}

/** 月报 / 年报同源数据（驱动 CSV 与可打印对账单）。 */
export async function getStatementReport(
  req: FamilyExportRequest,
  userId?: string,
): Promise<FamilyStatementReport> {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的报表请求')
  }
  return collectReport(req, typeof userId === 'string' ? userId : '')
}

function holderLabel(row: { holder_name: string | null }): string {
  return row.holder_name || '未知持卡人'
}

/** 单表扁平行导出（7 类表）。 */
export async function exportFamilyCsvRows(
  req: FamilyExportRequest,
  userId?: string,
): Promise<CsvRowsResult> {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的导出请求')
  }
  const table = req.table && EXPORT_TABLES.includes(req.table) ? req.table : 'bills'
  const report = await collectReport(req, typeof userId === 'string' ? userId : '')
  const prefix = report.scope === 'family' ? '全家庭' : holderLabel({ holder_name: report.holders[0]?.holder_name ?? null })
  const filename = `worldcredit-${prefix}-${report.period}-${table}.csv`

  let headers: string[]
  let rows: Record<string, string | number | null | undefined>[]

  switch (table) {
    case 'payments':
      headers = [
        '还款日期', '持卡人', '银行', '卡片', '卡号末四位', '账单月份',
        '还款金额', '账单币种', '实付币种', '实付金额', '锁定汇率', '还款渠道', '备注',
      ]
      rows = report.payments.map(payment => ({
        还款日期: payment.paid_at,
        持卡人: payment.holder_name,
        银行: payment.bank_name,
        卡片: payment.card_name,
        卡号末四位: payment.card_tail,
        账单月份: payment.bill_month,
        还款金额: payment.amount.toFixed(2),
        账单币种: payment.currency,
        实付币种: payment.settled_currency,
        实付金额: payment.settled_amount?.toFixed(2) ?? '',
        锁定汇率: payment.locked_fx_rate ?? '',
        还款渠道: payment.channel,
        备注: payment.note,
      }))
      break
    case 'bill_items':
      headers = [
        '交易日期', '持卡人', '银行', '卡片', '卡号末四位', '账单月份',
        '描述', '商户', '分类', '类型', '金额', '币种',
      ]
      rows = report.bill_items.map(item => ({
        交易日期: item.transaction_date,
        持卡人: item.holder_name,
        银行: item.bank_name,
        卡片: item.card_name,
        卡号末四位: item.card_tail,
        账单月份: item.bill_month,
        描述: item.description,
        商户: item.merchant_name,
        分类: categoryLabel(item.category),
        类型: item.item_type,
        金额: item.amount.toFixed(2),
        币种: item.currency,
      }))
      break
    case 'installments':
      headers = [
        '持卡人', '银行', '卡片', '卡号末四位', '分期标题', '分期类型',
        '本金', '币种', '总期数', '已还期数', '剩余本金', '手续费模式', '入账模式',
        '状态', '下期还款日', '下期应还',
      ]
      rows = report.installments.map(plan => ({
        持卡人: plan.holder_name,
        银行: plan.bank_name,
        卡片: plan.card_name,
        卡号末四位: plan.card_tail,
        分期标题: plan.title,
        分期类型: plan.plan_type,
        本金: plan.principal_amount.toFixed(2),
        币种: plan.currency,
        总期数: plan.total_periods,
        已还期数: plan.paid_periods,
        剩余本金: plan.remaining_principal.toFixed(2),
        手续费模式: plan.fee_mode,
        入账模式: plan.billing_mode,
        状态: plan.status,
        下期还款日: plan.next_due_date,
        下期应还: plan.next_amount?.toFixed(2) ?? '',
      }))
      break
    case 'benefit_usages':
    case 'promo_usages':
    case 'opportunity_usages': {
      const usageRows = await loadUsageRows(table, req, typeof userId === 'string' ? userId : '')
      headers = usageRows.headers
      rows = usageRows.rows
      break
    }
    case 'bills':
    default:
      headers = [
        '账单月份', '持卡人', '银行', '卡片', '卡号末四位',
        '账单金额', '币种', '最低还款', '还款截止日', '状态',
      ]
      rows = report.bills.map(bill => ({
        账单月份: bill.bill_month,
        持卡人: bill.holder_name,
        银行: bill.bank_name,
        卡片: bill.card_name,
        卡号末四位: bill.card_tail,
        账单金额: Number(bill.bill_amount).toFixed(2),
        币种: bill.currency,
        最低还款: bill.min_payment != null ? Number(bill.min_payment).toFixed(2) : '',
        还款截止日: bill.due_date,
        状态: bill.status,
      }))
      break
  }

  return { headers, rows, filename }
}

/** 三类「使用记录」表的服务端查询（成员按持卡人隔离）。 */
async function loadUsageRows(
  table: 'benefit_usages' | 'promo_usages' | 'opportunity_usages',
  req: FamilyExportRequest,
  _userId: string,
): Promise<{ headers: string[]; rows: Record<string, string | number | null | undefined>[] }> {
  const holderIds = req.holder_id ? [req.holder_id] : null
  if (table === 'benefit_usages') {
    const rows = await queryWithHolders<{
      used_at: string
      holder_name: string | null
      bank_name: string | null
      card_name: string | null
      benefit_name: string | null
      note: string | null
    }>(
      holderIds,
      placeholders => `SELECT bu.used_at, ch.name AS holder_name, cp.bank_name, cp.card_name,
              bn.name AS benefit_name, bu.note
       FROM benefit_usages bu
       JOIN benefits bn ON bn.id = bu.benefit_id
       JOIN card_products cp ON cp.id = bn.card_product_id
       JOIN credit_cards cc ON cc.card_product_id = cp.id
       LEFT JOIN card_holders ch ON ch.id = cc.holder_id
       WHERE 1 = 1 ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
       ORDER BY bu.used_at DESC`,
      [],
    )
    return {
      headers: ['使用日期', '持卡人', '银行', '卡片', '权益名称', '备注'],
      rows: rows.map(row => ({
        使用日期: row.used_at,
        持卡人: row.holder_name,
        银行: row.bank_name,
        卡片: row.card_name,
        权益名称: row.benefit_name,
        备注: row.note,
      })),
    }
  }
  if (table === 'promo_usages') {
    const rows = await queryWithHolders<{
      used_at: string
      holder_name: string | null
      bank_name: string | null
      title: string | null
      note: string | null
    }>(
      holderIds,
      placeholders => `SELECT pu.used_at, ch.name AS holder_name, pr.bank_name, pr.title, pu.note
       FROM promo_usages pu
       JOIN promos pr ON pr.id = pu.promo_id
       LEFT JOIN credit_cards cc ON cc.id = pu.card_id
       LEFT JOIN card_holders ch ON ch.id = cc.holder_id
       WHERE 1 = 1 ${placeholders ? `AND cc.holder_id IN (${placeholders})` : ''}
       ORDER BY pu.used_at DESC`,
      [],
    )
    return {
      headers: ['使用日期', '持卡人', '银行', '优惠标题', '备注'],
      rows: rows.map(row => ({
        使用日期: row.used_at,
        持卡人: row.holder_name,
        银行: row.bank_name,
        优惠标题: row.title,
        备注: row.note,
      })),
    }
  }
  const rows = await queryWithHolders<{
    used_on: string
    holder_name: string | null
    quantity: number
    amount_minor: number
    status: string
    note: string | null
  }>(
    holderIds,
    placeholders => `SELECT ou.used_on, ch.name AS holder_name, ou.quantity, ou.amount_minor,
            ou.status, ou.note
     FROM opportunity_usages ou
     JOIN opportunity_accounts oa ON oa.id = ou.account_id
     LEFT JOIN card_holders ch ON ch.id = oa.holder_id
     WHERE ou.status = 'active' ${placeholders ? `AND oa.holder_id IN (${placeholders})` : ''}
     ORDER BY ou.used_on DESC`,
    [],
  )
  return {
    headers: ['使用日期', '持卡人', '数量', '金额（最小单位）', '状态', '备注'],
    rows: rows.map(row => ({
      使用日期: row.used_on,
      持卡人: row.holder_name,
      数量: row.quantity,
      '金额（最小单位）': row.amount_minor,
      状态: row.status,
      备注: row.note,
    })),
  }
}

/** 导出文件名用：把窗口月份补进文件名（纯函数，便于前端复用）。 */
export function statementFilename(period: string, scope: 'family' | 'holder', table: string): string {
  return `worldcredit-${scope === 'family' ? '全家庭' : '持卡人'}-${period}-${table}.csv`
}

/** 供 iOS / 前端复用的月度窗口计算（纯函数）。 */
export function payableWindow(period: string, months: number): { start: string; end: string } {
  return { start: period, end: addMonthsToPayablePeriod(period, months) }
}
