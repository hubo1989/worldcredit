// lib/api/bills.ts
import { db } from '../insforge'
import type { Bill, BillItem, CreditCard } from '../types'

export type BillItemInput = Omit<BillItem, 'id' | 'bill_id' | 'created_at' | 'metadata' | 'item_type' | 'source'> & {
  item_type?: BillItem['item_type']
  source?: BillItem['source']
  metadata?: Record<string, unknown>
}

export type CreateBillInput = Omit<Bill, 'id' | 'created_at'> & {
  items?: BillItemInput[]
}

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

function normalizeBillItems(billId: string, items: BillItemInput[]) {
  return items
    .filter(item => item.description.trim() && Number.isFinite(Number(item.amount)))
    .map(item => ({
      bill_id: billId,
      transaction_date: item.transaction_date || null,
      post_date: item.post_date || null,
      description: item.description.trim(),
      merchant_name: item.merchant_name?.trim() || null,
      category: item.category?.trim() || null,
      amount: Number(item.amount),
      currency: item.currency?.trim() || null,
      item_type: item.item_type ?? 'purchase',
      source: item.source ?? 'manual',
      confidence: item.confidence ?? null,
      raw_text: item.raw_text?.trim() || null,
      metadata: item.metadata ?? {},
    }))
}

export async function getBillItems(billId: string): Promise<BillItem[]> {
  const { data, error } = await db
    .from('bill_items')
    .select('*')
    .eq('bill_id', billId)
    .order('transaction_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createBill(bill: CreateBillInput): Promise<Bill> {
  const { items = [], ...billData } = bill
  const { data, error } = await db
    .from('bills')
    .insert(billData)
    .select()
    .single()
  if (error) throw error

  const itemRows = normalizeBillItems(data.id, items)
  if (itemRows.length > 0) {
    const { error: itemError } = await db
      .from('bill_items')
      .insert(itemRows)

    if (itemError) {
      await db.from('bills').delete().eq('id', data.id)
      throw itemError
    }
  }

  return data
}

export async function updateBillStatus(billId: string, status: Bill['status']): Promise<void> {
  const { error } = await db
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}

export interface BillWithCard extends Bill {
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'>
}

export async function getBillsByHolder(holderId: string): Promise<BillWithCard[]> {
  // Get all card IDs for this holder first
  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('id')
    .eq('holder_id', holderId)
  if (cardError) throw cardError
  if (!cards || cards.length === 0) return []

  const cardIds = cards.map(c => c.id)
  const { data, error } = await db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, card_number_last4, currency, holder_id)')
    .in('card_id', cardIds)
    .order('bill_month', { ascending: false })
  if (error) throw error
  return data || []
}
