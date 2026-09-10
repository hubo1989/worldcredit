import { query, queryOne, execute, batch, uuid, now, today, getDb } from '../db'
import type { Bill, Payment, CreditCard, CardProduct } from '../types'
import { getDueDate, getLoanNextDueDate } from '../utils'

export type BillDashboardItem = Bill & {
  card: CreditCard & { card_product: CardProduct }
  payments: Pick<Payment, 'id' | 'amount' | 'paid_at' | 'channel' | 'note'>[]
  attachments?: { id: string; file_name: string; public_url?: string }[]
  paid_amount: number
  remaining_amount: number
  days_until_due: number
  interest_free_days_left: number
  computed_status: Bill['status']
}

export type BillWithCard = Bill & {
  credit_cards: CreditCard & {
    bank_name?: string
    card_name?: string
    card_number_last4?: string
    card_product?: CardProduct
  }
}

export type PaymentWithBill = Payment & {
  bill: BillWithCard
}

function withCreditCardProductFields(bill: BillWithCard): BillWithCard {
  const card = bill.credit_cards
  return {
    ...bill,
    credit_cards: {
      ...card,
      bank_name: card.bank_name ?? card.card_product?.bank_name,
      card_name: card.card_name ?? card.card_product?.card_name,
    },
  }
}

function daysUntil(date: string): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - d.getTime()) / (24 * 60 * 60 * 1000))
}

function computeStatus(bill: Bill, paidAmount: number): Bill['status'] {
  if (bill.status === 'paid') return 'paid'
  const amount = Number(bill.bill_amount) || 0
  if (amount <= 0 || paidAmount >= amount) return 'paid'
  if (paidAmount > 0) return 'partial'
  if (daysUntil(bill.due_date) < 0) return 'overdue'
  return 'unpaid'
}

// ---- Row types for JOIN queries ----

interface BillJoinRow extends Record<string, unknown> {
  // bills fields
  id: string
  card_id: string
  bill_month: string
  statement_start: string | null
  statement_end: string | null
  statement_date: string | null
  bill_amount: number
  min_payment: number | null
  due_date: string
  status: Bill['status']
  created_at: string
  // credit_cards fields
  cc_id: string | null
  cc_holder_id: string | null
  cc_card_product_id: string | null
  cc_card_number_last4: string | null
  cc_credit_limit: number | null
  cc_billing_day: number | null
  cc_status: string | null
  cc_card_type: string | null
  cc_loan_due_day: number | null
  cc_created_at: string | null
  // card_products fields
  cp_id: string | null
  cp_bank_name: string | null
  cp_card_name: string | null
  cp_currency: string | null
  cp_country: string | null
  cp_payment_due_type: string | null
  cp_payment_due_value: number | null
  cp_is_active: number | null
  cp_created_at: string | null
}

