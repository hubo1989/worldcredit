// lib/api/payments.ts
import { insforge } from '../insforge'
import type { Payment } from '../types'
import { generateIdempotencyKey } from '../utils'

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await insforge.database
    .from('payments')
    .select('*')
    .eq('bill_id', billId)
    .order('paid_at', { ascending: false })
  if (error) throw error
  return (data || []) as Payment[]
}

export async function createPayment(
  payment: Omit<Payment, 'id' | 'created_at' | 'idempotency_key'>
): Promise<Payment> {
  const { data, error } = await insforge.database
    .from('payments')
    .insert({ ...payment, idempotency_key: generateIdempotencyKey() })
    .select()
    .single()
  if (error) throw error
  return data as Payment
}

/**
 * 根据还款记录计算账单已还金额，并更新账单状态
 */
export async function recalcBillStatus(billId: string, billAmount: number): Promise<void> {
  const payments = await getPaymentsByBill(billId)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)

  let status: 'unpaid' | 'partial' | 'paid'
  if (totalPaid >= billAmount) status = 'paid'
  else if (totalPaid > 0) status = 'partial'
  else status = 'unpaid'

  const { error } = await insforge.database
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}
