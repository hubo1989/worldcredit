// lib/api/cards.ts
import { insforge } from '../insforge'
import type { CreditCard } from '../types'

export async function getCardsByHolder(holderId: string): Promise<CreditCard[]> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .select('*')
    .eq('holder_id', holderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as CreditCard[]
}

export async function getCard(id: string): Promise<CreditCard> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as CreditCard
}

export async function getAllCards(): Promise<CreditCard[]> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as CreditCard[]
}

export async function createCard(card: Omit<CreditCard, 'id' | 'created_at'>): Promise<CreditCard> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .insert(card)
    .select()
    .single()
  if (error) throw error
  return data as CreditCard
}

export async function updateCard(id: string, updates: Partial<CreditCard>): Promise<CreditCard> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as CreditCard
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('credit_cards')
    .delete()
    .eq('id', id)
  if (error) throw error
}
