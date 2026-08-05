// lib/api/promos.ts
import { db } from '../insforge'
import type { CreditCard, Promo, PromoUsage } from '../types'

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

export async function getPromosForCards(
  cards: Pick<CreditCard, 'id' | 'bank_name'>[],
  activeOnly = false
): Promise<Promo[]> {
  const promos = activeOnly ? await getActivePromos() : await getPromos()
  const cardIds = new Set(cards.map(card => card.id))
  const bankNames = new Set(cards.map(card => card.bank_name))

  return promos.filter(promo => {
    if (promo.card_id) return cardIds.has(promo.card_id)
    return bankNames.has(promo.bank_name)
  })
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

export async function recordPromoUsage(
  promoId: string,
  input: { card_id?: string; used_at?: string; note?: string }
): Promise<PromoUsage> {
  const { data, error } = await db
    .from('promo_usages')
    .insert({
      promo_id: promoId,
      card_id: input.card_id ?? null,
      used_at: input.used_at ?? new Date().toISOString().split('T')[0],
      note: input.note ?? null,
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

export interface PromoWithUsage extends Promo {
  used_count: number
}

export async function getPromosWithUsage(
  cards?: Pick<CreditCard, 'id' | 'bank_name'>[],
  activeOnly = false
): Promise<PromoWithUsage[]> {
  // 获取优惠数据
  const promos = activeOnly ? await getActivePromos() : await getPromos()

  // 获取所有 promo_ids
  const promoIds = promos.map(p => p.id)

  // 一次性获取所有使用统计
  const { data: usageCounts, error: countError } = await db
    .from('promo_usages')
    .select('promo_id, id')
    .in('promo_id', promoIds.length > 0 ? promoIds : ['00000000-0000-0000-0000-000000000000'])

  if (countError && countError.code !== 'PGRST116') throw countError // PGRST116 = empty result

  // 统计每个 promo 的使用次数
  const countMap = new Map<string, number>()
  usageCounts?.forEach(u => {
    countMap.set(u.promo_id, (countMap.get(u.promo_id) || 0) + 1)
  })

  // 组合数据
  const promosWithUsage: PromoWithUsage[] = promos.map(promo => ({
    ...promo,
    used_count: countMap.get(promo.id) || 0,
  }))

  // 如果提供了 cards，过滤匹配的优惠
  if (cards && cards.length > 0) {
    const cardIds = new Set(cards.map(card => card.id))
    const bankNames = new Set(cards.map(card => card.bank_name))

    return promosWithUsage.filter(promo => {
      if (promo.card_id) return cardIds.has(promo.card_id)
      return bankNames.has(promo.bank_name)
    })
  }

  return promosWithUsage
}
