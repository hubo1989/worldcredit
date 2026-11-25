// lib/export.ts
import { format, endOfMonth } from 'date-fns'
import { getBillsByHolder } from './api/bills'
import { getCardsByHolder } from './api/cards'
import { getPaymentsByHolder } from './api/payments'
import { getBenefitUsagesByHolder } from './api/benefitUsages'
import { getPromoUsagesByHolder } from './api/promoUsages'
import { getAnalyticsByHolder } from './api/analytics'
import { callRpc } from './api/rpc-client'
import type { FamilyStatementReport } from './api/exports.server'
import type * as ExportsServer from './api/exports.server'
import { formatCardTail } from './utils'

export type ExportType = 'bills' | 'payments' | 'benefit_usages' | 'promo_usages' | 'opportunity_usages'

/**
 * 服务端聚合新增的两类表（交易明细 / 分期计划）。
 * 既有 ExportType 的键集合保持不变：components/mobile/ExportDialog.tsx 用
 * `Record<ExportType, string>` 枚举选项，扩键会破坏它的类型契约（该文件归 HUB-171）。
 */
export type ExtendedExportType = ExportType | 'bill_items' | 'installments'

export interface ExportFilters {
  holderId?: string
  cardId?: string
  bankName?: string
  startDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
}

export interface CsvRow {
  [key: string]: string | number | null | undefined
}

/**
 * 单元格转义 + 防公式注入。
 *
 * 既有实现只拦首字符，`' =1+1'`（前导空格后接公式符）能绕过；这里按「任意前导
 * 空白（含 \t \r \n 空格）后接 = + - @」以及独立的 \t / \r 控制字符拦截，
 * 命中即前置单引号中和，Excel / Numbers / Google Sheets 打开都不会执行公式。
 */
