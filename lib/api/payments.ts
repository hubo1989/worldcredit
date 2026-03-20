// lib/api/payments.ts
import { db } from '../insforge'
import { generateIdempotencyKey } from '../utils'
import type { Payment } from '../types'

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('bill_id', billId)
    .order('paid_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createPayment(
  billId: string,
  amount: number,
  paid_at: string,
  note?: string,
  channel: string = '手动还款'
): Promise<string> {
  // 使用数据库函数原子完成：插入支付 + 更新账单状态
  const { data, error } = await db.rpc('record_payment', {
    p_bill_id: billId,
    p_amount: amount,
    p_paid_at: paid_at,
    p_note: note ?? null,
    p_idempotency_key: generateIdempotencyKey(),
    p_channel: channel,
  })
  if (error) throw error
  return data as string
}

