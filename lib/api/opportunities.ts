// lib/api/opportunities.ts
import { differenceInDays, parseISO, isAfter, isBefore, startOfDay } from 'date-fns'
import { getPromos, getPromosForCards, getPromoUsages } from './promos'
import { getBenefitsWithUsage, getBenefitsByCard } from './benefits'
import { getCardsByHolder } from './cards'
import type { Promo, Benefit, CreditCard } from '../types'

export interface Opportunity {
  id: string
  type: 'promo' | 'benefit'
  title: string
  bank_name: string
  card_id?: string
  card_name?: string
  status: 'available' | 'expiring' | 'expired' | 'used_up' | 'not_started'
  starts_at?: string
  ends_at?: string
  used_count?: number
  quota?: number
  priority_score: number
  reason_tags: string[]
  description?: string
  conditions?: string
  discount_type?: string
}

export interface OpportunityFilters {
  type?: 'promo' | 'benefit' | 'all'
  bank_name?: string
  card_id?: string
  status?: 'available' | 'expiring' | 'expired' | 'used_up' | 'not_started'
  discount_type?: '满减' | '折扣' | '积分' | '返现'
}

/**
 * 计算机会的优先级分数（分数越高优先级越高）
 */
function calculatePriorityScore(opp: Partial<Opportunity>): number {
  const today = startOfDay(new Date())
  let score = 0

  // 基础分数
  score += 100

  // 1. 今天截止 (最高优先级)
  if (opp.ends_at) {
    const daysLeft = differenceInDays(parseISO(opp.ends_at), today)
    if (daysLeft === 0) {
      score += 1000
    } else if (daysLeft > 0 && daysLeft <= 3) {
      score += 800  // 2. 3天内到期
    } else if (daysLeft > 0 && daysLeft <= 7) {
      score += 600  // 3. 7天内到期
    } else if (daysLeft < 0) {
      score -= 500  // 已过期，降低优先级
    }
  }

  // 4. 权益剩余额度少且即将过期
  if (opp.type === 'benefit' && opp.quota && opp.used_count !== undefined) {
    const remaining = opp.quota - opp.used_count
    const usageRate = opp.used_count / opp.quota

    if (remaining <= 2 && opp.ends_at) {
      const daysLeft = differenceInDays(parseISO(opp.ends_at), today)
      if (daysLeft > 0 && daysLeft <= 30) {
        score += 400  // 剩余额度少且即将过期
      }
    }

    // 已用尽
    if (remaining <= 0) {
      score -= 300
    }

    // 使用率越高，优先级越高（鼓励使用）
    score += usageRate * 50
  }

  // 6. 未开始
  if (opp.starts_at && isAfter(parseISO(opp.starts_at), today)) {
    score -= 200
  }

  return score
}

/**
 * 确定机会的状态
 */
function determineStatus(opp: Partial<Opportunity>): Opportunity['status'] {
  const today = startOfDay(new Date())

  // 检查是否已用尽
  if (opp.type === 'benefit' && opp.quota && opp.used_count !== undefined) {
    if (opp.used_count >= opp.quota) {
      return 'used_up'
    }
  }

  // 检查是否已过期
  if (opp.ends_at && isBefore(parseISO(opp.ends_at), today)) {
    return 'expired'
  }

  // 检查是否未开始
  if (opp.starts_at && isAfter(parseISO(opp.starts_at), today)) {
    return 'not_started'
  }

  // 检查是否即将到期（7天内）
  if (opp.ends_at) {
    const daysLeft = differenceInDays(parseISO(opp.ends_at), today)
    if (daysLeft >= 0 && daysLeft <= 7) {
      return 'expiring'
    }
  }

  return 'available'
}

/**
 * 生成原因标签
 */