function mapJoinRowToDashboard(
  row: BillJoinRow,
  payments: Pick<Payment, 'id' | 'amount' | 'paid_at' | 'channel' | 'note'>[],
  attachments?: { id: string; file_name: string; public_url?: string }[]
): BillDashboardItem {
  const bill: Bill = {
    id: row.id,
    card_id: row.card_id,
    bill_month: row.bill_month,
    statement_start: row.statement_start || undefined,
    statement_end: row.statement_end || undefined,
    statement_date: row.statement_date || undefined,
    bill_amount: row.bill_amount,
    min_payment: row.min_payment || undefined,
    due_date: row.due_date,
    status: row.status,
    created_at: row.created_at,
  }
  const product: CardProduct = row.cp_id ? {
    id: row.cp_id,
    country: row.cp_country || 'CN',
    bank_name: row.cp_bank_name || '',
    card_name: row.cp_card_name || '',
    currency: row.cp_currency || 'CNY',
    payment_due_type: (row.cp_payment_due_type || 'after_billing') as CardProduct['payment_due_type'],
    payment_due_value: row.cp_payment_due_value || 20,
    is_active: row.cp_is_active === 1,
    created_at: row.cp_created_at || row.created_at,
  } : {
    id: row.cc_card_product_id || '',
    bank_name: '银行卡',
    card_name: '标准信用卡',
    country: 'CN',
    currency: 'CNY',
    payment_due_type: 'after_billing',
    payment_due_value: 20,
    is_active: true,
    created_at: new Date().toISOString(),
  }
  const card: CreditCard & { card_product: CardProduct } = {
    id: row.cc_id || '',
    holder_id: row.cc_holder_id || '',
    card_product_id: row.cc_card_product_id || '',
    card_number_last4: row.cc_card_number_last4 || undefined,
    credit_limit: row.cc_credit_limit || 0,
    billing_day: row.cc_billing_day || 1,
    status: (row.cc_status || 'active') as CreditCard['status'],
    card_type: (row.cc_card_type || 'credit') as CreditCard['card_type'],
    loan_due_day: row.cc_loan_due_day || undefined,
    created_at: row.cc_created_at || row.created_at,
    card_product: product,
  }
  const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  return {
    ...bill,
    card,
    payments,
    attachments,
    paid_amount: paidAmount,
    remaining_amount: Math.max(0, Number(bill.bill_amount || 0) - paidAmount),
    days_until_due: daysUntil(bill.due_date),
    interest_free_days_left: Math.max(0, daysUntil(bill.due_date)),
    computed_status: computeStatus(bill, paidAmount),
  }
}

