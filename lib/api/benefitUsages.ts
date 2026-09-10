import { query } from '../db'
import type { Benefit, BenefitUsage, CardProduct } from '../types'

export interface BenefitUsageWithBenefit extends BenefitUsage {
  benefit: Benefit & {
    card_products: Pick<CardProduct, 'bank_name' | 'card_name'>
  }
}

interface BenefitUsageJoinRow {
  id: string
  benefit_id: string
  used_at: string
  note: string | null
  created_at: string
  name: string
  description: string | null
  quota: number
  period: string
  reset_month: number | null
  expiry_date: string | null
  bank_name: string
  card_name: string
}

export async function getBenefitUsagesByHolder(holderId: string): Promise<BenefitUsageWithBenefit[]> {
  const { data, error } = await query<BenefitUsageJoinRow>(
    `SELECT bu.id, bu.benefit_id, bu.used_at, bu.note, bu.created_at,
            b.name, b.description, b.quota, b.period, b.reset_month, b.expiry_date,
            cp.bank_name, cp.card_name
     FROM benefit_usages bu
     JOIN benefits b ON bu.benefit_id = b.id
     JOIN card_products cp ON b.card_product_id = cp.id
     JOIN credit_cards cc ON cp.id = cc.card_product_id
     WHERE cc.holder_id = ?
     ORDER BY bu.used_at DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(row => ({
    id: row.id,
    benefit_id: row.benefit_id,
    used_at: row.used_at,
    note: row.note || undefined,
    created_at: row.created_at,
    benefit: {
      id: row.benefit_id,
      card_product_id: '',
      name: row.name,
      description: row.description || undefined,
      quota: row.quota,
      period: row.period as Benefit['period'],
      reset_month: row.reset_month || undefined,
      expiry_date: row.expiry_date || undefined,
      created_at: row.created_at,
      card_products: { bank_name: row.bank_name, card_name: row.card_name },
    },
  }))
}
