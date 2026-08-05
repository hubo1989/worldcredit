// lib/api/recommendations.ts
import { getCardsByHolder } from './cards'
import { getPromosWithUsage } from './promos'
import { getBenefitsWithUsage } from './benefits'
import { scoreCardForPurchase, sortRecommendations, type PurchaseInput, type RecommendationResult } from '../recommendation'

export type { PurchaseInput, RecommendationResult } from '../recommendation'

/**
 * 获取卡片推荐
 * @param input 消费输入
 * @param userId 用户ID（用于权限检查）
 * @param holderId 持卡人ID（可选，管理员可指定，成员默认为自己）
 */
export async function getCardRecommendations(
  input: PurchaseInput,
  userId: string,
  role: 'admin' | 'member',
  holderId?: string
): Promise<RecommendationResult[]> {
  // 输入验证
  if (input.amount <= 0) {
    throw new Error('消费金额必须大于 0')
  }

  // 获取用户可访问的持卡人
  const { getHolders } = await import('./holders')

  const holders = await getHolders(userId, role)

  // 如果指定了 holderId，验证权限
  let targetHolderIds: string[]
  if (holderId) {
    const hasAccess = holders.some(h => h.id === holderId)
    if (!hasAccess) {
      throw new Error('无权访问该持卡人的卡片')
    }
    targetHolderIds = [holderId]
  } else {
    // 默认使用所有可访问的持卡人
    targetHolderIds = holders.map(h => h.id)
  }

  // 获取所有卡片
  const cardsPromises = targetHolderIds.map(holderId => getCardsByHolder(holderId))
  const cardsArrays = await Promise.all(cardsPromises)
  const allCards = cardsArrays.flat()

  if (allCards.length === 0) {
    return []
  }

  // 获取所有优惠（带使用统计）
  const promos = await getPromosWithUsage(allCards, false)

  // 获取所有权益（带使用统计）
  const benefitsPromises = allCards.map(card => getBenefitsWithUsage(card.id))
  const benefitsArrays = await Promise.all(benefitsPromises)
  const allBenefits = benefitsArrays.flat()

  // 为每张卡片评分
  const results: RecommendationResult[] = allCards.map(card => {
    // 筛选出该卡片的优惠
    const cardPromos = promos.filter(p => {
      if (p.card_id) return p.card_id === card.id
      return p.bank_name === card.bank_name
    })

    // 筛选出该卡片的权益
    const cardBenefits = allBenefits.filter(b => b.card_id === card.id)

    return scoreCardForPurchase(card, cardPromos, cardBenefits, input)
  })

  // 过滤掉不可用的卡片（分数为 -1）
  const validResults = results.filter(r => r.score >= 0)

  // 排序并返回
  return sortRecommendations(validResults)
}
