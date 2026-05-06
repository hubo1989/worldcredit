// lib/api/benefits.ts
import { db } from '../insforge'
import type { Benefit, BenefitUsage } from '../types'

export async function getBenefitsByCard(cardId: string): Promise<Benefit[]> {
  const { data, error } = await db
    .from('benefits')
    .select('*')
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createBenefit(benefit: Omit<Benefit, 'id' | 'created_at'>): Promise<Benefit> {
  const { data, error } = await db
    .from('benefits')
    .insert(benefit)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBenefit(id: string, updates: Partial<Benefit>): Promise<Benefit> {
  const { data, error } = await db
    .from('benefits')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBenefit(id: string): Promise<void> {
  const { error } = await db
    .from('benefits')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function recordBenefitUsage(
  benefitId: string,
  input?: { used_at?: string; note?: string }
): Promise<BenefitUsage> {
  const { data, error } = await db
    .from('benefit_usages')
    .insert({
      benefit_id: benefitId,
      used_at: input?.used_at || new Date().toISOString(),
      note: input?.note ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getBenefitUsages(benefitId: string): Promise<BenefitUsage[]> {
  const { data, error } = await db
    .from('benefit_usages')
    .select('*')
    .eq('benefit_id', benefitId)
    .order('used_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * 获取权益及其使用次数（用于卡片详情页展示）
 */
export async function getBenefitsWithUsage(cardId: string): Promise<(Benefit & { used_count: number })[]> {
  const benefits = await getBenefitsByCard(cardId)
  const result = await Promise.all(
    benefits.map(async (b) => {
      const usages = await getBenefitUsages(b.id)
      return { ...b, used_count: usages.length }
    })
  )
  return result
}
