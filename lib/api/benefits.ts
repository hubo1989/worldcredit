import { insforge } from '../insforge'
import { startOfMonth, format } from 'date-fns'
import type { Benefit, BenefitUsage, CreditCard, CardProduct } from '../types'

/**
 * 根据权益的周期类型计算当前周期的起始日期
 */
function getPeriodStart(benefit: Benefit): string | null {
  const now = new Date()

  if (benefit.period === 'one_time') {
    // 一次性权益统计所有历史记录
    return null
  }

  if (benefit.period === 'monthly') {
    return format(startOfMonth(now), 'yyyy-MM-dd')
  }

  // yearly：如果有 reset_month，从 reset_month 开始算年度周期
  if (benefit.period === 'yearly') {
    const resetMonth = benefit.reset_month || 1 // 默认 1 月重置
    const year = now.getMonth() + 1 >= resetMonth ? now.getFullYear() : now.getFullYear() - 1
    return `${year}-${String(resetMonth).padStart(2, '0')}-01`
  }

  return null
}

/**
 * 获取特定信用卡的所有可用权益
 */
export async function getBenefitsByCard(cardProductId: string): Promise<Benefit[]> {
  const { data, error } = await insforge.database
    .from('benefits')
    .select('*')
    .eq('card_product_id', cardProductId)
  
  if (error) throw error
  return data || []
}

/**
 * 获取活跃持卡人名下的所有权益汇总
 * 支持传入 userId 仅统计当前用户的信用卡权益
 */
export async function getAllMyBenefits(userId?: string): Promise<(Benefit & { 
  card_product: CardProduct,
  usage_count: number 
})[]> {
  let cardIdsFilter: string[] | null = null

  if (userId) {
    // 获取用户所有的 holder_id
    const { data: holders } = await insforge.database
      .from('card_holders')
      .select('id')
      .eq('created_by', userId)

    const holderIds = (holders || []).map(h => h.id)
    if (holderIds.length === 0) return []

    // 获取持卡人的所有卡
    const { data: userCards } = await insforge.database
      .from('credit_cards')
      .select('card_product_id')
      .in('holder_id', holderIds)

    cardIdsFilter = (userCards || []).map(c => c.card_product_id).filter(Boolean)
    if (cardIdsFilter.length === 0) return []
  }

  // 1. 获取卡产品 IDs
  let cardQuery = insforge.database.from('credit_cards').select('card_product_id')
  if (cardIdsFilter !== null) {
    cardQuery = cardQuery.in('card_product_id', cardIdsFilter)
  }

  const { data: cards, error: cardsError } = await cardQuery
  
  if (cardsError) throw cardsError
  if (!cards?.length) return []

  // 2. 获取这些卡产品对应的权益
  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  if (productIds.length === 0) return []

  const { data: benefits, error: benefitsError } = await insforge.database
    .from('benefits')
    .select('*')
    .in('card_product_id', productIds)
  
  if (benefitsError) throw benefitsError
  const benefitList = benefits || []
  if (benefitList.length === 0) return []

  // 3. 批量 Fetch 获取关联的 card_product 结构
  const { data: products } = await insforge.database
    .from('card_products')
    .select('*')
    .in('id', productIds)

  const productMap: Record<string, CardProduct> = (products || []).reduce((acc, p) => {
    acc[p.id] = p
    return acc
  }, {} as Record<string, CardProduct>)

  // 4. 按周期统计使用情况
  const benefitIds = benefitList.map(b => b.id)

  const { data: allUsages } = await insforge.database
    .from('benefit_usages')
    .select('benefit_id, used_at')
    .in('benefit_id', benefitIds)

  const usagesByBenefit: Record<string, { benefit_id: string; used_at: string }[]> = {}
  allUsages?.forEach(u => {
    if (!usagesByBenefit[u.benefit_id]) usagesByBenefit[u.benefit_id] = []
    usagesByBenefit[u.benefit_id].push(u)
  })

  return benefitList.map(b => {
    const usages = usagesByBenefit[b.id] || []
    const periodStart = getPeriodStart(b)

    const filteredUsages = periodStart
      ? usages.filter(u => u.used_at >= periodStart)
      : usages

    return {
      ...b,
      card_product: productMap[b.card_product_id] || {
        id: b.card_product_id,
        bank_name: '银行卡',
        card_name: '标准信用卡',
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        is_active: true,
        created_at: new Date().toISOString()
      },
      usage_count: filteredUsages.length
    }
  })
}

/**
 * 登记权益使用
 */
export async function recordBenefitUsage(usage: Omit<BenefitUsage, 'id' | 'created_at'>): Promise<BenefitUsage> {
  const { data, error } = await insforge.database
    .from('benefit_usages')
    .insert([usage])
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * 手动新增卡权益
 */
export async function createBenefit(benefit: Omit<Benefit, 'id' | 'created_at'>): Promise<Benefit> {
  const { data, error } = await insforge.database
    .from('benefits')
    .insert([benefit])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 手动更新卡权益
 */
export async function updateBenefit(id: string, updates: Partial<Benefit>): Promise<Benefit> {
  const { data, error } = await insforge.database
    .from('benefits')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 删除卡权益
 */
export async function deleteBenefit(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('benefits')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * 调用 LLM + 搜索自动抓取信用卡的专属权益，并批量持久化写入数据库
 */
export async function autoEnrichCardBenefits(cardProductId: string, bankName: string, cardName: string): Promise<Benefit[]> {
  const { aiCollectCardBenefits } = await import('./ai')
  const collected = await aiCollectCardBenefits(bankName, cardName)

  if (!collected || collected.length === 0) {
    return []
  }

  const rowsToInsert = collected.map(item => ({
    card_product_id: cardProductId,
    name: item.name,
    description: item.description || '',
    quota: Number(item.quota) || 1,
    period: item.period || 'yearly',
    reset_month: item.reset_month || 1
  }))

  const { data, error } = await insforge.database
    .from('benefits')
    .insert(rowsToInsert)
    .select()

  if (error) throw error
  return data || []
}

