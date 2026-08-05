// lib/api/benefitUsages.ts
import { db } from '../insforge'
import type { Benefit, BenefitUsage, CreditCard } from '../types'

export interface BenefitUsageWithBenefit extends BenefitUsage {
  benefit: Benefit & {
    credit_cards: Pick<CreditCard, 'bank_name' | 'card_name'>
  }
}

export async function getBenefitUsagesByHolder(holderId: string): Promise<BenefitUsageWithBenefit[]> {
  // Get all card IDs for this holder
  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('id')
    .eq('holder_id', holderId)
  if (cardError) throw cardError
  if (!cards || cards.length === 0) return []

  const cardIds = cards.map(c => c.id)

  // Get all benefits for these cards
  const { data: benefits, error: benefitError } = await db
    .from('benefits')
    .select('id')
    .in('card_id', cardIds)
  if (benefitError) throw benefitError
  if (!benefits || benefits.length === 0) return []

  const benefitIds = benefits.map(b => b.id)

  // Get all benefit usages for these benefits
  const { data, error } = await db
    .from('benefit_usages')
    .select('*, benefit:benefits(*, credit_cards(bank_name, card_name))')
    .in('benefit_id', benefitIds)
    .order('used_at', { ascending: false })

  if (error) throw error
  return data || []
}
