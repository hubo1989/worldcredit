// lib/billRecognizer.ts
import { parse, format } from 'date-fns'
import type { BillItemInput } from './api/bills'

export interface BillDraftPayload {
  card_id?: string
  bill_month?: string
  statement_start?: string
  statement_end?: string
  statement_date?: string
  bill_amount?: number
  min_payment?: number
  due_date?: string
  items?: BillDraftItem[]
  raw_text?: string
}

export interface BillDraftItem {
  transaction_date?: string
  description: string
  amount: number
  category?: string
  item_type: 'purchase' | 'refund' | 'fee' | 'interest'
  confidence?: number
  raw_text?: string
}

export interface ValidationResult {
  valid: boolean
  confidence: number
  errors: string[]
  warnings: string[]
}

/**
 * Recognize bill structure from raw text (SMS/email format).
 *
 * Supports common Chinese bank formats:
 * - 招商银行: "您账户1234账单金额¥1234.56..."
 * - 中信银行: "您的信用卡账单已出..."
 * - Generic: extract amounts, dates, card numbers
 */
export function recognizeBillFromText(text: string): BillDraftPayload {
  const cleanText = text.replace(/\s+/g, ' ').trim()
  const draft: BillDraftPayload = {
    raw_text: cleanText,
    items: [],
  }

  // Extract card number (last 4 digits)
  const cardMatch = cleanText.match(/(\*{0,2}\d{4})|(\d{4})/)
  if (cardMatch) {
    // Card ID will be resolved by user selection
  }

  // Extract bill amount (¥1234.56 or 1234.56元)
  const amountMatch = cleanText.match(/[¥￥]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))/)
  if (amountMatch) {
    draft.bill_amount = parseFloat(amountMatch[1].replace(/,/g, ''))
  }

  // Extract minimum payment
  const minPaymentMatch = cleanText.match(/最低还款额[¥￥]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|)/)
  if (minPaymentMatch) {
    draft.min_payment = parseFloat(minPaymentMatch[1].replace(/,/g, ''))
  }

  // Extract due date (YYYY-MM-DD or MM-DD)
  const datePatterns = [
    /(\d{4})-(\d{1,2})-(\d{1,2})/, // YYYY-MM-DD
    /(\d{4})年(\d{1,2})月(\d{1,2})日/, // YYYY年MM月DD日
    /(\d{1,2})月(\d{1,2})日.*到期/, // MM月DD日到期
  ]

  for (const pattern of datePatterns) {
    const match = cleanText.match(pattern)
    if (match) {
      try {
        if (match.length === 4 && match[1]) {
          // Full date with year
          draft.due_date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
        } else if (match.length === 3) {
          // Month-day only, assume current year
          const year = new Date().getFullYear()
          draft.due_date = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
        }
        break
      } catch {
        // Invalid date, continue
      }
    }
  }

  // Extract statement period
  const periodMatch = cleanText.match(/(\d{4})-(\d{1,2})月账单|账单周期.*?(\d{4})-(\d{1,2})/)
  if (periodMatch) {
    const year = periodMatch[1] || periodMatch[3]
    const month = periodMatch[2] || periodMatch[4]
    draft.bill_month = `${year}-${month.padStart(2, '0')}`

    try {
      const monthDate = parse(`${year}-${month.padStart(2, '0')}`, 'yyyy-MM', new Date())
      draft.statement_start = format(monthDate, 'yyyy-MM-01')
      draft.statement_end = format(monthDate, 'yyyy-MM-dd')
    } catch {
      // Invalid date
    }
  }

  // Extract transaction items (if present in structured format)
  draft.items = extractItems(cleanText)

  return draft
}

/**
 * Extract transaction items from text.
 * Looks for patterns like: "MM月DD日 商户 金额"
 */
function extractItems(text: string): BillDraftItem[] {
  const items: BillDraftItem[] = []

  // Pattern: MM月DD日 + description + amount
  const itemPattern = /(\d{1,2})月(\d{1,2})日\s+([^\d¥￥]+?)\s+[¥￥]?(\d+\.?\d*)/g
  let match

  while ((match = itemPattern.exec(text)) !== null) {
    const month = match[1].padStart(2, '0')
    const day = match[2].padStart(2, '0')
    const description = match[3].trim()
    const amount = parseFloat(match[4])

    if (description && !isNaN(amount)) {
      items.push({
        transaction_date: `${new Date().getFullYear()}-${month}-${day}`,
        description,
        amount,
        item_type: amount < 0 ? 'refund' : 'purchase',
        confidence: 0.7,
      })
    }
  }

  return items
}

/**
 * Validate a bill draft and calculate confidence score.
 */
export function validateBillDraft(draft: BillDraftPayload): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let confidence = 0

  // Check required fields
  if (!draft.bill_amount || draft.bill_amount <= 0) {
    errors.push('缺少账单金额')
  } else {
    confidence += 0.25
  }

  if (!draft.due_date) {
    errors.push('缺少还款截止日')
  } else {
    confidence += 0.2
  }

  if (!draft.bill_month) {
    errors.push('缺少账单月份')
  } else {
    confidence += 0.15
  }

  // Optional but recommended fields
  if (draft.min_payment && draft.min_payment > 0) {
    confidence += 0.1
  }

  if (draft.statement_start && draft.statement_end) {
    confidence += 0.1
  }

  // Check items
  if (draft.items && draft.items.length > 0) {
    confidence += 0.2

    const itemsTotal = draft.items.reduce((sum, item) => sum + (item.amount || 0), 0)

    if (draft.bill_amount && Math.abs(itemsTotal - draft.bill_amount) > 0.01) {
      warnings.push(`明细合计 (¥${itemsTotal.toFixed(2)}) 与账单金额 (¥${draft.bill_amount.toFixed(2)}) 不一致`)
    }

    // Check item quality
    const validItems = draft.items.filter(item => item.description && item.amount !== 0)
    if (validItems.length < draft.items.length) {
      warnings.push('部分明细信息不完整')
    }
  } else {
    warnings.push('未识别到交易明细')
  }

  // Final confidence adjustment
  if (errors.length > 0) {
    confidence = Math.max(0, confidence - 0.3)
  }

  if (warnings.length > 2) {
    confidence = Math.max(0, confidence - 0.2)
  }

  return {
    valid: errors.length === 0,
    confidence: Math.min(1, Math.max(0, confidence)),
    errors,
    warnings,
  }
}

/**
 * Generate warning messages for a bill draft.
 */
export function generateWarnings(draft: BillDraftPayload): string[] {
  const warnings: string[] = []
  const validation = validateBillDraft(draft)

  warnings.push(...validation.warnings)

  // Low confidence warning
  if (validation.confidence < 0.5) {
    warnings.push('识别置信度较低，建议人工核对')
  }

  // Missing recommended fields
  if (!draft.card_id) {
    warnings.push('未识别到信用卡，请手动选择')
  }

  if (!draft.min_payment && draft.bill_amount && draft.bill_amount > 0) {
    warnings.push('未识别到最低还款额')
  }

  return warnings
}
