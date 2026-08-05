// lib/billParser.ts
import type { BillItemInput } from './api/bills'

export interface ParsedBillItem extends BillItemInput {
  error?: string
  rawLine?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Parse bill items from multiline text.
 *
 * Supported formats:
 * - YYYY-MM-DD description amount category
 * - YYYY/MM/DD description amount category
 * - Tab-separated values
 *
 * Amount < 0 → item_type = 'refund'
 * Amount >= 0 → item_type = 'purchase'
 */
export function parseBillItemsFromText(text: string): ParsedBillItem[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const items: ParsedBillItem[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    const item = parseLine(trimmedLine)
    if (item) {
      items.push(item)
    }
  }

  return items
}

function parseLine(line: string): ParsedBillItem | null {
  // Date pattern: YYYY-MM-DD or YYYY/MM/DD at line start
  const datePattern = /^(\d{4}[-/]\d{2}[-/]\d{2})\s+/
  const dateMatch = line.match(datePattern)

  let transactionDate: string | undefined
  let remainingText = line

  if (dateMatch) {
    transactionDate = dateMatch[1].replace(/\//g, '-')
    remainingText = line.slice(dateMatch[0].length).trim()
  }

  // Split by whitespace (tabs or multiple spaces)
  const parts = remainingText.split(/\s+|\t+/).filter(p => p.trim())

  if (parts.length === 0) {
    return null
  }

  // Find the last parseable number as the amount
  let amount: number | undefined
  let amountIndex = -1

  for (let i = parts.length - 1; i >= 0; i--) {
    const num = parseNumber(parts[i])
    if (num !== null) {
      amount = num
      amountIndex = i
      break
    }
  }

  if (amount === undefined) {
    return {
      transaction_date: transactionDate,
      description: remainingText,
      amount: 0,
      error: '无法解析金额',
      rawLine: line,
      item_type: 'purchase',
      source: 'manual',
    }
  }

  // Everything before the amount is description
  const description = parts.slice(0, amountIndex).join(' ').trim() || '未分类消费'

  // Everything after the amount is category
  const category = parts.slice(amountIndex + 1).join(' ').trim() || undefined

  return {
    transaction_date: transactionDate,
    description,
    amount,
    category,
    item_type: amount < 0 ? 'refund' : 'purchase',
    source: 'manual',
  }
}

function parseNumber(str: string): number | null {
  const cleaned = str.replace(/[,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Validate bill item drafts before submission.
 */
export function validateBillItemDrafts(items: ParsedBillItem[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (items.length === 0) {
    errors.push('至少需要一条明细')
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (!item.description?.trim()) {
      errors.push(`第 ${i + 1} 行缺少商户说明`)
    }

    if (item.amount === 0 && !item.error) {
      errors.push(`第 ${i + 1} 行金额不能为零`)
    }

    if (!item.transaction_date) {
      warnings.push(`第 ${i + 1} 行缺少交易日期，可能影响利息估算`)
    }

    if (item.error) {
      errors.push(`第 ${i + 1} 行: ${item.error}`)
    }
  }

  const total = items.reduce((sum, item) => sum + (item.amount || 0), 0)
  if (total < 0) {
    errors.push('明细合计为负数，不能作为正常账单保存')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
