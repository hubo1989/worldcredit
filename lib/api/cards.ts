import { insforge } from '@/lib/insforge'
import type { CardProduct, CreditCard, CardHolder } from '@/lib/types'

export type CreditCardWithProduct = CreditCard & {
  card_product?: CardProduct
  bank_name?: string
  card_name?: string
}

function withFlatProductFields(card: CreditCardWithProduct): CreditCardWithProduct {
  return {
    ...card,
    bank_name: card.bank_name ?? card.card_product?.bank_name,
    card_name: card.card_name ?? card.card_product?.card_name,
  }
}

export async function getCardProducts(): Promise<CardProduct[]> {
  const { data, error } = await insforge.database
    .from('card_products')
    .select('*')
    .eq('is_active', true)
    .order('bank_name', { ascending: true })

  if (error) throw error
  return (data || []) as CardProduct[]
}

export async function getCardHolders(): Promise<CardHolder[]> {
  const { data, error } = await insforge.database
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getCardsByHolder(holderId: string): Promise<CreditCardWithProduct[]> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .select('*, card_product:card_products(*)')
    .eq('holder_id', holderId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data || []) as CreditCardWithProduct[]).map(withFlatProductFields)
}

export async function createCard(card: Omit<CreditCard, 'id' | 'created_at'>): Promise<CreditCardWithProduct> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .insert([card])
    .select('*, card_product:card_products(*)')
    .single()

  if (error) throw error
  return withFlatProductFields(data as CreditCardWithProduct)
}

export async function updateCard(
  id: string,
  patch: Partial<Omit<CreditCard, 'id' | 'created_at'>>
): Promise<CreditCardWithProduct> {
  const { data, error } = await insforge.database
    .from('credit_cards')
    .update(patch)
    .eq('id', id)
    .select('*, card_product:card_products(*)')
    .single()

  if (error) throw error
  return withFlatProductFields(data as CreditCardWithProduct)
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('credit_cards')
    .delete()
    .eq('id', id)

  if (error) throw error
}
