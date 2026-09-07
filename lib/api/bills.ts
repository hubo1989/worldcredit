import { insforge } from '../insforge'
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
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function computeStatus(bill: Bill, paidAmount: number): Bill['status'] {
  if (bill.status === 'paid') return 'paid'
  const amount = Number(bill.bill_amount) || 0
  if (amount <= 0 || paidAmount >= amount) return 'paid'
  if (paidAmount > 0) return 'partial'
  if (daysUntil(bill.due_date) < 0) return 'overdue'
  return 'unpaid'
}

/**
 * 获取特定信用卡的所有账单
 */
export async function getBillsByCard(cardId: string): Promise<Bill[]> {
  const { data, error } = await insforge.database
    .from('bills')
    .select('*')
    .eq('card_id', cardId)
    .order('statement_end', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * 获取全局最近账单（按到期日排序）
 */
export async function getRecentBills(limit = 10): Promise<(Bill & { card: CreditCard & { card_product: CardProduct } })[]> {
  const { data: bills, error } = await insforge.database
    .from('bills')
    .select('*, card:credit_cards(*)')
    .order('due_date', { ascending: true })
    .limit(limit)
  
  if (error) throw error
  if (!bills || bills.length === 0) return []

  const productIds = Array.from(new Set(bills.map(b => (b.card as any)?.card_product_id).filter(Boolean)))
  let productMap: Record<string, CardProduct> = {}

  if (productIds.length > 0) {
    const { data: products } = await insforge.database
      .from('card_products')
      .select('*')
      .in('id', productIds)

    if (products) {
      productMap = products.reduce((acc, p) => ({ ...acc, [p.id]: p }), {})
    }
  }

  return bills.map(b => ({
    ...b,
    card: {
      ...b.card,
      card_product: productMap[b.card.card_product_id] || {
        id: b.card.card_product_id,
        bank_name: '银行卡',
        card_name: '标准信用卡',
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        is_active: true,
        created_at: new Date().toISOString()
      }
    }
  }))
}

/**
 * 获取账单仪表盘数据：账单 + 信用卡 + 产品 + 还款聚合。
 * 支持传入 userId 限定只查询当前用户名下持卡人的信用卡与账单。
 */
export async function getBillDashboardItems(limit = 100, userId?: string): Promise<BillDashboardItem[]> {
  const query = userId
    ? insforge.database
        .from('bills')
        .select('*, card:credit_cards!inner(*, card_holders!inner(created_by)), payments(id,amount,paid_at,channel,note)')
        .eq('card.card_holders.created_by', userId)
    : insforge.database
        .from('bills')
        .select('*, card:credit_cards(*), payments(id,amount,paid_at,channel,note)')

  const { data, error } = await query
    .order('due_date', { ascending: true })
    .limit(limit)

  if (error) throw error

  const rawBills = (data || []) as Array<Bill & {
    card: CreditCard
    payments?: Pick<Payment, 'id' | 'amount' | 'paid_at' | 'channel' | 'note'>[]
  }>

  if (rawBills.length === 0) return []

  const productIds = Array.from(new Set(rawBills.map(b => b.card?.card_product_id).filter(Boolean)))
  const billIds = rawBills.map(b => b.id)

  // 并行获取 card_products 和 record_attachments
  const [productsRes, attachmentsRes] = await Promise.all([
    productIds.length > 0
      ? insforge.database.from('card_products').select('*').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    billIds.length > 0
      ? insforge.database.from('record_attachments').select('id,record_id,file_name,public_url').eq('record_type', 'bill').in('record_id', billIds)
      : Promise.resolve({ data: [], error: null })
  ])

  if (productsRes.error) throw productsRes.error
  if (attachmentsRes.error) throw attachmentsRes.error

  const productMap: Record<string, CardProduct> = (productsRes.data || []).reduce(
    (acc: Record<string, CardProduct>, p: any) => ({ ...acc, [p.id]: p }), {}
  )

  const attachmentsByBill: Record<string, { id: string; file_name: string; public_url?: string }[]> = (attachmentsRes.data || []).reduce((acc: any, attachment: any) => {
    const recordId = String(attachment.record_id)
    if (!acc[recordId]) acc[recordId] = []
    acc[recordId].push({ id: attachment.id, file_name: attachment.file_name, public_url: attachment.public_url })
    return acc
  }, {})

  const bills = rawBills.map(b => ({
    ...b,
    card: {
      ...b.card,
      card_product: productMap[b.card?.card_product_id] || {
        id: b.card?.card_product_id,
        bank_name: '银行卡',
        card_name: '标准信用卡',
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        is_active: true,
        created_at: new Date().toISOString()
      }
    }
  }))

  return bills.map((bill) => {
    const payments = bill.payments || []
    const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    const isPaid = bill.status === 'paid' || (Number(bill.bill_amount || 0) > 0 && paidAmount >= Number(bill.bill_amount || 0))
    const remainingAmount = isPaid ? 0 : Math.max(0, Number(bill.bill_amount || 0) - paidAmount)
    const dueDays = daysUntil(bill.due_date)
    const computedStatus = isPaid ? 'paid' : computeStatus(bill, paidAmount)

    return {
      ...bill,
      payments,
      attachments: attachmentsByBill[bill.id] || [],
      paid_amount: isPaid && paidAmount === 0 ? Number(bill.bill_amount || 0) : paidAmount,
      remaining_amount: remainingAmount,
      days_until_due: dueDays,
      interest_free_days_left: dueDays,
      computed_status: computedStatus,
      status: computedStatus,
    }
  }).sort((a, b) => {
    if (a.computed_status === 'paid' && b.computed_status !== 'paid') return 1
    if (a.computed_status !== 'paid' && b.computed_status === 'paid') return -1
    return a.interest_free_days_left - b.interest_free_days_left
  })
}

/**
 * 精确计算信用卡当前周期的刷卡免息期与账单日/还款日
 */
export function calculateCardGracePeriod(card: CreditCard & { card_product: CardProduct }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const billingDay = Number(card.override_billing_day ?? card.billing_day ?? 10)

  if (card.card_type === 'loan' && card.loan_due_day) {
    const nextDueDate = getLoanNextDueDate(card.loan_due_day, today)
    const diffMs = nextDueDate.getTime() - today.getTime()
    return {
      billingDay,
      nextBillingDate: nextDueDate,
      nextDueDate,
      graceDays: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))),
    }
  }

  let purchaseMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const effectiveBillingDay = Math.min(billingDay, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate())
  if (today.getDate() > effectiveBillingDay) {
    purchaseMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  }

  const nextBillingDate = new Date(purchaseMonth.getFullYear(), purchaseMonth.getMonth(), effectiveBillingDay)
  const nextDueDate = getDueDate(card, card.card_product, purchaseMonth)
  const diffMs = nextDueDate.getTime() - today.getTime()

  return {
    billingDay,
    nextBillingDate,
    nextDueDate,
    graceDays: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))),
  }
}

