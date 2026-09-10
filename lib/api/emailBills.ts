import { query, queryOne, execute, uuid, now } from '../db'
import type { EmailParseLog } from '../types'

export interface ParsedEmailBillData {
  is_bill?: boolean
  bank_name?: string
  card_last4?: string
  bill_amount?: number
  min_payment?: number
  due_date?: string
  bill_month?: string
  statement_date?: string
  currency?: string
  confidence?: number
}

export type EmailParseLogWithParsed = EmailParseLog & {
  parsedData?: ParsedEmailBillData
}


export async function getEmailParseLogs(): Promise<EmailParseLogWithParsed[]> {
  const { data, error } = await query<EmailParseLog>(
    'SELECT * FROM email_parse_logs ORDER BY created_at DESC'
  )
  if (error) throw new Error(error.message)
  return (data || []).map(log => {
    let parsedData: ParsedEmailBillData | undefined = undefined
    if (log.raw_ai_response) {
      try {
        parsedData = JSON.parse(log.raw_ai_response)
      } catch {
        console.warn('Parse raw_ai_response failed for log:', log.id)
      }
    }
    return { ...log, parsedData }
  })
}

export interface SyncEmailBillParams {
  logId: string
  holderId?: string
  bankName: string
  cardName: string
  cardNumberLast4: string
  billingDay: number
  billAmount: number
  minPayment?: number
  billMonth: string
  dueDate: string
  statementDate?: string
}

export async function syncEmailBillToAccount(params: SyncEmailBillParams): Promise<{ cardId: string; billId: string }> {
  const { logId, holderId, bankName, cardName, cardNumberLast4, billingDay, billAmount, minPayment = 0, billMonth, dueDate, statementDate } = params

  // 1. Get or create holder
  let targetHolderId = holderId
  if (!targetHolderId) {
    const holderResult = await queryOne<{ id: string }>(
      'SELECT id FROM card_holders ORDER BY created_at ASC LIMIT 1'
    )
    if (holderResult?.data) {
      targetHolderId = holderResult.data.id
    } else {
      const newHolderId = uuid()
      const { error: err } = await execute(
        'INSERT INTO card_holders (id, created_by, managed_by, name, avatar_color) VALUES (?, ?, ?, ?, ?)',
        [newHolderId, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '本人', '#1976d2']
      )
      if (err) throw new Error(err.message)
      targetHolderId = newHolderId
    }
  }

  // 2. Get or create bank
  let bankId: string | undefined = undefined
  const bankResult = await queryOne<{ id: string }>(
    'SELECT id FROM banks WHERE name = ?', [bankName]
  )
  if (bankResult?.data) {
    bankId = bankResult.data.id
  } else {
    const newBankId = uuid()
    const { error: err } = await execute(
      'INSERT INTO banks (id, name, full_name, country) VALUES (?, ?, ?, ?)',
      [newBankId, bankName, bankName, 'CN']
    )
    if (!err) bankId = newBankId
  }

  // 3. Get or create card product
  let cardProductId: string
  const productResult = await queryOne<{ id: string }>(
    'SELECT id FROM card_products WHERE bank_name = ? AND card_name = ?', [bankName, cardName]
  )
  if (productResult?.data) {
    cardProductId = productResult.data.id
  } else {
    cardProductId = uuid()
    const { error: err } = await execute(
      'INSERT INTO card_products (id, bank_id, bank_name, card_name, country, currency, payment_due_type, payment_due_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cardProductId, bankId || null, bankName, cardName, 'CN', 'CNY', 'after_billing', 20]
    )
    if (err) throw new Error(err.message)
  }

  // 4. Get or create credit card
  let targetCardId: string
  const cardConditions = ['holder_id = ?', 'card_product_id = ?']
  const cardParams: unknown[] = [targetHolderId, cardProductId]
  if (cardNumberLast4) {
    cardConditions.push('card_number_last4 = ?')
    cardParams.push(cardNumberLast4)
  }
  const cardResult = await queryOne<{ id: string }>(
    `SELECT id FROM credit_cards WHERE ${cardConditions.join(' AND ')}`, cardParams
  )
  if (cardResult?.data) {
    targetCardId = cardResult.data.id
  } else {
    targetCardId = uuid()
    const { error: err } = await execute(
      'INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      [targetCardId, targetHolderId, cardProductId, cardNumberLast4, billingDay, 'active', 'credit']
    )
    if (err) throw new Error(err.message)
  }

  // 5. Create or update bill
  let targetBillId: string
  const billResult = await queryOne<{ id: string }>(
    'SELECT id FROM bills WHERE card_id = ? AND bill_month = ?', [targetCardId, billMonth]
  )
  if (billResult?.data) {
    targetBillId = billResult.data.id
    await execute(
      'UPDATE bills SET bill_amount = ?, min_payment = ?, due_date = ?, statement_date = ?, statement_end = ?, status = ? WHERE id = ?',
      [billAmount, minPayment, dueDate, statementDate || null, statementDate || null, 'unpaid', targetBillId]
    )
  } else {
    targetBillId = uuid()
    const { error: err } = await execute(
      'INSERT INTO bills (id, card_id, bill_month, statement_start, statement_end, statement_date, bill_amount, min_payment, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [targetBillId, targetCardId, billMonth, statementDate || null, statementDate || null, statementDate || null, billAmount, minPayment, dueDate, 'unpaid']
    )
    if (err) throw new Error(err.message)
  }

  // 6. Update parse log
  await execute(
    "UPDATE email_parse_logs SET status = 'success', bill_id = ?, error_msg = NULL WHERE id = ?",
    [targetBillId, logId]
  )

  return { cardId: targetCardId, billId: targetBillId }
}
