// lib/api/billItems.ts
import { db } from '../insforge'
import type { Bill, BillItem, CreditCard } from '../types'

export interface BillItemWithBill extends BillItem {
  bill: Bill & {
    credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'>
  }
}

export async function getBillItemsByHolder(holderId: string): Promise<BillItemWithBill[]> {
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

  // Get all bill items for these bills
  const { data, error } = await db
    .from('bill_items')
    .select('*, bill:bills(*, credit_cards(bank_name, card_name, card_number_last4, currency))')
    .in('bill_id', billIds)
    .order('transaction_date', { ascending: false })

  if (error) throw error
  return data || []
}
