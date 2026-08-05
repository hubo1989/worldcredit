import { insforge } from '../insforge'
import type { Bill, Payment, CreditCard, CardProduct } from '../types'

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

function daysUntil(date: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function computeStatus(bill: Bill, paidAmount: number): Bill['status'] {
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
    const remainingAmount = Math.max(0, Number(bill.bill_amount || 0) - paidAmount)
    const dueDays = daysUntil(bill.due_date)
    const computedStatus = computeStatus(bill, paidAmount)

    return {
      ...bill,
      payments,
      attachments: attachmentsByBill[bill.id] || [],
      paid_amount: paidAmount,
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
 * 创建账单
 */
export async function createBill(bill: Omit<Bill, 'id' | 'created_at'>): Promise<Bill> {
  const { data, error } = await insforge.database
    .from('bills')
    .insert([bill])
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