export interface CardWithBillsSummary {
  card: CreditCard & { card_product: CardProduct }
  holder_id: string
  // 卡片当前主状态：'overdue' (逾期) | 'unpaid' (待还款) | 'partial' (部分还款) | 'unissued' (未出账单/已结清)
  status: 'overdue' | 'unpaid' | 'partial' | 'unissued'
  // 当前最新未结清账单（若已全结清则为最新一笔已结账单或 null）
  activeBill: BillDashboardItem | null
  // 待还总金额
  unpaidAmount: number
  // 今日刷卡免息天数 (正数)
  graceDays: number
  billingDay: number
  nextDueDate: Date
  // 名下所有历史账单
  historyBills: BillDashboardItem[]
}

/**
 * 以信用卡为核心实体聚合账单：
 * 1. 一张卡只对应一个卡片视图，多个账单归并在卡片下
 * 2. 旧账单还款后，卡片展示「未出账单/已结清」状态，并准确计算当前刷卡免息期
 */
export async function getCardsWithBillsSummary(userId?: string): Promise<CardWithBillsSummary[]> {
  // 1. 获取用户所有的信用卡
  const cardQuery = userId
    ? insforge.database
        .from('credit_cards')
        .select('*, card_holders!inner(created_by)')
        .eq('card_holders.created_by', userId)
    : insforge.database.from('credit_cards').select('*')

  const { data: rawCards, error: cardError } = await cardQuery.order('created_at', { ascending: false })
  if (cardError) throw cardError

  const cards = (rawCards || []) as CreditCard[]
  if (cards.length === 0) return []

  // 2. 获取所有的卡产品
  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  let productMap: Record<string, CardProduct> = {}
  if (productIds.length > 0) {
    const { data: products } = await insforge.database
      .from('card_products')
      .select('*')
      .in('id', productIds)
    if (products) {
      productMap = products.reduce((acc, p) => ({ ...acc, [p.id]: p }), {})
    }
  }

  // 3. 获取所有账单明细
  const allBills = await getBillDashboardItems(500, userId)
  const billsByCardId = new Map<string, BillDashboardItem[]>()
  for (const b of allBills) {
    const cid = b.card_id
    if (!billsByCardId.has(cid)) billsByCardId.set(cid, [])
    billsByCardId.get(cid)!.push(b)
  }

  // 4. 聚合每张卡的状态与免息期
  return cards.map(card => {
    const product = productMap[card.card_product_id] || {
      id: card.card_product_id,
      bank_name: (card as any).bank_name || '银行卡',
      card_name: (card as any).card_name || '标准信用卡',
      country: 'CN',
      currency: 'CNY',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      is_active: true,
      created_at: new Date().toISOString()
    }

    const cardWithProduct = {
      ...card,
      card_product: product
    }

    const graceInfo = calculateCardGracePeriod(cardWithProduct)
    const cardBills = billsByCardId.get(card.id) || []

    // 排序历史账单：按月份或到期日降序
    const historyBills = [...cardBills].sort((a, b) => {
      const timeA = new Date(a.due_date || a.statement_end || '2000-01-01').getTime()
      const timeB = new Date(b.due_date || b.statement_end || '2000-01-01').getTime()
      return timeB - timeA
    })

    // 寻找当前未结清账单（逾期或待还）
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
    } else {
      status = 'unissued'
    }

    return {
      card: cardWithProduct,
      holder_id: card.holder_id,
      status,
      activeBill,
      unpaidAmount,
      graceDays: graceInfo.graceDays,
      billingDay: graceInfo.billingDay,
      nextDueDate: graceInfo.nextDueDate,
      historyBills
    }
  })
}

