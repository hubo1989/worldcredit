// lib/api/promoUsages.ts
import { db } from '../insforge'
import type { Promo, PromoUsage } from '../types'

export interface PromoUsageWithPromo extends PromoUsage {
  promo: Promo
}

export async function getPromoUsagesByHolder(holderId: string): Promise<PromoUsageWithPromo[]> {
  // Get all card IDs for this holder
  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('id')
    .eq('holder_id', holderId)
  if (cardError) throw cardError
  if (!cards || cards.length === 0) return []

  const cardIds = cards.map(c => c.id)

  // Get all promo usages for these cards
  const { data, error } = await db
    .from('promo_usages')
    .select('*, promo:promos(*)')
    .in('card_id', cardIds)
    .order('used_at', { ascending: false })

  if (error) throw error
  return data || []
}
