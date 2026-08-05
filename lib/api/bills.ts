import { insforge } from '../insforge'
import type { Bill, Payment, CreditCard, CardProduct } from '../types'

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
  const { data, error } = await insforge.database
    .from('bills')
    .select('*, card:credit_cards(*, card_product:card_products(*))')
    .order('due_date', { ascending: true })
    .limit(limit)
  
  if (error) throw error
  return data || []
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
    .order('payment_date', { ascending: false })
  
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
