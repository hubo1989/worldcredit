import { insforge } from '../insforge'
import type { CardHolder } from '../types'

export async function getCardHolders(): Promise<CardHolder[]> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function createCardHolder(holder: Omit<CardHolder, 'id' | 'created_at'>): Promise<CardHolder> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .insert([holder])
    .select()
    .single()

  if (error) throw error
  return data
}