function generateReasonTags(opp: Partial<Opportunity>): string[] {
  const tags: string[] = []
  const today = startOfDay(new Date())

  if (opp.ends_at) {
    const daysLeft = differenceInDays(parseISO(opp.ends_at), today)
    if (daysLeft === 0) {
      tags.push('今天截止')
    } else if (daysLeft > 0 && daysLeft <= 3) {
      tags.push('3天内到期')
    } else if (daysLeft > 0 && daysLeft <= 7) {
      tags.push('7天内到期')
    } else if (daysLeft < 0) {
      tags.push('已过期')
    }
  }

  if (opp.type === 'benefit' && opp.quota && opp.used_count !== undefined) {
    const remaining = opp.quota - opp.used_count
    if (remaining <= 2 && remaining > 0) {
      tags.push(`剩余${remaining}次`)
    } else if (remaining <= 0) {
      tags.push('已用尽')
    }
  }

  if (opp.starts_at && isAfter(parseISO(opp.starts_at), today)) {
    tags.push('未开始')
  }

  return tags
}

/**
 * 将优惠转换为机会格式
 */
async function promoToOpportunity(
  promo: Promo & { card_name?: string },
  cards: CreditCard[]
): Promise<Opportunity> {
  // 获取使用次数
  const usages = await getPromoUsages(promo.id)
  const usedCount = usages.length

  const partial: Partial<Opportunity> = {
    id: `promo-${promo.id}`,
    type: 'promo',
    title: promo.title,
    bank_name: promo.bank_name,
    card_id: promo.card_id,
    card_name: promo.card_name,
    starts_at: promo.start_date,
    ends_at: promo.end_date,
    used_count: usedCount,
    quota: promo.max_uses,
    description: promo.description,
    conditions: promo.conditions,
    discount_type: promo.discount_type,
  }

  return {
    ...partial,
    status: determineStatus(partial),
    priority_score: calculatePriorityScore(partial),
    reason_tags: generateReasonTags(partial),
  } as Opportunity
}

/**
 * 将权益转换为机会格式
 */
async function benefitToOpportunity(
  benefit: Benefit & { used_count: number; card_name?: string; bank_name?: string }
): Promise<Opportunity> {
  const partial: Partial<Opportunity> = {
    id: `benefit-${benefit.id}`,
    type: 'benefit',
    title: benefit.name,
    bank_name: benefit.bank_name || '',
    card_id: benefit.card_id,
    card_name: benefit.card_name,
    ends_at: benefit.expiry_date,
    used_count: benefit.used_count,
    quota: benefit.quota,
    description: benefit.description,
  }

  return {
    ...partial,
    status: determineStatus(partial),
    priority_score: calculatePriorityScore(partial),
    reason_tags: generateReasonTags(partial),
  } as Opportunity
}

/**
 * 获取所有机会（管理员视角）
 */
export async function getOpportunities(
  userId: string,
  filters: OpportunityFilters = {}
): Promise<Opportunity[]> {
  // 获取所有优惠
  const promos = await getPromos()

  // 获取该管理员管理的所有持卡人及其卡片
  const { getHolders } = await import('./holders')
  const holders = await getHolders(userId, 'admin')

  const cardsPromises = holders.map(holder => getCardsByHolder(holder.id))
  const cardsArrays = await Promise.all(cardsPromises)
  const cards = cardsArrays.flat()

  // 获取所有权益
  const benefitsPromises = cards.map(card => getBenefitsWithUsage(card.id))
  const benefitsArrays = await Promise.all(benefitsPromises)
  const benefits = benefitsArrays.flat()

  // 组合卡片信息
  const promosWithCardName = promos.map(promo => ({
    ...promo,
    card_name: promo.card_id ? cards.find(c => c.id === promo.card_id)?.card_name : undefined,
  }))

  const benefitsWithCardInfo = benefits.map(benefit => ({
    ...benefit,
    card_name: cards.find(c => c.id === benefit.card_id)?.card_name,
    bank_name: cards.find(c => c.id === benefit.card_id)?.bank_name,
  }))

  // 转换为机会
  const promoOpportunities = await Promise.all(
    promosWithCardName.map(p => promoToOpportunity(p, cards))
  )
  const benefitOpportunities = await Promise.all(
    benefitsWithCardInfo.map(b => benefitToOpportunity(b as any))
  )

  let opportunities = [...promoOpportunities, ...benefitOpportunities]

  // 应用筛选器
  opportunities = applyFilters(opportunities, filters)

  // 按优先级排序
  opportunities.sort((a, b) => b.priority_score - a.priority_score)

  return opportunities
}

