import { insforge } from '@/lib/insforge'
import type { CardProduct, CreditCard, CardHolder } from '@/lib/types'

export async function getCardProducts(): Promise<CardProduct[]> {
  const { data, error } = await insforge.database
    .from('card_products')
    .select('*')
    .eq('is_active', true)
    .order('bank_name', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getCardHolders(): Promise<CardHolder[]> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getCardsByHolder(holderId: string): Promise<CreditCard[]> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .select('*, card_product:card_products(*)')
    .eq('holder_id', holderId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}
