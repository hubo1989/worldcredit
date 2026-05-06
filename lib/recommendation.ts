// lib/recommendation.ts
import { differenceInDays, parseISO, startOfDay } from 'date-fns'
import type { CreditCard, Promo, Benefit } from './types'

export interface PurchaseInput {
  amount: number
  currency?: string  // default 'CNY'
  scenario?: 'dining' | 'travel' | 'hotel' | 'overseas' | 'online' | 'grocery'
  merchantKeyword?: string
  date?: string       // default today
}

export interface RecommendationResult {
  cardId: string
  cardName: string
  bankName: string
  score: number
  reasons: string[]
  matchingPromos: Array<{
    id: string
    title: string
    reason: string
    endDate?: string
  }>
  matchingBenefits: Array<{
    id: string
    title: string
    reason: string
    remainingQuota: number
    expiryDate?: string
  }>
  warnings: string[]
}

interface ScoringContext {
  card: CreditCard
  promos: (Promo & { used_count?: number })[]
  benefits: (Benefit & { used_count: number })[]
  input: PurchaseInput
  today: Date
}

/**
 * 场景到优惠类型的映射（用于判断场景匹配）
 */
type PurchaseScenario = NonNullable<PurchaseInput['scenario']>

const scenarioKeywords: Record<PurchaseScenario, string[]> = {
  dining: ['餐饮', '美食', '堂食', '外卖', '咖啡', '下午茶'],
  travel: ['出行', '机票', '火车票', '加油', '打车', '租车'],
  hotel: ['酒店', '住宿', '民宿'],
  overseas: ['境外', '海外', '外币', '出境'],
  online: ['网购', '电商', '线上', 'APP'],
  grocery: ['商超', '超市', '生鲜', '便利店'],
}

/**
 * 检查优惠类型是否匹配场景
 */
function promoMatchesScenario(promo: Promo, scenario?: PurchaseInput['scenario']): boolean {
  if (!scenario) return false

  const keywords = scenarioKeywords[scenario] || []

  // 检查标题或描述中是否包含场景关键词
  const titleLower = promo.title.toLowerCase()
  const descLower = (promo.description || '').toLowerCase()

  return keywords.some(keyword =>
    titleLower.includes(keyword.toLowerCase()) ||
    descLower.includes(keyword.toLowerCase())
  )
}

/**
 * 检查优惠是否即将到期（≤7天）
 */
function isExpiringSoon(endDate?: string, today = new Date()): boolean {
  if (!endDate) return false
  const daysLeft = differenceInDays(parseISO(endDate), startOfDay(today))
  return daysLeft >= 0 && daysLeft <= 7
}

/**
 * 检查优惠是否已过期
 */
function isExpired(endDate?: string, today = new Date()): boolean {
  if (!endDate) return false
  return differenceInDays(parseISO(endDate), startOfDay(today)) < 0
}

/**
 * 检查权益是否即将到期（≤30天）
 */
function benefitIsExpiringSoon(expiryDate?: string, today = new Date()): boolean {
  if (!expiryDate) return false
  const daysLeft = differenceInDays(parseISO(expiryDate), startOfDay(today))
  return daysLeft >= 0 && daysLeft <= 30
}

/**
 * 计算权益剩余额度
 */
function getRemainingQuota(benefit: Benefit & { used_count: number }): number {
  return Math.max(0, benefit.quota - benefit.used_count)
}

/**
 * 为单张卡片评分
 */
