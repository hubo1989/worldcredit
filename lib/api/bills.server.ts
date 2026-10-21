import { query, queryOne, execute, batch, uuid, now, today } from '../db'
import type { Bill, Payment, CreditCard, CardProduct } from '../types'
import {
  getDueDate,
  getLoanNextDueDate,
  effectiveBillAmount,
  nextBillingDateOf,
} from '../utils'
import { format } from 'date-fns'

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
      card_name: card.name_override ?? card.card_name ?? card.card_product?.card_name,
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
  // 一律用生效金额：用户手填值优先，否则已还金额会跟展示的金额对不上
  // （屏幕上写着 800、状态却按导入的 1200 判定部分还款）。
  const amount = effectiveBillAmount(bill)
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
  bill_amount_override: number | null
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
  cc_override_billing_day: number | null
  cc_override_due_type: string | null
  cc_override_due_value: number | null
  cc_name_override: string | null
  cc_annual_fee_override: number | null
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
    // 读边界统一把 bill_amount 归一化为「生效金额」（手填值优先）。
    // 让每个消费方自己调用 effectiveBillAmount 是行不通的——本文件与
    // analytics/holders/cards/cron 共有二十多处读取点，漏一处就会两处显示不一致。
    bill_amount: row.bill_amount_override != null ? row.bill_amount_override : row.bill_amount,
    // 手填值原样带出：界面要能显示「已手动设定」并允许改回，
    bill_amount_override: row.bill_amount_override != null ? row.bill_amount_override : undefined,
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
    override_billing_day: row.cc_override_billing_day || undefined,
    override_due_type: (row.cc_override_due_type as CreditCard['override_due_type']) || undefined,
    override_due_value: row.cc_override_due_value || undefined,
    name_override: row.cc_name_override || undefined,
    annual_fee_override: row.cc_annual_fee_override != null ? row.cc_annual_fee_override : undefined,
    created_at: row.cc_created_at || row.created_at,
    card_product: product,
  }
  const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const amount = effectiveBillAmount(bill)
  return {
    ...bill,
    card,
    payments,
    attachments,
    paid_amount: paidAmount,
    remaining_amount: Math.max(0, amount - paidAmount),
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
            cc.loan_due_day AS cc_loan_due_day, cc.override_billing_day AS cc_override_billing_day,
            cc.override_due_type AS cc_override_due_type, cc.override_due_value AS cc_override_due_value,
            cc.name_override AS cc_name_override, cc.annual_fee_override AS cc_annual_fee_override,
            cc.created_at AS cc_created_at,
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
    // Admin sees holders they created; a member sees holders bound to their account.
    conditions.push('(ch.created_by = ? OR ch.auth_user_id = ?)')
    params.push(userId, userId)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const { data: bills, error } = await query<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.override_billing_day AS cc_override_billing_day,
            cc.override_due_type AS cc_override_due_type, cc.override_due_value AS cc_override_due_value,
            cc.name_override AS cc_name_override, cc.annual_fee_override AS cc_annual_fee_override,
            cc.created_at AS cc_created_at,
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
            cc.loan_due_day AS cc_loan_due_day, cc.override_billing_day AS cc_override_billing_day,
            cc.override_due_type AS cc_override_due_type, cc.override_due_value AS cc_override_due_value,
            cc.name_override AS cc_name_override, cc.annual_fee_override AS cc_annual_fee_override,
            cc.created_at AS cc_created_at,
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


export function calculateCardGracePeriod(card: CreditCard & { card_product: CardProduct }, today: Date = new Date()) {
  const d = new Date(today)
  d.setHours(0, 0, 0, 0)
  const billingDay = Number(card.override_billing_day ?? card.billing_day ?? 10)
  if (card.card_type === 'loan' && card.loan_due_day) {
    const nextDueDate = getLoanNextDueDate(card.loan_due_day, d)
    const diffMs = nextDueDate.getTime() - d.getTime()
    return { billingDay, nextBillingDate: nextDueDate, nextDueDate, graceDays: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))) }
  }
  let purchaseMonth = new Date(d.getFullYear(), d.getMonth(), 1)
  const effectiveBillingDay = Math.min(billingDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
  // 账单日当天（含）的交易归下一期：当天已出账，今天的消费进下一期账单。
  // 用 >= 而不是 >：今天 == 账单日时 purchaseMonth 必须推到下月，否则
  // 「今日刷卡免息期」会少算整整一个账期（约 30 天）。
  if (d.getDate() >= effectiveBillingDay) {
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
  /** 下期账单日（今天交易落在下一期，到这天出账） */
  nextBillingDate: Date
  nextDueDate: Date
  historyBills: BillDashboardItem[]
}

export async function getCardsWithBillsSummary(userId?: string): Promise<CardWithBillsSummary[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (userId) {
    conditions.push('(ch.created_by = ? OR ch.auth_user_id = ?)')
    params.push(userId, userId)
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
    // 联查 banks 带出银行维度的额度/账单模式，用户侧按银行分组时要区分
    // 共享额度（额度是一个池不叠加）与合并账单（同银行多卡合一张账单）
    const { data: products } = await query<CardProduct>(
      `SELECT cp.*, b.quota_mode AS bank_quota_mode, b.statement_mode AS bank_statement_mode
       FROM card_products cp LEFT JOIN banks b ON b.id = cp.bank_id
       WHERE cp.id IN (${productIds.map(() => '?').join(',')})`, productIds
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
    const unpaidAmount = unpaidBills.reduce((sum, b) => sum + (b.remaining_amount > 0 ? b.remaining_amount : effectiveBillAmount(b)), 0)
    let status: CardWithBillsSummary['status'] = 'unissued'
    if (unpaidBills.some(b => b.computed_status === 'overdue' || (b.days_until_due < 0 && b.computed_status !== 'paid'))) {
      status = 'overdue'
    } else if (unpaidBills.some(b => b.computed_status === 'partial')) {
      status = 'partial'
    } else if (unpaidBills.length > 0) {
      status = 'unpaid'
    }
    return { card: cardWithProduct, holder_id: card.holder_id, status, activeBill, unpaidAmount, graceDays: graceInfo.graceDays, billingDay: graceInfo.billingDay, nextBillingDate: graceInfo.nextBillingDate, nextDueDate: graceInfo.nextDueDate, historyBills }
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
  void _items
  const { error } = await execute(
    `INSERT INTO bills (id, created_by, card_id, bill_month, statement_start, statement_end, statement_date, bill_amount, min_payment, due_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, (billRow as { created_by?: string }).created_by || null, billRow.card_id, billRow.bill_month, billRow.statement_start || null, billRow.statement_end || null,
     billRow.statement_date || null, billRow.bill_amount, billRow.min_payment || 0, billRow.due_date, billRow.status || 'unpaid']
  )
  if (error) throw new Error(error.message)
  const created = await getBillById(id)
  if (!created) throw new Error('账单创建失败')
  return created as unknown as Bill
}

export interface BillDetail {
  bill: Bill & {
    card?: CreditCard & {
      card_product?: CardProduct
      card_holder?: { id: string; name: string }
    }
  }
  payments: Payment[]
}

/** Bill detail page: bill + card + product + holder + payments in one call. */
export async function getBillDetail(billId: string): Promise<BillDetail> {
  const { data: billRow, error } = await queryOne<Record<string, unknown>>(
    `SELECT b.*, cc.id AS c_id, cc.holder_id AS c_holder_id, cc.card_product_id AS c_card_product_id,
            cc.card_number_last4 AS c_card_number_last4, cc.credit_limit AS c_credit_limit,
            cc.billing_day AS c_billing_day, cc.status AS c_status, cc.card_type AS c_card_type,
            cc.loan_due_day AS c_loan_due_day, cc.override_billing_day AS c_override_billing_day,
            cc.override_due_type AS c_override_due_type, cc.override_due_value AS c_override_due_value,
            cc.name_override AS c_name_override, cc.annual_fee_override AS c_annual_fee_override,
            cc.created_at AS c_created_at,
            cp.id AS p_id, cp.country AS p_country, cp.bank_id AS p_bank_id, cp.bank_name AS p_bank_name,
            cp.card_name AS p_card_name, cp.currency AS p_currency, cp.payment_due_type AS p_payment_due_type,
            cp.payment_due_value AS p_payment_due_value, cp.annual_fee AS p_annual_fee,
            cp.annual_fee_waiver AS p_annual_fee_waiver, cp.is_active AS p_is_active, cp.created_at AS p_created_at,
            ch.id AS h_id, ch.name AS h_name
     FROM bills b
     LEFT JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     LEFT JOIN card_holders ch ON cc.holder_id = ch.id
     WHERE b.id = ?`,
    [billId]
  )
  if (error) throw new Error(error.message)
  if (!billRow) throw new Error('账单不存在')

  const row = billRow as Record<string, unknown>
  const bill = row as unknown as BillDetail['bill']
  // b.* 里带的是导入的原始金额；展示与还款校验必须用生效金额。
  bill.bill_amount = effectiveBillAmount(bill)
  if (row.c_id) {
    const card: CreditCard & {
      card_product?: CardProduct
      card_holder?: { id: string; name: string }
    } = {
      id: row.c_id as string,
      holder_id: row.c_holder_id as string,
      card_product_id: row.c_card_product_id as string,
      card_number_last4: (row.c_card_number_last4 as string) || undefined,
      credit_limit: row.c_credit_limit as number,
      billing_day: row.c_billing_day as number,
      status: row.c_status as CreditCard['status'],
      card_type: row.c_card_type as CreditCard['card_type'],
      loan_due_day: (row.c_loan_due_day as number) || undefined,
      override_billing_day: (row.c_override_billing_day as number) || undefined,
      override_due_type: (row.c_override_due_type as CreditCard['override_due_type']) || undefined,
      override_due_value: (row.c_override_due_value as number) || undefined,
      name_override: (row.c_name_override as string) || undefined,
      annual_fee_override:
        row.c_annual_fee_override != null ? (row.c_annual_fee_override as number) : undefined,
      created_at: row.c_created_at as string,
    }
    if (row.p_id) {
      card.card_product = {
        id: row.p_id as string,
        country: (row.p_country as string) || 'CN',
        bank_id: (row.p_bank_id as string) || undefined,
        bank_name: (row.p_bank_name as string) || '',
        card_name: (row.p_card_name as string) || '',
        currency: (row.p_currency as string) || 'CNY',
        payment_due_type: (row.p_payment_due_type as CardProduct['payment_due_type']),
        payment_due_value: (row.p_payment_due_value as number) ?? 20,
        annual_fee: (row.p_annual_fee as number) ?? 0,
        annual_fee_waiver: (row.p_annual_fee_waiver as string) || undefined,
        is_active: row.p_is_active === 1,
        created_at: (row.p_created_at as string) || (row.c_created_at as string),
      }
    }
    if (row.h_id) {
      card.card_holder = { id: row.h_id as string, name: (row.h_name as string) || '' }
    }
    bill.card = card
  }

  const { data: paymentRows, error: payError } = await query<Payment>(
    'SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_at DESC',
    [billId]
  )
  if (payError) throw new Error(payError.message)
  return { bill, payments: paymentRows || [] }
}

export interface UnpaidBillLite {
  id: string
  bill_month: string
  bill_amount: number
  bill_amount_override: number | null
  status: string
  due_date: string
}

/** Quick "record a payment" picker: unpaid bills ordered by due date.
 * holderIds scopes the result to the RPC member context. */
export async function getUnpaidBills(limit = 50, holderIds?: string[]): Promise<UnpaidBillLite[]> {
  let sql: string
  let params: unknown[]
  if (holderIds && holderIds.length > 0) {
    const placeholders = holderIds.map(() => "?").join(",")
    sql =
      'SELECT b.id, b.bill_month, b.bill_amount, b.bill_amount_override, b.status, b.due_date FROM bills b ' +
      'JOIN credit_cards cc ON b.card_id = cc.id ' +
      `WHERE b.status != 'paid' AND cc.holder_id IN (` + placeholders + `) ORDER BY b.due_date ASC LIMIT ?`
    params = [...holderIds, limit]
  } else {
    sql = `SELECT id, bill_month, bill_amount, bill_amount_override, status, due_date FROM bills WHERE status != 'paid' ORDER BY due_date ASC LIMIT ?`
    params = [limit]
  }
  const { data, error } = await query<UnpaidBillLite>(sql, params)
  if (error) throw new Error(error.message)
  // 这两个投影专门喂给「选择账单 / 还款 / 表单回填」，用的都是生效金额，
  // 所以直接把 bill_amount 归一化为生效值，调用方无需各自记得合成。
  return (data || []).map(row => ({ ...row, bill_amount: effectiveBillAmount(row) }))
}

export interface BillLiteForForm {
  id: string
  bill_amount: number
  bill_amount_override: number | null
  min_payment: number | null
  statement_date: string | null
  due_date: string
}

/** Bill-entry form duplicate check: existing bill for card + month. */
export async function getBillByCardMonth(
  cardId: string,
  billMonth: string
): Promise<BillLiteForForm | null> {
  const { data, error } = await queryOne<BillLiteForForm>(
    'SELECT id, bill_amount, bill_amount_override, min_payment, statement_date, due_date FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1',
    [cardId, billMonth]
  )
  if (error) throw new Error(error.message)
  return data ? { ...data, bill_amount: effectiveBillAmount(data) } : null
}

/** Total paid amount across all payments of one bill. */
export async function getPaymentTotal(billId: string): Promise<number> {
  const { data, error } = await query<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM payments WHERE bill_id = ?',
    [billId]
  )
  if (error) throw new Error(error.message)
  return Number(data?.[0]?.total ?? 0)
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

/**
 * 设置/清除账单的人工金额。
 *
 * `amount = null` 表示撤销手填、回落到导入值。写入成功后 imported（bill_amount）
 * 保持不动，因此撤销是可逆的——这也正是把覆盖值单独存一列的原因。
 */
export async function setBillAmountOverride(billId: string, amount: number | null): Promise<Bill> {
  if (amount !== null) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('账单金额必须是不小于 0 的数字')
    }
  }
  const { error } = await execute('UPDATE bills SET bill_amount_override = ? WHERE id = ?', [
    amount,
    billId,
  ])
  if (error) throw new Error(error.message)
  const updated = await getBillById(billId)
  if (!updated) throw new Error('账单不存在')
  return updated as unknown as Bill
}

/**
 * 按「卡 + 当前账期」设置人工金额，账单尚未生成时先建一条再钉住。
 *
 * 账单日临近时（见 canManuallySetBillAmount）账单往往还没出，此时没有 bill 行
 * 可以改，所以这里需要 upsert。账期由卡的生效账单日推算，与账单页排序同一口径。
 */
export async function setCardManualBillAmount(cardId: string, amount: number): Promise<Bill> {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('账单金额必须是不小于 0 的数字')
  }

  const { data: row, error } = await queryOne<{
    id: string
    billing_day: number
    override_billing_day: number | null
    card_type: string
    loan_due_day: number | null
    card_product_id: string
    p_payment_due_type: string | null
    p_payment_due_value: number | null
  }>(
    `SELECT cc.id, cc.billing_day, cc.override_billing_day, cc.card_type, cc.loan_due_day,
            cc.card_product_id, cp.payment_due_type AS p_payment_due_type,
            cp.payment_due_value AS p_payment_due_value
     FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.id = ?`,
    [cardId]
  )
  if (error) throw new Error(error.message)
  if (!row) throw new Error('卡片不存在')

  // 账期取「下一次账单日」所在月：今天已过账单日就落在下月，否则本月。
  const billingDay = Number(row.override_billing_day ?? row.billing_day ?? 10)
  const billMonth = format(nextBillingDateOf(billingDay), 'yyyy-MM')

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1',
    [cardId, billMonth]
  )

  let billId = existing.data?.id
  if (!billId) {
    const product = {
      payment_due_type: (row.p_payment_due_type || 'after_billing') as CardProduct['payment_due_type'],
      payment_due_value: row.p_payment_due_value ?? 20,
    } as CardProduct
    const card = {
      billing_day: Number(row.billing_day),
      override_billing_day: row.override_billing_day ?? undefined,
      override_due_type: undefined,
      override_due_value: undefined,
      card_type: row.card_type,
      loan_due_day: row.loan_due_day ?? undefined,
    } as unknown as CreditCard
    const dueDate = format(getDueDate(card, product, new Date(`${billMonth}-01T00:00:00`)), 'yyyy-MM-dd')
    billId = uuid()
    const { error: insertError } = await execute(
      `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
       VALUES (?, ?, ?, 0, ?, 'unpaid')`,
      [billId, cardId, billMonth, dueDate]
    )
    if (insertError) throw new Error(insertError.message)
  }

  return setBillAmountOverride(billId, amount)
}

export async function getBillsByHolder(holderId: string): Promise<BillWithCard[]> {
  const { data, error } = await query<BillJoinRow>(
    `SELECT b.*, cc.id AS cc_id, cc.holder_id AS cc_holder_id, cc.card_product_id AS cc_card_product_id,
            cc.card_number_last4 AS cc_card_number_last4, cc.credit_limit AS cc_credit_limit,
            cc.billing_day AS cc_billing_day, cc.status AS cc_status, cc.card_type AS cc_card_type,
            cc.loan_due_day AS cc_loan_due_day, cc.override_billing_day AS cc_override_billing_day,
            cc.override_due_type AS cc_override_due_type, cc.override_due_value AS cc_override_due_value,
            cc.name_override AS cc_name_override, cc.annual_fee_override AS cc_annual_fee_override,
            cc.created_at AS cc_created_at,
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

/**
 * 一键结清。
 *
 * 金额由客户端传入，因此必须服务端校验：生产上真实发生过同一笔 30334.51
 * 相隔 12 秒被提交两次、第二次挂到一张 254.06 元的账单上，而 computeStatus
 * 的 `status === 'paid'` 短路让这笔错误永久不可见。这里做三件事：
 *   1. 拒绝已结清账单（重复提交是主要入口）
 *   2. 拒绝 NaN / 负数 / 超过剩余应还的金额
 *   3. 支付记录与状态更新放进同一个 batch（隐式事务），避免「记了还款但状态没改」
 */
export async function markBillAsPaid(billId: string, amount: number, note = '一键结清'): Promise<void> {
  const bill = await getBillById(billId)
  if (!bill) throw new Error('账单不存在')

  if (bill.status === 'paid') throw new Error('该账单已结清，无需重复还款')

  const billAmount = effectiveBillAmount(bill)
  const alreadyPaid = await getPaymentTotal(billId)
  const remaining = Math.max(0, billAmount - alreadyPaid)
  if (remaining <= 0) throw new Error('该账单已无应还金额，无需重复还款')

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('还款金额必须是大于 0 的数字')
  }
  // 金额列为 REAL，留 0.01 的浮点余量；超过剩余一律拒绝（不再有「已还 > 应还」的账单）
  if (amount > remaining + 0.01) {
    throw new Error(`还款金额超过剩余应还（剩余 ¥${remaining.toFixed(2)}）`)
  }

  const covered = alreadyPaid + amount >= billAmount - 0.01
  const { error } = await batch([
    {
      sql: 'INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      params: [uuid(), billId, amount, today(), '快捷全额结清', note, `pay_${uuid()}`, now()],
    },
    { sql: 'UPDATE bills SET status = ? WHERE id = ?', params: [covered ? 'paid' : 'partial', billId] },
  ])
  if (error) throw new Error(error.message)
}

export interface RecordPaymentInput {
  id?: string
  bill_id: string
  amount: number
  paid_at?: string
  channel?: string | null
  note?: string | null
  idempotency_key: string
}

export interface RecordPaymentResult {
  payment: Payment
  bill_status: Bill['status']
  already_processed?: boolean
}

/**
 * 离线同步与客户端优先还款。
 * 1. 客户端生成 id 与 idempotency_key，防重并支持多次重放。
 * 2. 校验账单状态与剩余应还金额（留 0.01 浮点容差）。
 * 3. 插入还款记录并原子更新账单状态（paid / partial）。
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!input.idempotency_key) {
    throw new Error('缺少 idempotency_key')
  }

  // 1. 幂等检查：若已存在则直接返回
  const existing = await queryOne<Payment>(
    'SELECT * FROM payments WHERE idempotency_key = ?',
    [input.idempotency_key]
  )
  if (existing.data) {
    const bill = await getBillById(input.bill_id)
    return {
      payment: existing.data,
      bill_status: bill?.status ?? 'paid',
      already_processed: true,
    }
  }

  // 2. 校验账单
  const bill = await getBillById(input.bill_id)
  if (!bill) throw new Error('账单不存在')
  if (bill.status === 'paid') throw new Error('该账单已结清，无需重复还款')

  const billAmount = effectiveBillAmount(bill)
  const alreadyPaid = await getPaymentTotal(input.bill_id)
  const remaining = Math.max(0, billAmount - alreadyPaid)
  if (remaining <= 0) throw new Error('该账单已无应还金额，无需重复还款')

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('还款金额必须是大于 0 的数字')
  }
  if (input.amount > remaining + 0.01) {
    throw new Error(`还款金额超过剩余应还（剩余 ¥${remaining.toFixed(2)}）`)
  }

  const paymentId = input.id || uuid()
  const paidAt = input.paid_at || today()
  const channel = input.channel || '手动还款'
  const note = input.note || null
  const covered = alreadyPaid + input.amount >= billAmount - 0.01
  const newStatus: Bill['status'] = covered ? 'paid' : 'partial'
  const ts = now()

  // 3. 原子批处理插入与状态更新
  const { error } = await batch([
    {
      sql: 'INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      params: [paymentId, input.bill_id, input.amount, paidAt, channel, note, input.idempotency_key, ts],
    },
    {
      sql: 'UPDATE bills SET status = ? WHERE id = ?',
      params: [newStatus, input.bill_id],
    },
  ])
  if (error) throw new Error(error.message)

  const created = await queryOne<Payment>('SELECT * FROM payments WHERE id = ?', [paymentId])
  if (!created.data) throw new Error('还款记录保存失败')

  return {
    payment: created.data,
    bill_status: newStatus,
  }
}

export async function markAllOverdueBillsAsPaid(
  userId: string,
  targetBills?: { id: string; remaining_amount?: number; bill_amount?: number }[]
): Promise<{ count: number; totalAmount: number }> {
  // 金额一律以服务端重算为准：入参里的 remaining_amount 来自客户端，与
  // markBillAsPaid 的 amount 同样不可信。getBillDashboardItems 返回的
  // remaining_amount 是服务端按 payments 聚合出来的，才是可用口径。
  const allBills = await getBillDashboardItems(300, userId)
  const onlyIds = targetBills && targetBills.length > 0 ? new Set(targetBills.map(b => b.id)) : null
  const overdueBills = allBills.filter(b =>
    (!onlyIds || onlyIds.has(b.id)) &&
    b.computed_status !== 'paid' &&
    // payments.amount 有 CHECK (amount > 0)，剩余为 0 的账单绝不能进 batch，否则整批失败
    (b.remaining_amount ?? 0) > 0 &&
    (b.computed_status === 'overdue' || b.days_until_due < 0)
  )
  if (overdueBills.length === 0) {
    return { count: 0, totalAmount: 0 }
  }

  const paidAt = today()
  let totalAmount = 0

  const statements = overdueBills.map(bill => {
    const remaining = bill.remaining_amount
    totalAmount += remaining
    return {
      sql: `INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [uuid(), bill.id, remaining, paidAt, '快捷全额结清', '一键全部还款结清', uuid()],
    }
  })

  for (const bill of overdueBills) {
    statements.push({ sql: 'UPDATE bills SET status = ? WHERE id = ?', params: ['paid', bill.id] })
  }

  const { error } = await batch(statements)
  if (error) throw new Error(error.message)

  return { count: overdueBills.length, totalAmount }
}