/**
 * 创建账单
 */
/** 账单明细输入（智能导入解析结果；明细暂存于 bill_import_drafts.parsed_payload，bills 表无明细列） */
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
  // items 不入 bills 表（无此列），仅供调用方在确认草稿时透传
  const { items: _items, ...billRow } = bill
  const { data, error } = await insforge.database
    .from('bills')
    .insert([billRow])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 更新账单（金额、到期日等字段）
 */
export async function updateBill(
  id: string,
  data: Partial<Omit<Bill, 'id' | 'created_at'>>
): Promise<Bill> {
  const { data: updated, error } = await insforge.database
    .from('bills')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
}

/**
 * 更新账单状态
 */
export async function updateBillStatus(id: string, status: Bill['status']): Promise<Bill> {
  const { data, error } = await insforge.database
    .from('bills')
    .update({ status })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * 获取账单相关的还款记录
 */

export async function getBillsByHolder(holderId: string): Promise<BillWithCard[]> {
  const { data, error } = await insforge.database
    .from('bills')
    .select('*, credit_cards!inner(*, card_product:card_products(*))')
    .eq('credit_cards.holder_id', holderId)
    .order('bill_month', { ascending: false })

  if (error) throw error
  return ((data || []) as BillWithCard[]).map(withCreditCardProductFields)
}

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await insforge.database
    .from('payments')
    .select('*')
    .eq('bill_id', billId)
    .order('paid_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * 登记还款
 */
export async function createPayment(
  payment: Omit<Payment, 'id' | 'created_at' | 'idempotency_key'>
): Promise<Payment> {
  const { data, error } = await insforge.database
    .from('payments')
    .insert([{
      ...payment,
      idempotency_key: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`
    }])
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * 将指定账单快速结清
 */
export async function markBillAsPaid(billId: string, amount: number, note = '一键结清'): Promise<void> {
  // 1. 登记全额还款
  await createPayment({
    bill_id: billId,
    amount: amount,
    paid_at: new Date().toISOString().split('T')[0],
    channel: '快捷全额结清',
    note
  })

  // 2. 更新状态为 paid
  await updateBillStatus(billId, 'paid')
}

/**
 * 一键将所有逾期未还账单全部标记为已还清（极速批量写入，避免卡顿）
 */
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
  const today = new Date().toISOString().split('T')[0]
  let totalAmount = 0

  overdueBills.forEach(bill => {
    const remaining = (bill.remaining_amount !== undefined && bill.remaining_amount > 0)
      ? bill.remaining_amount
      : Number(bill.bill_amount || 0)
    totalAmount += remaining
  })

  const { data: rpcResult, error: rpcErr } = await insforge.database.rpc('mark_bills_paid_atomic', {
    p_user_id: userId,
    p_bill_ids: billIds,
    p_paid_at: today,
    p_channel: '快捷全额结清',
    p_note: '一键全部还款结清',
  })

  if (rpcErr) {
    const msg = String(rpcErr.message || rpcErr)
    if (msg.includes('mark_bills_paid_atomic')) {
      throw new Error('缺少数据库函数 mark_bills_paid_atomic，请先执行 migrations/20260901000001_add_atomic_bill_payment.sql')
    }
    throw rpcErr
  }

  const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  return {
    count: Number(result?.paid_count ?? result?.count ?? overdueBills.length),
    totalAmount: Number(result?.total_amount ?? totalAmount),
  }
}