/**
 * 获取持卡人可见的机会
 */
export async function getOpportunitiesForHolder(
  holderId: string,
  filters: OpportunityFilters = {}
): Promise<Opportunity[]> {
  const cards = await getCardsByHolder(holderId)

  // 获取该持卡人的优惠
  const promos = await getPromosForCards(cards, false)

  // 获取该持卡人的权益
  const benefitsPromises = cards.map(card => getBenefitsWithUsage(card.id))
  const benefitsArrays = await Promise.all(benefitsPromises)
  const benefits = benefitsArrays.flat()

  // 组合卡片信息
  const promosWithCardName = promos.map(promo => ({
    ...promo,
    card_name: promo.card_id ? cards.find(c => c.id === promo.card_id)?.card_name : undefined,
  }))

  const benefitsWithCardInfo = benefits.map(benefit => ({
    ...benefit,
    card_name: cards.find(c => c.id === benefit.card_id)?.card_name,
    bank_name: cards.find(c => c.id === benefit.card_id)?.bank_name,
  }))

  // 转换为机会
  const promoOpportunities = await Promise.all(
    promosWithCardName.map(p => promoToOpportunity(p, cards))
  )
  const benefitOpportunities = await Promise.all(
    benefitsWithCardInfo.map(b => benefitToOpportunity(b as any))
  )

  let opportunities = [...promoOpportunities, ...benefitOpportunities]

  // 应用筛选器
  opportunities = applyFilters(opportunities, filters)

  // 按优先级排序
  opportunities.sort((a, b) => b.priority_score - a.priority_score)

  return opportunities
}

/**
 * 获取特定卡片的机会
 */
export async function getCardOpportunities(cardId: string): Promise<Opportunity[]> {
  // 获取卡片信息
  const { getCard } = await import('./cards')
  const card = await getCard(cardId)
  if (!card) return []

  // 获取该卡片的优惠
  const promos = await getPromos(cardId)

  // 获取该卡片的权益
  const benefits = await getBenefitsWithUsage(cardId)

  // 组合卡片信息
  const promosWithCardName = promos.map(promo => ({
    ...promo,
    card_name: card.card_name,
  }))

  const benefitsWithCardInfo = benefits.map(benefit => ({
    ...benefit,
    card_name: card.card_name,
    bank_name: card.bank_name,
  }))

  // 转换为机会
  const promoOpportunities = await Promise.all(
    promosWithCardName.map(p => promoToOpportunity(p, [card]))
  )
  const benefitOpportunities = await Promise.all(
    benefitsWithCardInfo.map(b => benefitToOpportunity(b as any))
  )

  const opportunities = [...promoOpportunities, ...benefitOpportunities]

  // 按优先级排序
  opportunities.sort((a, b) => b.priority_score - a.priority_score)

  return opportunities
}

/**
 * 应用筛选器
 */
function applyFilters(opportunities: Opportunity[], filters: OpportunityFilters): Opportunity[] {
  let filtered = opportunities

  if (filters.type && filters.type !== 'all') {
    filtered = filtered.filter(opp => opp.type === filters.type)
  }

  if (filters.bank_name) {
    filtered = filtered.filter(opp => opp.bank_name === filters.bank_name)
  }

  if (filters.card_id) {
    filtered = filtered.filter(opp => opp.card_id === filters.card_id)
  }

  if (filters.status) {
    filtered = filtered.filter(opp => opp.status === filters.status)
  }

  if (filters.discount_type) {
    filtered = filtered.filter(opp => opp.discount_type === filters.discount_type)
  }

  return filtered
}
