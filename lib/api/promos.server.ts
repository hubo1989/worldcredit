// lib/api/promos.server.ts — server implementation of the mobile promos API.

import { query, execute, uuid, now } from '../db'
import type { Promo } from '../types'

export interface PromosWithBanks {
  promos: Promo[]
  userBanks: string[]
}

/**
 * 当前进行中的活动 + 用户本人持有的银行。
 *
 * P0 修正（WC-BEN-12 spec）：活动先按启停与日期初筛，不再把已过期／未开始／
 * 已下线的活动当有效内容返回；userBanks 从该用户可访问 holder 名下 active
 * 信用卡的所属银行计算，不再使用全站目录银行。
 *
 * 返回形状保持 { promos, userBanks }，字段不变；统一 DTO 在 Task 11 处理。
 * nowOn 供测试注入固定日期，生产调用不传，使用服务器当日。
 */
export async function getPromosWithBanks(userId?: string, nowOn?: string): Promise<PromosWithBanks> {
  const today = nowOn ?? new Date().toISOString().slice(0, 10)
  const { data: promos, error } = await query<Promo>(
    `SELECT * FROM promos
     WHERE is_active = 1
       AND (start_date IS NULL OR start_date <= ?)
       AND (end_date IS NULL OR end_date >= ?)
     ORDER BY end_date ASC`,
    [today, today]
  )
  if (error) throw new Error(error.message)

  let userBanks: string[] = []
  if (userId) {
    const { data: bankRows, error: banksError } = await query<{ bank_name: string }>(
      `SELECT DISTINCT cp.bank_name AS bank_name
       FROM card_holders ch
       JOIN credit_cards cc ON cc.holder_id = ch.id
       JOIN card_products cp ON cp.id = cc.card_product_id
       WHERE (ch.created_by = ? OR ch.auth_user_id = ?)
         AND cc.status = 'active'
         AND cc.card_type = 'credit'
         AND cp.bank_name IS NOT NULL AND cp.bank_name != ''
       ORDER BY cp.bank_name`,
      [userId, userId]
    )
    if (banksError) throw new Error(banksError.message)
    userBanks = Array.from(new Set((bankRows || []).map((r) => r.bank_name.trim()).filter(Boolean)))
  }

  return { promos: promos || [], userBanks }
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
