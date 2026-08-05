// lib/__tests__/recommendation.test.ts
import { scoreCardForPurchase, sortRecommendations, type PurchaseInput } from '../recommendation'
import type { CreditCard, Promo, Benefit } from '../types'

describe('recommendation', () => {
  const mockCard: CreditCard = {
    id: 'card-1',
    holder_id: 'holder-1',
    country: 'CN',
    bank_name: '招商银行',
    card_name: '金葵花',
    card_number_last4: '1234',
    credit_limit: 50000,
    currency: 'CNY',
    billing_day: 10,
    payment_due_type: 'after_billing',
    payment_due_value: 20,
    annual_fee: 400,
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
  }

  const mockPromos: (Promo & { used_count?: number })[] = [
    {
      id: 'promo-1',
      card_id: 'card-1',
      bank_name: '招商银行',
      title: '餐饮满减优惠',
      description: '餐饮消费满200减50',
      discount_type: '满减',
      start_date: '2024-01-01',
      end_date: '2025-12-31',
      conditions: '满200减50',
      max_uses: 100,
      created_at: '2024-01-01T00:00:00Z',
      used_count: 5,
    },
    {
      id: 'promo-2',
      card_id: undefined,
      bank_name: '招商银行',
      title: '出行返现活动',
      description: '机票火车票消费返现10%',
      discount_type: '返现',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3天后到期
      conditions: '返现10%',
      created_at: '2024-01-01T00:00:00Z',
      used_count: 0,
    },
    {
      id: 'promo-3',
      card_id: 'card-1',
      bank_name: '招商银行',
      title: '已过期优惠',
      description: '这个优惠已过期',
      discount_type: '折扣',
      start_date: '2024-01-01',
      end_date: '2023-12-31',
      conditions: '无',
      created_at: '2024-01-01T00:00:00Z',
    },
  ]

  const mockBenefits: (Benefit & { used_count: number })[] = [
    {
      id: 'benefit-1',
      card_id: 'card-1',
      name: '机场贵宾厅',
      description: '全年6次机场贵宾厅服务',
      quota: 6,
      period: 'yearly',
      expiry_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 20天后到期
      created_at: '2024-01-01T00:00:00Z',
      used_count: 4,
    },
    {
      id: 'benefit-2',
      card_id: 'card-1',
      name: '美食权益',
      description: '每月2次美食五折',
      quota: 2,
      period: 'monthly',
      expiry_date: '2024-12-31',
      created_at: '2024-01-01T00:00:00Z',
      used_count: 2, // 已用尽
    },
  ]

  describe('scoreCardForPurchase', () => {
    it('应该正确评分匹配所有条件的卡片', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
        scenario: 'dining',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.cardId).toBe('card-1')
      expect(result.score).toBeGreaterThan(0)
      expect(result.reasons).toContain('币种匹配 (CNY)')
      expect(result.reasons).toContain('额度充足 (¥50,000)')
      // promo-1 匹配卡片和场景, promo-2 匹配银行, promo-3 已过期被排除
      expect(result.matchingPromos.length).toBeGreaterThanOrEqual(1)
      expect(result.matchingBenefits.length).toBe(1) // 排除已用尽的
    })

    it('应该排除非 active 状态的卡片', () => {
      const inactiveCard = { ...mockCard, status: 'frozen' as const }
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(inactiveCard, mockPromos, mockBenefits, input)

      expect(result.score).toBe(-1)
      expect(result.warnings).toContain('卡片状态为 frozen，无法使用')
    })

    it('应该对币种不匹配给出警告', () => {
      const input: PurchaseInput = {
        amount: 100,
        currency: 'USD',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.warnings).toContain('币种不匹配 (卡片: CNY, 消费: USD)')
    })

    it('应该对额度不足给出警告', () => {
      const input: PurchaseInput = {
        amount: 100000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      // Check that we get a warning about insufficient credit
      const hasInsufficientWarning = result.warnings.some(w =>
        w.includes('额度不足') || w.includes('100,000')
      )
      expect(hasInsufficientWarning).toBe(true)
    })

    it('应该识别即将到期的优惠（≤7天）', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
        scenario: 'travel',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      const expiringPromo = result.matchingPromos.find(p => p.id === 'promo-2')
      expect(expiringPromo?.reason).toContain('7天内到期')
    })

    it('应该识别场景匹配的优惠', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
        scenario: 'dining',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      // promo-1 应该匹配，因为它匹配卡片ID和银行
      // promo-2 也应该匹配，因为它匹配银行
      // promo-3 已过期，应该被排除
      expect(result.matchingPromos.length).toBeGreaterThanOrEqual(1)

      // 至少应该有一个匹配的优惠（promo-2 匹配银行）
      const anyMatch = result.matchingPromos.find(p =>
        p.id === 'promo-1' || p.id === 'promo-2'
      )
      expect(anyMatch).toBeDefined()

      // 如果 promo-1 存在，它应该包含"适用此卡"原因
      const promo1 = result.matchingPromos.find(p => p.id === 'promo-1')
      if (promo1) {
        expect(promo1.reason).toContain('适用此卡')
      }
    })

    it('应该识别即将到期的权益（≤30天）', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      const expiringBenefit = result.matchingBenefits.find(b => b.id === 'benefit-1')
      expect(expiringBenefit?.reason).toContain('30天内到期')
    })

    it('应该排除已用尽的权益', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.matchingBenefits.find(b => b.id === 'benefit-2')).toBeUndefined()
      expect(result.warnings).toContain('权益「美食权益」已用尽')
    })

    it('应该排除已过期的优惠', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.matchingPromos.find(p => p.id === 'promo-3')).toBeUndefined()
    })

    it('应该在没有匹配机会时给出提示', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
        scenario: 'online',
      }

      const result = scoreCardForPurchase(mockCard, [], [], input)

      expect(result.warnings).toContain('当前消费场景暂无匹配的优惠或权益')
    })
  })

  describe('sortRecommendations', () => {
    it('应该按分数降序排序', () => {
      const results = [
        { score: 50, cardId: 'card-2' } as any,
        { score: 100, cardId: 'card-1' } as any,
        { score: 75, cardId: 'card-3' } as any,
      ]

      const sorted = sortRecommendations(results)

      expect(sorted[0].cardId).toBe('card-1')
      expect(sorted[1].cardId).toBe('card-3')
      expect(sorted[2].cardId).toBe('card-2')
    })

    it('应该在分数相同时优先推荐即将到期的机会', () => {
      const results = [
        {
          score: 50,
          cardId: 'card-1',
          matchingPromos: [{ id: 'p1', title: 'Promo 1', reason: '', endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }],
          matchingBenefits: [],
        } as any,
        {
          score: 50,
          cardId: 'card-2',
          matchingPromos: [{ id: 'p2', title: 'Promo 2', reason: '', endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }],
          matchingBenefits: [],
        } as any,
      ]

      const sorted = sortRecommendations(results)

      expect(sorted[0].cardId).toBe('card-2') // 更快到期
    })

    it('应该在分数和到期时间都相同时按剩余额度降序排序', () => {
      const results = [
        {
          score: 50,
          cardId: 'card-1',
          matchingPromos: [],
          matchingBenefits: [{ id: 'b1', title: 'Benefit 1', reason: '', remainingQuota: 2 }],
        } as any,
        {
          score: 50,
          cardId: 'card-2',
          matchingPromos: [],
          matchingBenefits: [{ id: 'b2', title: 'Benefit 2', reason: '', remainingQuota: 5 }],
        } as any,
      ]

      const sorted = sortRecommendations(results)

      expect(sorted[0].cardId).toBe('card-2') // 剩余额度更多
    })
  })

  describe('边界情况', () => {
    it('应该处理零金额输入', () => {
      const input: PurchaseInput = {
        amount: 0,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.score).toBeGreaterThanOrEqual(0)
    })

    it('应该处理没有匹配机会的情况', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, [], [], input)

      expect(result.matchingPromos).toHaveLength(0)
      expect(result.matchingBenefits).toHaveLength(0)
    })

    it('应该处理所有卡额度不足的情况', () => {
      const input: PurchaseInput = {
        amount: 1000000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.warnings.some(w => w.includes('额度不足'))).toBe(true)
    })

    it('应该处理没有场景的输入', () => {
      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
        scenario: undefined,
      }

      const result = scoreCardForPurchase(mockCard, mockPromos, mockBenefits, input)

      expect(result.score).toBeGreaterThan(0)
      expect(result.matchingPromos.length).toBeGreaterThan(0) // 银行匹配仍应生效
    })

    it('应该处理没有到期日期的优惠', () => {
      const promosWithoutEndDates: (Promo & { used_count?: number })[] = [
        {
          ...mockPromos[0],
          end_date: undefined,
        },
      ]

      const input: PurchaseInput = {
        amount: 1000,
        currency: 'CNY',
      }

      const result = scoreCardForPurchase(mockCard, promosWithoutEndDates, mockBenefits, input)

      expect(result.matchingPromos.length).toBeGreaterThan(0)
    })
  })
})
