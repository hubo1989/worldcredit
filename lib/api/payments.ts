// lib/api/payments.ts
import { db } from '../insforge'
import { generateIdempotencyKey } from '../utils'
import type { Payment, Bill, CreditCard } from '../types'

export interface PaymentWithBill extends Payment {
  bill: Bill & {
    credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'>
  }
}

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('bill_id', billId)
    .order('paid_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getPaymentsByHolder(holderId: string): Promise<PaymentWithBill[]> {
  // Get all card IDs for this holder
  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('id')
    .eq('holder_id', holderId)
  if (cardError) throw cardError
  if (!cards || cards.length === 0) return []

  const cardIds = cards.map(c => c.id)

  // Get all bills for these cards
  const { data: bills, error: billError } = await db
    .from('bills')
    .select('id')
    .in('card_id', cardIds)
  if (billError) throw billError
  if (!bills || bills.length === 0) return []

  const billIds = bills.map(b => b.id)

  // Get all payments for these bills
  const { data, error } = await db
    .from('payments')
    .select('*, bill:bills(*, credit_cards(bank_name, card_name, card_number_last4, currency))')
    .in('bill_id', billIds)
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
