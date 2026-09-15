// lib/export.ts
import { format, endOfMonth } from 'date-fns'
import { getBillsByHolder } from './api/bills'
import { getCardsByHolder } from './api/cards'
import { getPaymentsByHolder } from './api/payments'
import { getBenefitUsagesByHolder } from './api/benefitUsages'
import { getPromoUsagesByHolder } from './api/promoUsages'
import { getAnalyticsByHolder } from './api/analytics'
import { formatCardTail } from './utils'

export type ExportType = 'bills' | 'payments' | 'benefit_usages' | 'promo_usages'

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
 * Build CSV string from headers and rows with UTF-8 BOM.
 * Handles proper CSV escaping for special characters.
 */
export function buildCsv(headers: string[], rows: CsvRow[]): string {
  // UTF-8 BOM for Excel compatibility
  const BOM = '﻿'

  // Escape CSV field according to RFC 4180
  const escapeField = (field: string | number | null | undefined): string => {
    if (field === null || field === undefined) return ''
    const str = String(field)
    // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Build header row
  const headerRow = headers.map(escapeField).join(',')

  // Build data rows
  const dataRows = rows.map(row =>
    headers.map(header => escapeField(row[header])).join(',')
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
export function generateFilename(type: ExportType, startDate: string, endDate: string): string {
  const typeLabel: Record<ExportType, string> = {
    bills: '账单',
    payments: '还款',
    benefit_usages: '权益使用',
    promo_usages: '优惠使用',
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
  type: ExportType,
  filters: ExportFilters
): Promise<CsvRow[]> {
  const { holderId, cardId, bankName, startDate, endDate } = filters

  if (!holderId) {
    throw new Error('holderId is required for export')
  }

  switch (type) {
    case 'bills':
      return exportBills(holderId, cardId, bankName, startDate, endDate)
    case 'payments':
      return exportPayments(holderId, cardId, startDate, endDate)
    case 'benefit_usages':
      return exportBenefitUsages(holderId, cardId, startDate, endDate)
    case 'promo_usages':
      return exportPromoUsages(holderId, cardId, startDate, endDate)
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
