import { query, queryOne, execute, uuid, now } from '../db'
import { startOfMonth, format } from 'date-fns'
import type { Benefit, BenefitUsage, CardProduct } from '../types'

/**
 * 根据权益的周期类型计算当前周期的起始日期
 */
function getPeriodStart(benefit: Benefit): string | null {
  const now = new Date()
  if (benefit.period === 'one_time') return null
  if (benefit.period === 'monthly') return format(startOfMonth(now), 'yyyy-MM-dd')
  if (benefit.period === 'yearly') {
    const resetMonth = benefit.reset_month || 1
    const year = now.getMonth() + 1 >= resetMonth ? now.getFullYear() : now.getFullYear() - 1
    return `${year}-${String(resetMonth).padStart(2, '0')}-01`
  }
  return null
}

export async function getBenefitsByCard(cardProductId: string): Promise<Benefit[]> {
  const { data, error } = await query<Benefit>(
    'SELECT * FROM benefits WHERE card_product_id = ?',
    [cardProductId]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function getAllMyBenefits(userId?: string): Promise<(Benefit & {
  card_product: CardProduct,
  usage_count: number
})[]> {
  let cardIdsFilter: string[] | null = null

  if (userId) {
    const { data: holders } = await query<{ id: string }>(
      'SELECT id FROM card_holders WHERE created_by = ?', [userId]
    )
    const holderIds = (holders || []).map(h => h.id)
    if (holderIds.length === 0) return []

    const pPlaceholders = holderIds.map(() => '?').join(',')
    const { data: userCards } = await query<{ card_product_id: string }>(
      `SELECT card_product_id FROM credit_cards WHERE holder_id IN (${pPlaceholders})`,
      holderIds
    )
    cardIdsFilter = (userCards || []).map(c => c.card_product_id).filter(Boolean)
    if (cardIdsFilter.length === 0) return []
  }

  // Get product IDs from cards
  let cardSql = 'SELECT DISTINCT card_product_id FROM credit_cards WHERE card_product_id IS NOT NULL'
  let cardParams: unknown[] = []
  if (cardIdsFilter !== null && cardIdsFilter.length > 0) {
    const placeholders = cardIdsFilter.map(() => '?').join(',')
    cardSql += ` AND card_product_id IN (${placeholders})`
    cardParams = cardIdsFilter
  }
  const { data: cards, error: cardsError } = await query<{ card_product_id: string }>(cardSql, cardParams)
  if (cardsError) throw new Error(cardsError.message)
  if (!cards?.length) return []

  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  if (productIds.length === 0) return []

  const pPlaceholders = productIds.map(() => '?').join(',')
  const { data: benefits, error: benefitsError } = await query<Benefit>(
    `SELECT * FROM benefits WHERE card_product_id IN (${pPlaceholders})`,
    productIds
  )
  if (benefitsError) throw new Error(benefitsError.message)
  const benefitList = benefits || []
  if (benefitList.length === 0) return []

  const { data: products } = await query<CardProduct>(
    `SELECT * FROM card_products WHERE id IN (${pPlaceholders})`, productIds
  )
  const productMap: Record<string, CardProduct> = (products || []).reduce((acc, p) => {
    acc[p.id] = p
    return acc
  }, {} as Record<string, CardProduct>)

  // Get usage counts
  const benefitIds = benefitList.map(b => b.id)
  const bPlaceholders = benefitIds.map(() => '?').join(',')
  const { data: allUsages } = await query<{ benefit_id: string; used_at: string }>(
    `SELECT benefit_id, used_at FROM benefit_usages WHERE benefit_id IN (${bPlaceholders})`,
    benefitIds
  )

  const usagesByBenefit: Record<string, { benefit_id: string; used_at: string }[]> = {}
  allUsages?.forEach(u => {
    if (!usagesByBenefit[u.benefit_id]) usagesByBenefit[u.benefit_id] = []
    usagesByBenefit[u.benefit_id].push(u)
  })

  return benefitList.map(b => {
    const usages = usagesByBenefit[b.id] || []
    const periodStart = getPeriodStart(b)
    const filteredUsages = periodStart ? usages.filter(u => u.used_at >= periodStart) : usages
    return {
      ...b,
      card_product: productMap[b.card_product_id] || {
        id: b.card_product_id, bank_name: '银行卡', card_name: '标准信用卡', country: 'CN',
        currency: 'CNY', payment_due_type: 'after_billing' as const, payment_due_value: 20,
        is_active: true, created_at: new Date().toISOString()
      },
      usage_count: filteredUsages.length
    }
  })
}

export async function recordBenefitUsage(usage: Omit<BenefitUsage, 'id' | 'created_at'>): Promise<BenefitUsage> {
  const id = uuid()
  const ts = now()
  const { error } = await execute(
    'INSERT INTO benefit_usages (id, benefit_id, used_at, note, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, usage.benefit_id, usage.used_at, usage.note || null, ts]
  )
  if (error) throw new Error(error.message)
  return { ...usage, id, created_at: ts }
}

export async function createBenefit(benefit: Omit<Benefit, 'id' | 'created_at'>): Promise<Benefit> {
  const id = uuid()
  const ts = now()
  const { error } = await execute(
    'INSERT INTO benefits (id, card_product_id, name, description, quota, period, reset_month, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, benefit.card_product_id, benefit.name, benefit.description || null, benefit.quota,
     benefit.period, benefit.reset_month || null, benefit.expiry_date || null, ts]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Benefit>('SELECT * FROM benefits WHERE id = ?', [id])
  if (!row.data) throw new Error('权益创建失败')
  return row.data
}

export async function updateBenefit(id: string, updates: Partial<Benefit>): Promise<Benefit> {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'name', 'description', 'quota', 'period', 'reset_month', 'expiry_date']) {
    if (updates[key as keyof Benefit] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(updates[key as keyof Benefit])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE benefits SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Benefit>('SELECT * FROM benefits WHERE id = ?', [id])
  if (!row.data) throw new Error('权益更新失败')
  return row.data
}

export async function deleteBenefit(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM benefits WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

export async function autoEnrichCardBenefits(cardProductId: string, bankName: string, cardName: string): Promise<Benefit[]> {
  const { aiCollectCardBenefits } = await import('./ai.server')
  const collected = await aiCollectCardBenefits(bankName, cardName)
  if (!collected || collected.length === 0) return []

  const results: Benefit[] = []
  for (const item of collected) {
    const id = uuid()
    const ts = now()
    const { error } = await execute(
      'INSERT INTO benefits (id, card_product_id, name, description, quota, period, reset_month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, cardProductId, item.name, item.description || '', Number(item.quota) || 1,
       item.period || 'yearly', item.reset_month || 1, ts]
    )
    if (!error) {
      results.push({
        id, card_product_id: cardProductId, name: item.name, description: item.description || '',
        quota: Number(item.quota) || 1, period: item.period || 'yearly',
        reset_month: item.reset_month || 1, created_at: ts,
      })
    }
  }
  return results
}
