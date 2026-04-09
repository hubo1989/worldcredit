// lib/api/promos.ts
import { db } from '../insforge'
import type { Promo, PromoUsage } from '../types'

export async function getPromos(cardId?: string): Promise<Promo[]> {
  let query = db
    .from('promos')
    .select('*')
    .order('end_date', { ascending: true, nullsFirst: false })

  if (cardId) query = query.eq('card_id', cardId)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getActivePromos(): Promise<Promo[]> {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await db
    .from('promos')
    .select('*')
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('start_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createPromo(promo: Omit<Promo, 'id' | 'created_at'>): Promise<Promo> {
  const { data, error } = await db
    .from('promos')
    .insert(promo)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePromo(id: string, updates: Partial<Promo>): Promise<Promo> {
  const { data, error } = await db
    .from('promos')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePromo(id: string): Promise<void> {
  const { error } = await db
    .from('promos')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function recordPromoUsage(promoId: string, cardId?: string, note?: string): Promise<PromoUsage> {
  const { data, error } = await db
    .from('promo_usages')
    .insert({
      promo_id: promoId,
      card_id: cardId ?? null,
      note: note ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getPromoUsages(promoId: string): Promise<PromoUsage[]> {
  const { data, error } = await db
    .from('promo_usages')
    .select('*')
    .eq('promo_id', promoId)
    .order('used_at', { ascending: false })
  if (error) throw error
  return data || []
}
