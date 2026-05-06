// lib/api/bills.ts
import { insforge } from '../insforge'
import type { Bill } from '../types'

export async function getBills(cardId?: string): Promise<Bill[]> {
  let query = insforge.database
    .from('bills')
    .select('*')
    .order('due_date', { ascending: true })

  if (cardId) query = query.eq('card_id', cardId)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as Bill[]
}

export async function getBillsByCard(cardId: string): Promise<Bill[]> {
  const { data, error } = await insforge.database
    .from('bills')
    .select('*')
    .eq('card_id', cardId)
    .order('due_date', { ascending: false })
  if (error) throw error
  return (data || []) as Bill[]
}

export async function getUnpaidBills(): Promise<Bill[]> {
  const { data, error } = await insforge.database
    .from('bills')
    .select('*')
    .in('status', ['unpaid', 'partial', 'overdue'])
    .order('due_date', { ascending: true })
  if (error) throw error
  return (data || []) as Bill[]
}

export async function createBill(bill: Omit<Bill, 'id' | 'created_at'>): Promise<Bill> {
  const { data, error } = await insforge.database
    .from('bills')
    .insert(bill)
    .select()
    .single()
  if (error) throw error
  return data as Bill
}

export async function updateBillStatus(billId: string, status: Bill['status']): Promise<void> {
  const { error } = await insforge.database
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}
