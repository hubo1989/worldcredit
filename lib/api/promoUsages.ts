import { query } from '../db'
import type { Promo, PromoUsage } from '../types'

export interface PromoUsageWithPromo extends PromoUsage {
  promo: Promo
}

export async function getPromoUsagesByHolder(holderId: string): Promise<PromoUsageWithPromo[]> {
  const { data, error } = await query<PromoUsageWithPromo>(
    `SELECT pu.*, p.*
     FROM promo_usages pu
     JOIN promos p ON pu.promo_id = p.id
     JOIN credit_cards cc ON pu.card_id = cc.id
     WHERE cc.holder_id = ?
     ORDER BY pu.used_at DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return data || []
}
