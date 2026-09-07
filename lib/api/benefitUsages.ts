// lib/api/benefitUsages.ts
import { db } from '../insforge'
import type { Benefit, BenefitUsage, CardProduct } from '../types'

export interface BenefitUsageWithBenefit extends BenefitUsage {
  benefit: Benefit & {
    card_products: Pick<CardProduct, 'bank_name' | 'card_name'>
  }
}

export async function getBenefitUsagesByHolder(holderId: string): Promise<BenefitUsageWithBenefit[]> {
  // 持卡人名下所有卡片关联的卡产品 ID（benefits 挂在卡产品上）
  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('card_product_id')
    .eq('holder_id', holderId)
  if (cardError) throw cardError
  const productIds = Array.from(new Set((cards || []).map(c => c.card_product_id).filter(Boolean)))
  if (productIds.length === 0) return []

  // 这些卡产品名下的权益
  const { data: benefits, error: benefitError } = await db
    .from('benefits')
    .select('id')
    .in('card_product_id', productIds)
  if (benefitError) throw benefitError
  if (!benefits || benefits.length === 0) return []

  const benefitIds = benefits.map(b => b.id)

  // 权益使用记录（带卡产品的银行/卡名用于展示）
  const { data, error } = await db
    .from('benefit_usages')
    .select('*, benefit:benefits(*, card_products(bank_name, card_name))')
    .in('benefit_id', benefitIds)
    .order('used_at', { ascending: false })

  if (error) throw error
  return data || []
}