export function scoreCardForPurchase(
  card: CreditCard,
  promos: (Promo & { used_count?: number })[],
  benefits: (Benefit & { used_count: number })[],
  input: PurchaseInput
): RecommendationResult {
  const today = startOfDay(input.date ? new Date(input.date) : new Date())
  const currency = input.currency || 'CNY'

  // 卡片状态检查：非 active 直接排除
  if (card.status !== 'active') {
    return {
      cardId: card.id,
      cardName: card.card_name,
      bankName: card.bank_name,
      score: -1,
      reasons: [],
      matchingPromos: [],
      matchingBenefits: [],
      warnings: [`卡片状态为 ${card.status}，无法使用`],
    }
  }

  let score = 0
  const reasons: string[] = []
  const matchingPromos: RecommendationResult['matchingPromos'] = []
  const matchingBenefits: RecommendationResult['matchingBenefits'] = []
  const warnings: string[] = []

  // 1. 币种匹配: +10
  const currencyMatch = card.currency === currency
  if (currencyMatch) {
    score += 10
    reasons.push(`币种匹配 (${currency})`)
  } else {
    warnings.push(`币种不匹配 (卡片: ${card.currency}, 消费: ${currency})`)
  }

  // 2. 额度充足: +15
  // 注意：这里需要从账单计算已用额度，暂时假设 credit_limit 就是可用额度
  // TODO: 实现真正的可用额度计算（credit_limit - 已出账未还款 - 未出账已消费）
  const hasEnoughCredit = card.credit_limit >= input.amount
  if (hasEnoughCredit) {
    score += 15
    reasons.push(`额度充足 (¥${card.credit_limit.toLocaleString()})`)
  } else {
    warnings.push(`额度不足 (需要 ¥${input.amount}, 可用 ¥${card.credit_limit})`)
  }

  // 3. 优惠匹配评分
  const validPromos = promos.filter(p => !isExpired(p.end_date, today))

  for (const promo of validPromos) {
    let promoScore = 0
    const promoReasons: string[] = []

    // 优惠匹配银行或卡片: +40
    const matchesCard = promo.card_id === card.id || promo.bank_name === card.bank_name
    if (matchesCard) {
      promoScore += 40
      promoReasons.push('适用此卡')
    }

    // 优惠类型匹配场景: +20
    if (input.scenario && promoMatchesScenario(promo, input.scenario)) {
      promoScore += 20
      const scenarioLabel: Record<PurchaseScenario, string> = {
        dining: '餐饮',
        travel: '出行',
        hotel: '酒店',
        overseas: '境外',
        online: '网购',
        grocery: '商超',
      }
      promoReasons.push(`${scenarioLabel[input.scenario]}场景`)
    }

    // 优惠即将到期: +10
    if (isExpiringSoon(promo.end_date, today)) {
      promoScore += 10
      promoReasons.push('7天内到期')
    }

    // 检查是否已用尽
    const isUsedUp = promo.max_uses !== undefined && promo.used_count !== undefined && promo.used_count >= promo.max_uses

    if (promoScore > 0 && !isUsedUp) {
      matchingPromos.push({
        id: promo.id,
        title: promo.title,
        reason: promoReasons.join(', '),
        endDate: promo.end_date,
      })
      score += promoScore
    }
  }

  if (matchingPromos.length > 0) {
    reasons.push(`匹配 ${matchingPromos.length} 个优惠活动`)
  }

  // 4. 权益匹配评分
  for (const benefit of benefits) {
    let benefitScore = 0
    const benefitReasons: string[] = []

    const remainingQuota = getRemainingQuota(benefit)

    // 权益场景匹配且有剩余额度: +25
    // TODO: 需要在 Benefit 表中添加 scenario 字段或从 description 解析
    // 暂时跳过场景匹配，只检查剩余额度
    if (remainingQuota > 0) {
      benefitScore += 25
      benefitReasons.push(`剩余 ${remainingQuota} 次`)

      // 权益即将到期: +10
      if (benefitIsExpiringSoon(benefit.expiry_date, today)) {
        benefitScore += 10
        benefitReasons.push('30天内到期')
      }

      matchingBenefits.push({
        id: benefit.id,
        title: benefit.name,
        reason: benefitReasons.join(', '),
        remainingQuota,
        expiryDate: benefit.expiry_date,
      })
      score += benefitScore
    } else {
      warnings.push(`权益「${benefit.name}」已用尽`)
    }
  }

  if (matchingBenefits.length > 0) {
    reasons.push(`可用 ${matchingBenefits.length} 个权益`)
  }

  // 如果没有匹配任何机会，给出提示
  if (matchingPromos.length === 0 && matchingBenefits.length === 0) {
    warnings.push('当前消费场景暂无匹配的优惠或权益')
  }

  return {
    cardId: card.id,
    cardName: card.card_name,
    bankName: card.bank_name,
    score,
    reasons,
    matchingPromos,
    matchingBenefits,
    warnings,
  }
}

/**
 * 排序推荐结果：分数降序，即将到期机会优先，剩余额度降序
 */
export function sortRecommendations(results: RecommendationResult[]): RecommendationResult[] {
  return results.sort((a, b) => {
    // 首先按分数降序
    if (a.score !== b.score) {
      return b.score - a.score
    }

    // 分数相同，计算即将到期机会数量
    const aExpiringCount =
      a.matchingPromos.filter(p => p.endDate && isExpiringSoon(p.endDate)).length +
      a.matchingBenefits.filter(b => b.expiryDate && benefitIsExpiringSoon(b.expiryDate)).length

    const bExpiringCount =
      b.matchingPromos.filter(p => p.endDate && isExpiringSoon(p.endDate)).length +
      b.matchingBenefits.filter(b => b.expiryDate && benefitIsExpiringSoon(b.expiryDate)).length

    if (aExpiringCount !== bExpiringCount) {
      return bExpiringCount - aExpiringCount
    }

    // 即将到期数量相同，按剩余总额度降序
    const aTotalQuota = a.matchingBenefits.reduce((sum, b) => sum + b.remainingQuota, 0)
    const bTotalQuota = b.matchingBenefits.reduce((sum, b) => sum + b.remainingQuota, 0)

    return bTotalQuota - aTotalQuota
  })
}