export async function getBillsByCard(cardId: string): Promise<Bill[]> {
  const { data, error } = await query<Bill>(
    'SELECT * FROM bills WHERE card_id = ? ORDER BY statement_end DESC', [cardId]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function getRecentBills(limit = 10): Promise<(Bill & { card: CreditCard & { card_product: CardProduct } })[]> {
  const { data, error } = await query<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.created_at AS cc_created_at,
            cp.id AS cp_id, cp.bank_name AS cp_bank_name, cp.card_name AS cp_card_name,
            cp.currency AS cp_currency, cp.country AS cp_country,
            cp.payment_due_type AS cp_payment_due_type, cp.payment_due_value AS cp_payment_due_value,
            cp.is_active AS cp_is_active, cp.created_at AS cp_created_at
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     ORDER BY b.due_date ASC LIMIT ?`,
    [limit]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(row => {
    const item = mapJoinRowToDashboard(row, [])
    return { ...item, card: item.card }
  })
}

export async function getBillDashboardItems(limit = 100, userId?: string): Promise<BillDashboardItem[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (userId) {
    conditions.push('ch.created_by = ?')
    params.push(userId)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const { data: bills, error } = await query<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.created_at AS cc_created_at,
            cp.id AS cp_id, cp.bank_name AS cp_bank_name, cp.card_name AS cp_card_name,
            cp.currency AS cp_currency, cp.country AS cp_country,
            cp.payment_due_type AS cp_payment_due_type, cp.payment_due_value AS cp_payment_due_value,
            cp.is_active AS cp_is_active, cp.created_at AS cp_created_at
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     JOIN card_holders ch ON cc.holder_id = ch.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     ${where}
     ORDER BY b.due_date ASC LIMIT ?`,
    [...params, limit]
  )
  if (error) throw new Error(error.message)
  const rawBills = bills || []
  if (rawBills.length === 0) return []

  const billIds = rawBills.map(b => b.id)
  const productIds = Array.from(new Set(rawBills.map(b => b.cc_card_product_id).filter(Boolean))) as string[]

  // Batch fetch payments and attachments
  const [paymentsRes, attachmentsRes] = await Promise.all([
    query<Payment & { bill_id: string }>(
      `SELECT id, bill_id, amount, paid_at, channel, note FROM payments WHERE bill_id IN (${billIds.map(() => '?').join(',')})`,
      billIds
    ),
    query<{ id: string; record_id: string; file_name: string }>(
      `SELECT id, record_id, file_name FROM record_attachments WHERE record_type = 'bill' AND record_id IN (${billIds.map(() => '?').join(',')})`,
      billIds
    ),
  ])

  const paymentsByBill: Record<string, NonNullable<typeof paymentsRes.data>> = {}
  for (const p of paymentsRes.data || []) {
    if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = []
    paymentsByBill[p.bill_id].push(p)
  }
  const attachmentsByBill: Record<string, { id: string; file_name: string; public_url?: string }[]> = {}
  for (const a of attachmentsRes.data || []) {
    if (!attachmentsByBill[a.record_id]) attachmentsByBill[a.record_id] = []
    attachmentsByBill[a.record_id].push({ id: a.id, file_name: a.file_name, public_url: `/api/attachments/${a.id}` })
  }

  return rawBills.map(row =>
    mapJoinRowToDashboard(
      row,
      (paymentsByBill[row.id] || []).map(p => ({ id: p.id, amount: p.amount, paid_at: p.paid_at, channel: p.channel, note: p.note })),
      attachmentsByBill[row.id]
    )
  )
}

export async function getBillById(id: string): Promise<BillWithCard | null> {
  const { data, error } = await queryOne<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.created_at AS cc_created_at,
            cp.id AS cp_id, cp.bank_name AS cp_bank_name, cp.card_name AS cp_card_name,
            cp.currency AS cp_currency, cp.country AS cp_country,
            cp.payment_due_type AS cp_payment_due_type, cp.payment_due_value AS cp_payment_due_value,
            cp.is_active AS cp_is_active, cp.created_at AS cp_created_at
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE b.id = ?`, [id]
  )
  if (error) throw new Error(error.message)
  if (!data) return null
  const dashboard = mapJoinRowToDashboard(data, [])
  const billWithCard: BillWithCard = {
    ...dashboard,
    credit_cards: dashboard.card,
  }
  return withCreditCardProductFields(billWithCard)
}


export function calculateCardGracePeriod(card: CreditCard & { card_product: CardProduct }) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const billingDay = Number(card.override_billing_day ?? card.billing_day ?? 10)
  if (card.card_type === 'loan' && card.loan_due_day) {
    const nextDueDate = getLoanNextDueDate(card.loan_due_day, d)
    const diffMs = nextDueDate.getTime() - d.getTime()
    return { billingDay, nextBillingDate: nextDueDate, nextDueDate, graceDays: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))) }
  }
  let purchaseMonth = new Date(d.getFullYear(), d.getMonth(), 1)
  const effectiveBillingDay = Math.min(billingDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
  if (d.getDate() > effectiveBillingDay) {
    purchaseMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  }
  const nextBillingDate = new Date(purchaseMonth.getFullYear(), purchaseMonth.getMonth(), effectiveBillingDay)
  const nextDueDate = getDueDate(card, card.card_product, purchaseMonth)
  const diffMs = nextDueDate.getTime() - d.getTime()
  return { billingDay, nextBillingDate, nextDueDate, graceDays: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))) }
}

export interface CardWithBillsSummary {
  card: CreditCard & { card_product: CardProduct }
  holder_id: string
  status: 'overdue' | 'unpaid' | 'partial' | 'unissued'
  activeBill: BillDashboardItem | null
  unpaidAmount: number
  graceDays: number
  billingDay: number
  nextDueDate: Date
  historyBills: BillDashboardItem[]
}

export async function getCardsWithBillsSummary(userId?: string): Promise<CardWithBillsSummary[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (userId) {
    conditions.push('ch.created_by = ?')
    params.push(userId)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const { data: rawCards, error: cardError } = await query<Record<string, unknown>>(
    `SELECT cc.* FROM credit_cards cc JOIN card_holders ch ON cc.holder_id = ch.id${where} ORDER BY cc.created_at DESC`,
    params
  )
  if (cardError) throw new Error(cardError.message)

  const cards = (rawCards || []) as unknown as CreditCard[]
  if (cards.length === 0) return []

  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  let productMap: Record<string, CardProduct> = {}
  if (productIds.length > 0) {
    const { data: products } = await query<CardProduct>(
      `SELECT * FROM card_products WHERE id IN (${productIds.map(() => '?').join(',')})`, productIds
    )
    if (products) {
      productMap = products.reduce((acc, p) => ({ ...acc, [p.id]: p }), {})
    }
  }

  const allBills = await getBillDashboardItems(500, userId)
  const billsByCardId = new Map<string, BillDashboardItem[]>()
  for (const b of allBills) {
    const cid = b.card_id
    if (!billsByCardId.has(cid)) billsByCardId.set(cid, [])
    billsByCardId.get(cid)!.push(b)
  }

  return cards.map(card => {
    const product = productMap[card.card_product_id] || {
      id: card.card_product_id, bank_name: '银行卡', card_name: '标准信用卡',
      country: 'CN', currency: 'CNY', payment_due_type: 'after_billing' as const,
      payment_due_value: 20, is_active: true, created_at: new Date().toISOString()
    }
    const cardWithProduct = { ...card, card_product: product }
    const graceInfo = calculateCardGracePeriod(cardWithProduct)
    const cardBills = billsByCardId.get(card.id) || []
    const historyBills = [...cardBills].sort((a, b) => {
      const timeA = new Date(a.due_date || a.statement_end || '2000-01-01').getTime()
      const timeB = new Date(b.due_date || b.statement_end || '2000-01-01').getTime()
      return timeB - timeA
    })
    const unpaidBills = historyBills.filter(b => b.computed_status !== 'paid')
    const activeBill = unpaidBills.length > 0 ? unpaidBills[0] : (historyBills[0] || null)
    const unpaidAmount = unpaidBills.reduce((sum, b) => sum + (b.remaining_amount > 0 ? b.remaining_amount : Number(b.bill_amount || 0)), 0)
    let status: CardWithBillsSummary['status'] = 'unissued'
    if (unpaidBills.some(b => b.computed_status === 'overdue' || (b.days_until_due < 0 && b.computed_status !== 'paid'))) {
      status = 'overdue'
    } else if (unpaidBills.some(b => b.computed_status === 'partial')) {
      status = 'partial'
    } else if (unpaidBills.length > 0) {
      status = 'unpaid'
    }
    return { card: cardWithProduct, holder_id: card.holder_id, status, activeBill, unpaidAmount, graceDays: graceInfo.graceDays, billingDay: graceInfo.billingDay, nextDueDate: graceInfo.nextDueDate, historyBills }
  })
}


/** 账单明细输入 */
export interface BillItemInput {
  transaction_date?: string
  post_date?: string
  description: string
  merchant_name?: string
  category?: string
  amount: number
  currency?: string
  item_type: 'purchase' | 'refund' | 'fee' | 'interest'
  source: 'manual' | 'llm' | 'email' | 'sms' | 'image' | 'pdf'
  confidence?: number
  raw_text?: string
  metadata?: Record<string, unknown>
}

export async function createBill(
  bill: Omit<Bill, 'id' | 'created_at'> & { items?: BillItemInput[] }
): Promise<Bill> {
  const id = uuid()
  const { items: _items, ...billRow } = bill
  const { error } = await execute(
    `INSERT INTO bills (id, card_id, bill_month, statement_start, statement_end, statement_date, bill_amount, min_payment, due_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, billRow.card_id, billRow.bill_month, billRow.statement_start || null, billRow.statement_end || null,
     billRow.statement_date || null, billRow.bill_amount, billRow.min_payment || 0, billRow.due_date, billRow.status || 'unpaid']
  )
  if (error) throw new Error(error.message)
  const created = await getBillById(id)
  if (!created) throw new Error('账单创建失败')
  return created as unknown as Bill
}

