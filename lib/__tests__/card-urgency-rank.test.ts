import { describe, it, expect } from 'vitest'
import { cardUrgencyRank } from '../utils'

/**
 * 回归：账单页要求「逾期 → 待还款 → 未出账单/已结清」固定分组。
 *
 * 之前的排序只按免息期或还款日排，一笔刚到期的账单会被埋在一堆
 * 未出账单的卡里，用户得逐张翻才能看出哪张该还。
 */
describe('cardUrgencyRank', () => {
  it('puts overdue first, then unpaid/partial, then everything else', () => {
    expect(cardUrgencyRank('overdue')).toBe(0)
    expect(cardUrgencyRank('unpaid')).toBe(1)
    expect(cardUrgencyRank('partial')).toBe(1)
    expect(cardUrgencyRank('unissued')).toBe(2)
  })

  it('ranks every card status in the fixed order overdue < unpaid < unissued', () => {
    expect(cardUrgencyRank('overdue')).toBeLessThan(cardUrgencyRank('unpaid'))
    expect(cardUrgencyRank('unpaid')).toBeLessThan(cardUrgencyRank('unissued'))
  })

  it('keeps partial in the same group as unpaid, since money is still owed', () => {
    expect(cardUrgencyRank('partial')).toBe(cardUrgencyRank('unpaid'))
  })

  it('sorts a mixed card list into overdue → unpaid/partial → unissued', () => {
    const cards = [
      { id: 'a', status: 'unissued' as const },
      { id: 'b', status: 'unpaid' as const },
      { id: 'c', status: 'overdue' as const },
      { id: 'd', status: 'partial' as const },
    ]
    const sorted = [...cards].sort((x, y) => cardUrgencyRank(x.status) - cardUrgencyRank(y.status))
    expect(sorted.map(c => c.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('only ever returns 0/1/2 so the rank is safe to compare directly', () => {
    for (const status of ['overdue', 'unpaid', 'partial', 'unissued'] as const) {
      expect([0, 1, 2]).toContain(cardUrgencyRank(status))
    }
  })
})
