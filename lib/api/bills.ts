// lib/api/bills.ts
import { db } from '../insforge'
import type { Bill } from '../types'

export async function getBill(id: string): Promise<Bill> {
  const { data, error } = await db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, card_number_last4, currency)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function getBills(cardId?: string): Promise<Bill[]> {
  let query = db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, card_number_last4, currency)')
    .order('due_date', { ascending: true })

  if (cardId) query = query.eq('card_id', cardId)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getUnpaidBills(): Promise<Bill[]> {
  const { data, error } = await db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, currency, holder_id)')
    .in('status', ['unpaid', 'partial', 'overdue'])
    .order('due_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createBill(bill: Omit<Bill, 'id' | 'created_at'>): Promise<Bill> {
  const { data, error } = await db
    .from('bills')
    .insert(bill)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBillStatus(billId: string, status: Bill['status']): Promise<void> {
  const { error } = await db
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}