export function sanitizeCsvCell(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return ''
  let str = String(field)
  if (/^[\t\r\n ]*[=+\-@]|^[\t\r]/.test(str)) str = `'${str}`
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Build CSV string from headers and rows with UTF-8 BOM.
 * Handles proper CSV escaping for special characters.
 */
export function buildCsv(headers: string[], rows: CsvRow[]): string {
  // UTF-8 BOM for Excel compatibility
  const BOM = '﻿'

  // Build header row
  const headerRow = headers.map(sanitizeCsvCell).join(',')

  // Build data rows
  const dataRows = rows.map(row =>
    headers.map(header => sanitizeCsvCell(row[header])).join(',')
  )

  return [BOM, headerRow, ...dataRows].join('\n')
}

/**
 * Trigger browser download of CSV content.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Generate export filename based on type and date range.
 */
export function generateFilename(type: ExtendedExportType, startDate: string, endDate: string): string {
  const typeLabel: Record<ExtendedExportType, string> = {
    bills: '账单',
    payments: '还款',
    bill_items: '交易明细',
    installments: '分期计划',
    benefit_usages: '权益使用',
    promo_usages: '优惠使用',
    opportunity_usages: '机会台账使用',
  }

  const dateRange = startDate === endDate
    ? startDate
    : `${startDate}_${endDate}`

  return `worldcredit-${typeLabel[type]}-${dateRange}.csv`
}

/**
 * Fetch export data based on type and filters.
 */
export async function getExportData(
  type: ExtendedExportType,
  filters: ExportFilters
): Promise<CsvRow[]> {
  const { holderId, cardId, bankName, startDate, endDate } = filters

  if (!holderId) {
    throw new Error('holderId is required for export')
  }

  switch (type) {
    case 'bill_items':
    case 'installments': {
      // 交易明细与分期计划走服务端聚合（成员隔离在 exports.* 的 memberGuard 里强制），
      // 客户端只负责下载；行结构由服务端表头决定。
      const now = new Date()
      const fallbackPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const result = await callRpc<typeof ExportsServer.exportFamilyCsvRows>(
        'exports',
        'exportFamilyCsvRows',
        {
        scope: 'holder',
        holder_id: holderId,
        mode: 'monthly',
        period: startDate ? startDate.slice(0, 7) : fallbackPeriod,
        table: type,
        card_id: cardId,
        },
      )
      return result.rows
    }
    case 'bills':
      return exportBills(holderId, cardId, bankName, startDate, endDate)
    case 'payments':
      return exportPayments(holderId, cardId, startDate, endDate)
    case 'benefit_usages':
      return exportBenefitUsages(holderId, cardId, startDate, endDate)
    case 'promo_usages':
      return exportPromoUsages(holderId, cardId, startDate, endDate)
    case 'opportunity_usages':
      return exportOpportunityUsageRows(holderId, cardId, startDate, endDate)
    default:
      return []
  }
}

/**
 * Export bills data.
 */
async function exportBills(
  holderId: string,
  cardId?: string,
  bankName?: string,
  startDate?: string,
  endDate?: string
): Promise<CsvRow[]> {
  const bills = await getBillsByHolder(holderId)
  const startMonth = startDate?.slice(0, 7)
  const endMonth = endDate?.slice(0, 7)

  return bills
    .filter(bill => {
      if (cardId && bill.card_id !== cardId) return false
      if (bankName && bill.credit_cards.bank_name !== bankName) return false
      if (startMonth && bill.bill_month < startMonth) return false
      if (endMonth && bill.bill_month > endMonth) return false
      return true
    })
    .map(bill => ({
      '账单月份': bill.bill_month,
      '账户模式': bill.account?.statement_mode === 'merged' ? '合并账单' : '独立账单',
      '关联卡尾号': bill.account_card_tails || formatCardTail(bill.credit_cards.card_number_last4),
      '银行': bill.credit_cards.bank_name,
      '卡片': bill.credit_cards.card_name,
      '卡号末四位': formatCardTail(bill.credit_cards.card_number_last4),
      '账单金额': bill.bill_amount.toFixed(2),
      '最低还款': bill.min_payment?.toFixed(2) ?? '',
      '还款截止日': bill.due_date,
      '状态': bill.status,
      '账单周期开始': bill.statement_start || '',
      '账单周期结束': bill.statement_end || '',
    }))
}

/**
 * Export payments data.
 */
async function exportPayments(
  holderId: string,
  cardId?: string,
  startDate?: string,
  endDate?: string
): Promise<CsvRow[]> {
  const payments = await getPaymentsByHolder(holderId)

  return payments
    .filter(payment => {
      if (cardId && payment.bill.card_id !== cardId) return false
      if (startDate && payment.paid_at < startDate) return false
      if (endDate && payment.paid_at > endDate) return false
      return true
    })
    .map(payment => ({
      '还款日期': payment.paid_at,
      '银行': payment.bill.credit_cards.bank_name,
      // 卡级别覆盖 > 卡产品默认名称；顶层 card_name 由 payments.ts 按同一优先级拼好
      '卡片': payment.bill.credit_cards.card_name ?? payment.bill.credit_cards.card_product?.card_name ?? '',
      '卡号末四位': formatCardTail(payment.bill.credit_cards.card_number_last4),
      '还款金额': payment.amount.toFixed(2),
      '还款渠道': payment.channel,
      '备注': payment.note || '',
      '账单月份': payment.bill.bill_month,
    }))
}

/**
 * Export benefit usages data.
 */
async function exportBenefitUsages(
  holderId: string,
  cardId?: string,
  startDate?: string,
  endDate?: string
): Promise<CsvRow[]> {
  const usages = await getBenefitUsagesByHolder(holderId)

  // 卡筛选传的是 credit_cards.id，权益挂在 card_products 上，需映射
  let cardProductId: string | undefined
  if (cardId) {
    const cards = await getCardsByHolder(holderId)
    cardProductId = cards.find(c => c.id === cardId)?.card_product_id
  }

  return usages
    .filter(usage => {
      if (cardProductId && usage.benefit.card_product_id !== cardProductId) return false
      if (startDate && usage.used_at < startDate) return false
      if (endDate && usage.used_at > endDate) return false
      return true
    })
    .map(usage => ({
      '使用日期': usage.used_at,
      '银行': usage.benefit.card_products.bank_name,
      '卡片': usage.benefit.card_products.card_name,
      '权益名称': usage.benefit.name,
      '权益描述': usage.benefit.description || '',
      '备注': usage.note || '',
      '配额': usage.benefit.quota,
      '周期': usage.benefit.period,
    }))
}

/**
 * Export promo usages data.
 */
async function exportPromoUsages(
  holderId: string,
  cardId?: string,
  startDate?: string,
  endDate?: string
): Promise<CsvRow[]> {
  const usages = await getPromoUsagesByHolder(holderId)

  return usages
    .filter(usage => {
      if (cardId && usage.card_id !== cardId) return false
      if (startDate && usage.used_at < startDate) return false
      if (endDate && usage.used_at > endDate) return false
      return true
    })
    .map(usage => ({
      '使用日期': usage.used_at,
      '银行': usage.promo.bank_name,
      '优惠标题': usage.promo.title,
      '优惠描述': usage.promo.description || '',
      '优惠类型': usage.promo.discount_type || '',
      '备注': usage.note || '',
    }))
}

/**
 * Generate monthly report.
 */
export async function generateMonthlyReport(
  holderId: string,
  month: string // YYYY-MM
): Promise<MonthlyReport> {
  const monthDate = new Date(`${month}-01`)
  const startDate = format(monthDate, 'yyyy-MM-dd')
  const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd')

  // Get analytics for the month
  const analytics = await getAnalyticsByHolder(holderId, startDate, endDate)

  // Get bills for the month
  const bills = await getBillsByHolder(holderId)
  const monthBills = bills.filter(b => b.bill_month === month)

  const totalBilled = monthBills.reduce((sum, b) => sum + b.bill_amount, 0)
  const totalPaid = monthBills.reduce((sum, b) => {
    return sum + (b.status === 'paid' ? b.bill_amount : 0)
  }, 0)
  const overdueCount = monthBills.filter(b => b.status === 'overdue').length

  return {
    month,
    period_start: startDate,
    period_end: endDate,
    total_billed: totalBilled,
    total_paid: totalPaid,
    outstanding: totalBilled - totalPaid,
    overdue_count: overdueCount,
    summary: analytics.summary,
  }
}

/**
 * Generate annual report.
 */
export async function generateAnnualReport(
  holderId: string,
  year: string // YYYY
): Promise<AnnualReport> {
  const months: string[] = []
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${m.toString().padStart(2, '0')}`)
  }

  const monthlyData = await Promise.all(
    months.map(month => generateMonthlyReport(holderId, month))
  )

  const totalBilled = monthlyData.reduce((sum, m) => sum + m.total_billed, 0)
  const totalPaid = monthlyData.reduce((sum, m) => sum + m.total_paid, 0)
  const totalOverdue = monthlyData.reduce((sum, m) => sum + m.overdue_count, 0)

  // Find highest spending month
  const highestMonth = monthlyData.reduce((max, m) =>
    m.total_billed > max.total_billed ? m : max
  , monthlyData[0])

  return {
    year,
    total_billed: totalBilled,
    total_paid: totalPaid,
    outstanding: totalBilled - totalPaid,
    overdue_count: totalOverdue,
    highest_spending_month: highestMonth.month,
    highest_spending_amount: highestMonth.total_billed,
    monthly_breakdown: monthlyData,
  }
}

export interface MonthlyReport {
  month: string // YYYY-MM
  period_start: string
  period_end: string
  total_billed: number
  total_paid: number
  outstanding: number
  overdue_count: number
  summary: unknown // AnalyticsSummary shape from analytics API, passed through
}

export interface AnnualReport {
  year: string
  total_billed: number
  total_paid: number
  outstanding: number
  overdue_count: number
  highest_spending_month: string
  highest_spending_amount: number
  monthly_breakdown: MonthlyReport[]
}

/**
 * 机会台账统一扁平导出（Task 13）：经 RPC 取本人在 scope 内的账本使用，
 * 原币种/单位在表头标注；金额保持 minor units 由调用方展示。
 */
export async function exportOpportunityUsageRows(
  holderId?: string,
  cardId?: string,
  startDate?: string,
  endDate?: string,
): Promise<CsvRow[]> {
  const { exportOpportunityUsages } = await import('./api/opportunities')
  const rows: CsvRow[] = []
  let cursor: string | null = null
  do {
    const page = await exportOpportunityUsages({
      holder_id: holderId ?? null,
      card_id: cardId ?? null,
      from_on: startDate ?? null,
      to_before: endDate ? addOneDay(endDate) : null,
      cursor,
      limit: 200,
    })
    for (const item of page.items) {
      rows.push({
        使用日期: item.used_on,
        类型: item.kind,
        名称: item.title,
        持卡人: item.holder_name,
        卡ID: item.card_id,
        周期: item.cycle_key ?? '',
        数量: item.quantity,
        金额_最小单位: item.amount_minor,
        币种: item.currency ?? '',
        状态: item.status,
        备注: item.note ?? '',
        数据来源: item.source,
      })
    }
    cursor = page.next_cursor
  } while (cursor !== null)
  return rows
}

function addOneDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/** 文件名清洗：去掉路径分隔符与控制字符，避免下载时被截断或注入。 */
export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(name)
    .map(char => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'worldcredit-export.csv'
}

/**
 * 月报 / 年报多段结构化 CSV：分币种总览 → 持卡人小计 → 账单 → 还款 → 交易明细
 * → 分期 → 固定支出 → 分类汇总。所有单元格经 sanitizeCsvCell（UTF-8 BOM +
 * 防公式注入），与 exports.getStatementReport 返回的同一份数据源。
 */
export function statementReportToCsv(report: FamilyStatementReport): string {
  const BOM = '﻿'
  const lines: string[] = []
  const row = (cells: Array<string | number | null | undefined>): string =>
    cells.map(cell => sanitizeCsvCell(cell)).join(',')

  lines.push(row([`worldcredit ${report.scope === 'family' ? '全家庭' : '持卡人'}对账单`]))
  lines.push(row([`报表期间,${report.period},${report.period_start} ~ ${report.period_end}`]))
  lines.push(row([`展示币种,${report.display_currency}`]))
  lines.push('')

  lines.push('# 分币种总览')
  lines.push(row(['币种', '账单', '已还', '未还']))
  for (const [currency, totals] of Object.entries(report.totals_by_currency)) {
    lines.push(row([currency, totals.billed.toFixed(2), totals.paid.toFixed(2), totals.outstanding.toFixed(2)]))
  }
  lines.push(
    row([
      `折算合计（${report.display_currency}）`,
      report.converted_totals.billed.toFixed(2),
      report.converted_totals.paid.toFixed(2),
      report.converted_totals.outstanding.toFixed(2),
    ]),
  )
  if (!report.converted_totals.fx_converted) {
    lines.push(
      row([
        '未折算币种',
        report.converted_totals.fx_unconverted_currencies.join(' ') || '',
      ]),
    )
  }
  lines.push('')

  lines.push('# 持卡人小计')
  lines.push(row(['持卡人', '账单数', '账单总额', '已还', '未还']))
  for (const holder of report.holders) {
    lines.push(
      row([
        holder.holder_name,
        holder.bill_count,
        holder.total_billed.toFixed(2),
        holder.total_paid.toFixed(2),
        holder.outstanding.toFixed(2),
      ]),
    )
  }
  lines.push('')

  lines.push('# 账单')
  lines.push(row(['账单月份', '持卡人', '银行', '卡片', '卡号末四位', '账单金额', '币种', '最低还款', '还款截止日', '状态']))
  for (const bill of report.bills) {
    lines.push(
      row([
        bill.bill_month,
        bill.holder_name,
        bill.bank_name,
        bill.card_name,
        bill.card_tail,
        Number(bill.bill_amount).toFixed(2),
        bill.currency,
        bill.min_payment != null ? Number(bill.min_payment).toFixed(2) : '',
        bill.due_date,
        bill.status,
      ]),
    )
  }
  lines.push('')

  lines.push('# 还款')
  lines.push(row(['还款日期', '持卡人', '银行', '卡片', '卡号末四位', '账单月份', '还款金额', '账单币种', '实付币种', '实付金额', '锁定汇率', '渠道', '备注']))
  for (const payment of report.payments) {
    lines.push(
      row([
        payment.paid_at,
        payment.holder_name,
        payment.bank_name,
        payment.card_name,
        payment.card_tail,
        payment.bill_month,
        payment.amount.toFixed(2),
        payment.currency,
        payment.settled_currency,
        payment.settled_amount != null ? payment.settled_amount.toFixed(2) : '',
        payment.locked_fx_rate,
        payment.channel,
        payment.note,
      ]),
    )
  }
  lines.push('')

  lines.push('# 交易明细')
  lines.push(row(['交易日期', '持卡人', '银行', '卡片', '卡号末四位', '账单月份', '描述', '商户', '分类', '类型', '金额', '币种']))
  for (const item of report.bill_items) {
    lines.push(
      row([
        item.transaction_date,
        item.holder_name,
        item.bank_name,
        item.card_name,
        item.card_tail,
        item.bill_month,
        item.description,
        item.merchant_name,
        item.category,
        item.item_type,
        item.amount.toFixed(2),
        item.currency,
      ]),
    )
  }
  lines.push('')

  lines.push('# 分期计划')
  lines.push(row(['持卡人', '银行', '卡片', '标题', '本金', '币种', '总期数', '已还期数', '剩余本金', '状态', '下期还款日', '下期应还']))
  for (const plan of report.installments) {
    lines.push(
      row([
        plan.holder_name,
        plan.bank_name,
        plan.card_name,
        plan.title,
        plan.principal_amount.toFixed(2),
        plan.currency,
        plan.total_periods,
        plan.paid_periods,
        plan.remaining_principal.toFixed(2),
        plan.status,
        plan.next_due_date,
        plan.next_amount != null ? plan.next_amount.toFixed(2) : '',
      ]),
    )
  }
  lines.push('')

  lines.push('# 固定支出')
  lines.push(row(['名称', '分类', '金额', '币种', '当期', '到期日', '已付', '剩余', '状态']))
  for (const payable of report.payables) {
    lines.push(
      row([
        payable.name,
        payable.category,
        payable.amount.toFixed(2),
        payable.currency,
        payable.period,
        payable.due_date,
        payable.paid_amount.toFixed(2),
        payable.remaining.toFixed(2),
        payable.status,
      ]),
    )
  }
  lines.push('')

  lines.push('# 消费分类汇总')
  lines.push(row(['分类', '金额', '占比%', '笔数']))
  for (const item of report.category_breakdown) {
    lines.push(
      row([item.category, item.amount.toFixed(2), item.percentage.toFixed(2), item.item_count ?? 0]),
    )
  }

  return [BOM, ...lines].join('\n')
}
