import { insforge } from '../insforge'
import { CardProduct, Promo, Benefit, Bank } from '../types'

/**
 * 管理后台通用 API 封装
 */

// --- 银行管理 ---

export async function getAdminBanks() {
  const { data, error } = await insforge.database
    .from('banks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Bank[]
}

export async function createBank(payload: Partial<Bank>) {
  const { data, error } = await insforge.database
    .from('banks')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data as Bank
}

export async function updateBank(id: string, payload: Partial<Bank>) {
  const { data, error } = await insforge.database
    .from('banks')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Bank
}

export async function deleteBank(id: string) {
  const { error } = await insforge.database
    .from('banks')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- 卡产品管理 ---

export async function getAdminCardProducts() {
  const { data, error } = await insforge.database
    .from('card_products')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as (CardProduct & { is_active: boolean })[]
}

export async function createCardProduct(payload: Partial<CardProduct & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('card_products')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCardProduct(id: string, payload: Partial<CardProduct & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('card_products')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCardProduct(id: string) {
  const { error } = await insforge.database
    .from('card_products')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- 优惠活动管理 ---

export async function getAdminPromos() {
  const { data, error } = await insforge.database
    .from('promos')
    .select('*, card_products(bank_name, card_name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createPromo(payload: Partial<Promo & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('promos')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePromo(id: string, payload: Partial<Promo & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('promos')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePromo(id: string) {
  const { error } = await insforge.database
    .from('promos')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- 权益管理 ---

export async function getAdminBenefits() {
  const { data, error } = await insforge.database
    .from('benefits')
    .select('*, card_products(bank_name, card_name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createBenefit(payload: Partial<Benefit & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('benefits')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBenefit(id: string, payload: Partial<Benefit & { is_active: boolean }>) {
  const { data, error } = await insforge.database
    .from('benefits')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBenefit(id: string) {
  const { error } = await insforge.database
    .from('benefits')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- 系统设置 ---

export async function getSystemSettings() {
  const { data, error } = await insforge.database
    .from('system_settings')
    .select('*')
  if (error) throw error
  
  const settings: Record<string, any> = {}
  for (const item of data || []) {
    settings[item.key] = item.value
  }
  return settings
}

export async function updateSystemSettings(key: string, value: any) {
  const { data, error } = await insforge.database
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })
    .select()
    .single()
  if (error) throw error
  return data
}
