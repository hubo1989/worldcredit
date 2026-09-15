import { query, queryOne, execute, uuid, now } from '../db'
import { CardProduct, Promo, Benefit, Bank } from '../types'

/**
 * 管理后台通用 API 封装
 */

// --- 银行管理 ---

export async function getAdminBanks() {
  const { data, error } = await query<Bank>('SELECT * FROM banks ORDER BY created_at DESC')
  if (error) throw new Error(error.message)
  return data as Bank[]
}

export async function createBank(payload: Partial<Bank>) {
  const id = uuid()
  const { error } = await execute(
    'INSERT INTO banks (id, name, full_name, logo_url, country, customer_service_phone, website_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, payload.name!, payload.full_name || null, payload.logo_url || null, payload.country || 'CN',
     payload.customer_service_phone || null, payload.website_url || null, payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Bank>('SELECT * FROM banks WHERE id = ?', [id])
  return row.data as Bank
}

export async function updateBank(id: string, payload: Partial<Bank>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['name', 'full_name', 'logo_url', 'country', 'customer_service_phone', 'website_url']) {
    if (payload[key as keyof Bank] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Bank])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE banks SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Bank>('SELECT * FROM banks WHERE id = ?', [id])
  return row.data as Bank
}

export async function deleteBank(id: string) {
  const { error } = await execute('DELETE FROM banks WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 卡产品管理 ---

export async function getAdminCardProducts() {
  const { data, error } = await query<Record<string, unknown>>(
    'SELECT * FROM card_products ORDER BY created_at DESC'
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as CardProduct), is_active: p.is_active === 1 }))
}

export async function createCardProduct(payload: Partial<CardProduct & { is_active: boolean }>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO card_products (id, country, bank_id, bank_name, card_name, card_image_id, description_md, apply_url, rewards_summary, currency, payment_due_type, payment_due_value, annual_fee, annual_fee_waiver, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.country || 'CN', payload.bank_id || null, payload.bank_name!, payload.card_name!,
     payload.card_image_id || null, payload.description_md || null, payload.apply_url || null,
     payload.rewards_summary || null, payload.currency || 'CNY', payload.payment_due_type || 'after_billing',
     payload.payment_due_value || 20, payload.annual_fee || 0, payload.annual_fee_waiver || null,
     payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM card_products WHERE id = ?', [id])
  return row.data
}

export async function updateCardProduct(id: string, payload: Partial<CardProduct & { is_active: boolean }>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['country', 'bank_id', 'bank_name', 'card_name', 'card_image_id', 'description_md', 'apply_url', 'rewards_summary', 'currency', 'payment_due_type', 'payment_due_value', 'annual_fee', 'annual_fee_waiver']) {
    if (payload[key as keyof CardProduct] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof CardProduct])
    }
  }
  if (payload.is_active !== undefined) {
    fields.push('is_active = ?')
    params.push(payload.is_active ? 1 : 0)
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE card_products SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM card_products WHERE id = ?', [id])
  return row.data
}

