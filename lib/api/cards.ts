import { insforge } from '../insforge'
import type { CreditCard, CardProduct } from '../types'

/**
 * 获取所有卡产品目录
 */
export async function getCardProducts(): Promise<CardProduct[]> {
  const { data, error } = await insforge.database
    .from('card_products')
    .select('*')
    .order('bank_name', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * 获取特定持卡人的所有信用卡
 */
export async function getCardsByHolder(holderId: string): Promise<(CreditCard & { card_product: CardProduct })[]> {
  const { data: cards, error } = await insforge.database
    .from('credit_cards')
    .select('*')
    .eq('holder_id', holderId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  if (!cards || cards.length === 0) return []

  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  let productMap: Record<string, CardProduct> = {}

  if (productIds.length > 0) {
    const { data: products } = await insforge.database
      .from('card_products')
      .select('*')
      .in('id', productIds)

    if (products) {
      productMap = products.reduce((acc, p) => {
        acc[p.id] = p
        return acc
      }, {} as Record<string, CardProduct>)
    }
  }

  return cards.map(card => ({
    ...card,
    card_product: productMap[card.card_product_id] || {
      id: card.card_product_id,
      bank_name: '银行卡',
      card_name: '标准信用卡',
      country: 'CN',
      currency: 'CNY',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      is_active: true,
      created_at: new Date().toISOString()
    }
  }))
}

/**
 * 获取单张信用卡详情
 */
export async function getCard(id: string): Promise<CreditCard & { card_product: CardProduct }> {
  const { data: card, error } = await insforge.database
    .from('credit_cards')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) throw error

  let cardProduct: CardProduct = {
    id: card.card_product_id,
    bank_name: '银行卡',
    card_name: '标准信用卡',
    country: 'CN',
    currency: 'CNY',
    payment_due_type: 'after_billing',
    payment_due_value: 20,
    is_active: true,
    created_at: new Date().toISOString()
  }

  if (card.card_product_id) {
    const { data: product } = await insforge.database
      .from('card_products')
      .select('*')
      .eq('id', card.card_product_id)
      .maybeSingle()

    if (product) {
      cardProduct = product
    }
  }

  return {
    ...card,
    card_product: cardProduct
  }
}

function cleanCardPayload(payload: Record<string, any>) {
  const clean: Record<string, any> = {}
  
  // 严格白名单：只提交远端数据库实例确切存在的标准列，绝对避免任何 PGRST204 报错
  if (payload.holder_id !== undefined) clean.holder_id = payload.holder_id
  if (payload.card_product_id !== undefined) clean.card_product_id = payload.card_product_id
  if (payload.card_number_last4 !== undefined) clean.card_number_last4 = payload.card_number_last4 || null
  if (payload.credit_limit !== undefined) clean.credit_limit = Number(payload.credit_limit) || 0
  if (payload.billing_day !== undefined) clean.billing_day = Number(payload.billing_day) || 1
  if (payload.status !== undefined) clean.status = payload.status

  return clean
}

/**
 * 添加信用卡
 */
export async function createCard(card: Omit<CreditCard, 'id' | 'created_at'>): Promise<CreditCard> {
  const cleanData = cleanCardPayload(card)
  const { data, error } = await insforge.database
    .from('credit_cards')
    .insert([cleanData])
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * 更新信用卡信息
 */
export async function updateCard(id: string, updates: Partial<CreditCard>): Promise<CreditCard> {
  const cleanData = cleanCardPayload(updates)
  const { data, error } = await insforge.database
    .from('credit_cards')
    .update(cleanData)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * 删除信用卡
 */
export async function deleteCard(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('credit_cards')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}
