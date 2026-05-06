// lib/api/holders.ts
import { insforge } from '../insforge'
import type { CardHolder } from '../types'

export async function getHolders(): Promise<CardHolder[]> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as CardHolder[]
}

export async function getHolder(id: string): Promise<CardHolder> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as CardHolder
}

export async function createHolder(holder: Omit<CardHolder, 'id' | 'created_at'>): Promise<CardHolder> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .insert(holder)
    .select()
    .single()
  if (error) throw error
  return data as CardHolder
}

export async function updateHolder(id: string, updates: Partial<CardHolder>): Promise<CardHolder> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as CardHolder
}

export async function deleteHolder(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('card_holders')
    .delete()
    .eq('id', id)
  if (error) throw error
}
