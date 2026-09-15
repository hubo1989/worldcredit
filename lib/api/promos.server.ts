// lib/api/promos.server.ts — server implementation of the mobile promos API.

import { query, execute, uuid, now } from '../db'
import type { Promo } from '../types'

export interface PromosWithBanks {
  promos: Promo[]
  userBanks: string[]
}

export async function getPromosWithBanks(): Promise<PromosWithBanks> {
  const { data: promos, error } = await query<Promo>('SELECT * FROM promos ORDER BY end_date ASC')
  if (error) throw new Error(error.message)

  const { data: products, error: banksError } = await query<{ bank_name: string }>(
    'SELECT bank_name, card_name FROM card_products'
  )
  if (banksError) throw new Error(banksError.message)

  const banks = new Set<string>()
  for (const p of products || []) {
    if (p.bank_name) banks.add(p.bank_name.trim())
  }
  return { promos: promos || [], userBanks: Array.from(banks) }
}

export interface CreateUserPromoInput {
  bank_name: string
  title: string
  discount_type: string
  description: string
  start_date: string
  end_date: string
}

const ALLOWED_DISCOUNT_TYPES = ['满减', '折扣', '积分', '返现']

// The promos table has no "rules" JSON column; user-created promos store a
// plain description (the registration channel falls back to the bank app).
// discount_type has a CHECK constraint, so free-form labels are preserved in
// conditions instead.
export async function createUserPromo(input: CreateUserPromoInput): Promise<void> {
  const normalizedType = ALLOWED_DISCOUNT_TYPES.includes(input.discount_type) ? input.discount_type : '满减'
  const conditions = ALLOWED_DISCOUNT_TYPES.includes(input.discount_type)
    ? '用户自定义记录的银行优惠活动'
    : `用户自定义优惠标签：${input.discount_type}`
  const { error } = await execute(
    `INSERT INTO promos (id, bank_name, title, discount_type, description, start_date, end_date, conditions, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      uuid(),
      input.bank_name,
      input.title,
      normalizedType,
      input.description,
      input.start_date,
      input.end_date,
      conditions,
      now(),
    ]
  )
  if (error) throw new Error(error.message)
}
