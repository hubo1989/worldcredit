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
 */
export async function getAllMyBenefits(): Promise<(Benefit & { 
  card_product: CardProduct,
  usage_count: number 
})[]> {
  // 1. 获取所有卡
  const { data: cards, error: cardsError } = await insforge.database
    .from('credit_cards')
    .select('card_product_id, card_product:card_products(*)')
  
  if (cardsError) throw cardsError
  if (!cards?.length) return []

  // 2. 获取这些卡产品对应的权益
  const productIds = cards.map(c => c.card_product_id)
  const { data: benefits, error: benefitsError } = await insforge.database
    .from('benefits')
    .select('*, card_product:card_products(*)')
    .in('card_product_id', productIds)
  
  if (benefitsError) throw benefitsError

  // 3. 按周期统计使用情况
  const benefitList = benefits || []
  const benefitIds = benefitList.map(b => b.id)

  // 获取所有相关权益的使用记录
  const { data: allUsages } = await insforge.database
    .from('benefit_usages')
    .select('benefit_id, used_at')
    .in('benefit_id', benefitIds)

  // 按权益 ID 分组
  const usagesByBenefit: Record<string, { benefit_id: string; used_at: string }[]> = {}
  allUsages?.forEach(u => {
    if (!usagesByBenefit[u.benefit_id]) usagesByBenefit[u.benefit_id] = []
    usagesByBenefit[u.benefit_id].push(u)
  })

  return benefitList.map(b => {
    const usages = usagesByBenefit[b.id] || []
    const periodStart = getPeriodStart(b)

    // 过滤当前周期内的使用记录
    const filteredUsages = periodStart
      ? usages.filter(u => u.used_at >= periodStart)
      : usages // one_time 不过滤

    return {
      ...b,
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