export async function updateBill(id: string, data: Partial<Omit<Bill, 'id' | 'created_at'>>): Promise<Bill> {
  const fields: string[] = []
  const params: unknown[] = []
  const updatableKeys: (keyof Bill)[] = ['bill_month', 'statement_start', 'statement_end', 'statement_date', 'bill_amount', 'min_payment', 'due_date', 'status']
  for (const key of updatableKeys) {
    const val = (data as Record<string, unknown>)[key]
    if (val !== undefined) {
      fields.push(`${key} = ?`)
      params.push(val)
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE bills SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const updated = await getBillById(id)
  if (!updated) throw new Error('账单更新失败')
  return updated as unknown as Bill
}

export async function updateBillStatus(id: string, status: Bill['status']): Promise<Bill> {
  const { error } = await execute('UPDATE bills SET status = ? WHERE id = ?', [status, id])
  if (error) throw new Error(error.message)
  const updated = await getBillById(id)
  if (!updated) throw new Error('账单更新失败')
  return updated as unknown as Bill
}

export async function getBillsByHolder(holderId: string): Promise<BillWithCard[]> {
  const { data, error } = await query<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.created_at AS cc_created_at,
            cp.id AS cp_id, cp.bank_name AS cp_bank_name, cp.card_name AS cp_card_name,
            cp.currency AS cp_currency, cp.country AS cp_country,
            cp.payment_due_type AS cp_payment_due_type, cp.payment_due_value AS cp_payment_due_value,
            cp.is_active AS cp_is_active, cp.created_at AS cp_created_at
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.holder_id = ?
     ORDER BY b.bill_month DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(row => {
    const dashboard = mapJoinRowToDashboard(row, [])
    return withCreditCardProductFields({ ...dashboard, credit_cards: dashboard.card } as BillWithCard)
  })
}

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await query<Payment>(
    'SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_at DESC', [billId]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function createPayment(
  payment: Omit<Payment, 'id' | 'created_at' | 'idempotency_key'>
): Promise<Payment> {
  const id = uuid()
  const key = `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const ts = now()
  const { error } = await execute(
    'INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, payment.bill_id, payment.amount, payment.paid_at, payment.channel || null, payment.note || null, key, ts]
  )
  if (error) throw new Error(error.message)
  const created = await queryOne<Payment>('SELECT * FROM payments WHERE id = ?', [id])
  if (!created.data) throw new Error('还款记录创建失败')
  return created.data
}

export async function markBillAsPaid(billId: string, amount: number, note = '一键结清'): Promise<void> {
  await createPayment({
    bill_id: billId,
    amount,
    paid_at: today(),
    channel: '快捷全额结清',
    note,
  })
  await updateBillStatus(billId, 'paid')
}

export async function markAllOverdueBillsAsPaid(
  userId: string,
  targetBills?: { id: string; remaining_amount?: number; bill_amount?: number }[]
): Promise<{ count: number; totalAmount: number }> {
  let overdueBills = targetBills
  if (!overdueBills || overdueBills.length === 0) {
    const allBills = await getBillDashboardItems(300, userId)
    overdueBills = allBills.filter(b => b.computed_status === 'overdue' || (b.days_until_due < 0 && b.computed_status !== 'paid'))
  }
  if (!overdueBills || overdueBills.length === 0) {
    return { count: 0, totalAmount: 0 }
  }

  const billIds = overdueBills.map(b => b.id)
  const paidAt = today()
  let totalAmount = 0

  const statements = overdueBills.map(bill => {
    const remaining = (bill.remaining_amount !== undefined && bill.remaining_amount > 0)
      ? bill.remaining_amount
      : Number(bill.bill_amount || 0)
    totalAmount += remaining
    return {
      sql: `INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [uuid(), bill.id, remaining, paidAt, '快捷全额结清', '一键全部还款结清', uuid()],
    }
  })

  // Add status updates
  for (const billId of billIds) {
    statements.push({ sql: 'UPDATE bills SET status = ? WHERE id = ?', params: ['paid', billId] })
  }

  const { error } = await batch(statements)
  if (error) throw new Error(error.message)

  return { count: overdueBills.length, totalAmount }
}