export async function deleteCardProduct(id: string) {
  const { error } = await execute('DELETE FROM card_products WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 优惠活动管理 ---

interface PromoWithProduct extends Promo {
  product_bank_name?: string
  product_card_name?: string
}

export async function getAdminPromos() {
  const { data, error } = await query<Record<string, unknown>>(
    `SELECT pr.*, cp.bank_name AS product_bank_name, cp.card_name AS product_card_name
     FROM promos pr LEFT JOIN card_products cp ON pr.card_product_id = cp.id
     ORDER BY pr.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as PromoWithProduct), is_active: p.is_active === 1 }))
}

export async function createPromo(payload: Partial<Promo & { is_active: boolean }>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO promos (id, card_product_id, bank_name, title, description, discount_type, start_date, end_date, conditions, max_uses, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.card_product_id || null, payload.bank_name!, payload.title!,
     payload.description || null, payload.discount_type || null, payload.start_date || null,
     payload.end_date || null, payload.conditions || null, payload.max_uses || null,
     payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM promos WHERE id = ?', [id])
  return row.data
}

export async function updatePromo(id: string, payload: Partial<Promo & { is_active: boolean }>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'bank_id', 'bank_name', 'title', 'description', 'discount_type', 'start_date', 'end_date', 'conditions', 'max_uses']) {
    if (payload[key as keyof Promo] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Promo])
    }
  }
  if (payload.is_active !== undefined) {
    fields.push('is_active = ?')
    params.push(payload.is_active ? 1 : 0)
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE promos SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM promos WHERE id = ?', [id])
  return row.data
}

export async function deletePromo(id: string) {
  const { error } = await execute('DELETE FROM promos WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 权益管理 ---

export async function getAdminBenefits() {
  const { data, error } = await query<Record<string, unknown>>(
    `SELECT b.*, cp.bank_name AS product_bank_name, cp.card_name AS product_card_name
     FROM benefits b LEFT JOIN card_products cp ON b.card_product_id = cp.id
     ORDER BY b.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function createBenefit(payload: Partial<Benefit>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO benefits (id, card_product_id, name, description, quota, period, reset_month, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.card_product_id!, payload.name!, payload.description || null, payload.quota || 1,
     payload.period || 'yearly', payload.reset_month || null, payload.expiry_date || null]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM benefits WHERE id = ?', [id])
  return row.data
}

export async function updateBenefit(id: string, payload: Partial<Benefit>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'name', 'description', 'quota', 'period', 'reset_month', 'expiry_date']) {
    if (payload[key as keyof Benefit] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Benefit])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE benefits SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM benefits WHERE id = ?', [id])
  return row.data
}

export async function deleteBenefit(id: string) {
  const { error } = await execute('DELETE FROM benefits WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 系统设置 ---

/**
 * 敏感设置键：任何角色（含 admin）都不得经由 RPC 拿到明文。
 *
 * getSystemSettings() 在服务端边界剥掉这些键，只留下 `<key>_set` 布尔标志，
 * 让管理端能区分「从未配置」与「已配置但不回显」。需要真值的服务端内部代码
 * 必须显式调用 getSystemSettingsWithSecrets()。
 */
const SECRET_SETTING_KEYS = ['ai_api_key'] as const

function isSecretSettingKey(key: string): boolean {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key)
}

/**
 * 服务端内部使用：返回**包含密钥**的原始设置。
 *
 * 绝对不要注册进 lib/api/registry.ts——一旦注册，密钥就会随 RPC 响应体
 * 回到浏览器（devtools / 内存 / 网络面板）。AI 调用只在服务端进行。
 */
export async function getSystemSettingsWithSecrets() {
  const { data, error } = await query<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings'
  )
  if (error) throw new Error(error.message)
  const settings: Record<string, unknown> = {}
  for (const item of data || []) {
    try {
      settings[item.key] = JSON.parse(item.value!)
    } catch {
      settings[item.key] = item.value
    }
  }
  return settings
}

/**
 * RPC / 客户端可见的设置：密钥已在服务端剥离。
 *
 * 密钥不在响应里，也不出现在任何字符串字段中；只暴露 `ai_api_key_set`。
 */
export async function getSystemSettings() {
  const settings = await getSystemSettingsWithSecrets()
  for (const key of SECRET_SETTING_KEYS) {
    const value = settings[key]
    delete settings[key]
    settings[`${key}_set`] = typeof value === 'string' && value.length > 0
  }
  return settings
}

export async function updateSystemSettings(key: string, value: unknown) {
  const json = JSON.stringify(value)
  const { error } = await execute(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, json, now()]
  )
  if (error) throw new Error(error.message)
  // 写路径同样不得回显：管理员提交密钥后，响应里只回「是否已配置」，不回明文。
  if (isSecretSettingKey(key)) {
    return { key, value: null, [`${key}_set`]: typeof value === 'string' && value.length > 0 }
  }
  return { key, value }
}
