import { describe, it, expect } from 'vitest'
import {
  compareBillsListCards,
  billsListSortKey,
  dueDistanceLabel,
  nextBillingDateOf,
  daysUntilNextBilling,
  type BillsListCard,
} from '../utils'

/**
 * 回归：账单页排序固定为三段，每段一条时间轴，方向统一为「最紧要的在前」。
 *
 *   逾期     → 逾期最久 → 最短
 *   待还款   → 距还款日最近 → 最远
 *   未出账单 → 距账单日最近 → 最远
 */

const TODAY = new Date(2026, 8, 14) // 2026-09-14

const card = (
  status: BillsListCard['status'],
  billingDay: number,
  dues: { due_date: string; computed_status: string }[],
): BillsListCard => ({ status, billingDay, historyBills: dues })

const order = (cards: BillsListCard[]) =>
  [...cards].sort((a, b) => compareBillsListCards(a, b, TODAY))

describe('billsListSortKey', () => {
  it('keeps the three tiers in overdue → unpaid → unissued order', () => {
    const overdue = billsListSortKey(card('overdue', 10, [{ due_date: '2026-08-16', computed_status: 'overdue' }]), TODAY)
    const unpaid = billsListSortKey(card('unpaid', 10, [{ due_date: '2026-09-20', computed_status: 'unpaid' }]), TODAY)
    const unissued = billsListSortKey(card('unissued', 10, []), TODAY)
    expect(overdue.tier).toBe(0)
    expect(unpaid.tier).toBe(1)
    expect(unissued.tier).toBe(2)
  })

  it('uses the due date for overdue/unpaid and the billing day for unissued', () => {
    expect(billsListSortKey(card('unpaid', 25, [{ due_date: '2026-09-20', computed_status: 'unpaid' }]), TODAY).distance).toBe(6)
    // 账单日 25 → 本月 25 日还没到，距今天 11 天
    expect(billsListSortKey(card('unissued', 25, []), TODAY).distance).toBe(11)
  })
})

describe('overdue group: longest overdue first', () => {
  it('sorts by how long the bill has been overdue, descending', () => {
    const cards = [
      card('overdue', 10, [{ due_date: '2026-09-01', computed_status: 'overdue' }]), // 13 天
      card('overdue', 10, [{ due_date: '2026-07-16', computed_status: 'overdue' }]), // 60 天
      card('overdue', 10, [{ due_date: '2026-08-16', computed_status: 'overdue' }]), // 29 天
    ]
    expect(order(cards).map(c => c.historyBills[0].due_date))
      .toEqual(['2026-07-16', '2026-08-16', '2026-09-01'])
  })

  it('uses the most overdue bill when a card has several lapsed bills', () => {
    const cards = [
      card('overdue', 10, [
        { due_date: '2026-09-01', computed_status: 'overdue' },
        { due_date: '2026-07-16', computed_status: 'overdue' },
      ]),
      card('overdue', 10, [{ due_date: '2026-08-16', computed_status: 'overdue' }]),
    ]
    // 第一张按 7 月那期算（60 天），仍排在 29 天之前
    expect(order(cards)[0].historyBills[1].due_date).toBe('2026-07-16')
  })
})

describe('unpaid group: nearest due date first', () => {
  it('sorts by days remaining, ascending', () => {
    const cards = [
      card('unpaid', 10, [{ due_date: '2026-10-20', computed_status: 'unpaid' }]),
      card('unpaid', 10, [{ due_date: '2026-09-16', computed_status: 'unpaid' }]),
      card('unpaid', 10, [{ due_date: '2026-09-25', computed_status: 'unpaid' }]),
    ]
    expect(order(cards).map(c => c.historyBills[0].due_date))
      .toEqual(['2026-09-16', '2026-09-25', '2026-10-20'])
  })

  it('counts a bill due today as the nearest, without calling it overdue', () => {
    const cards = [
      card('unpaid', 10, [{ due_date: '2026-09-20', computed_status: 'unpaid' }]),
      card('unpaid', 10, [{ due_date: '2026-09-14', computed_status: 'unpaid' }]),
    ]
    const sorted = order(cards)
    expect(sorted[0].historyBills[0].due_date).toBe('2026-09-14')
    expect(billsListSortKey(sorted[0], TODAY).tier).toBe(1)
    expect(dueDistanceLabel(billsListSortKey(sorted[0], TODAY).distance)).toBe('今天还款日')
  })

  it('treats partial repayment as the unpaid group', () => {
    const cards = [
      card('partial', 10, [{ due_date: '2026-09-30', computed_status: 'partial' }]),
      card('unpaid', 10, [{ due_date: '2026-09-20', computed_status: 'unpaid' }]),
    ]
    expect(order(cards).map(c => c.status)).toEqual(['unpaid', 'partial'])
  })
})

describe('unissued group: nearest billing day first', () => {
  it('sorts by days until the next billing day, ascending', () => {
    const cards = [
      card('unissued', 28, []), // 14 天后
      card('unissued', 20, []), // 6 天后
      card('unissued', 25, []), // 11 天后
    ]
    expect(order(cards).map(c => c.billingDay)).toEqual([20, 25, 28])
  })

  it('rolls a passed billing day into next month', () => {
    expect(daysUntilNextBilling(10, TODAY)).toBe(26) // 10 日已过 → 10/10
    expect(daysUntilNextBilling(14, TODAY)).toBe(0) // 今天就是账单日
    expect(daysUntilNextBilling(15, TODAY)).toBe(1)
  })

  it('clamps a billing day past the end of the month', () => {
    // 2 月没有 31 日 → 按 2 月最后一天算
    expect(nextBillingDateOf(31, new Date(2026, 1, 5)).getDate()).toBe(28)
    expect(nextBillingDateOf(31, new Date(2028, 1, 5)).getDate()).toBe(29) // 闰年
  })

  it('falls back to day 10 for a missing or invalid billing day', () => {
    expect(nextBillingDateOf(0, new Date(2026, 8, 1)).getDate()).toBe(10)
    expect(nextBillingDateOf(NaN, new Date(2026, 8, 1)).getDate()).toBe(10)
  })
})

describe('the whole list', () => {
  it('emits all three tiers in order, each internally sorted by its own axis', () => {
    const cards = [
      card('unissued', 20, []), // 距账单日 6 天 → 未出账单组第 1
      card('unpaid', 10, [{ due_date: '2026-09-20', computed_status: 'unpaid' }]), // 6 天
      card('overdue', 10, [{ due_date: '2026-08-16', computed_status: 'overdue' }]), // 29 天
      card('unissued', 28, []), // 14 天 → 未出账单组第 2
      card('overdue', 10, [{ due_date: '2026-07-16', computed_status: 'overdue' }]), // 60 天
      card('unpaid', 10, [{ due_date: '2026-11-01', computed_status: 'unpaid' }]), // 48 天
    ]
    const sorted = order(cards)
    expect(sorted.map(c => billsListSortKey(c, TODAY).tier)).toEqual([0, 0, 1, 1, 2, 2])
    expect(sorted.slice(0, 2).map(c => c.historyBills[0].due_date))
      .toEqual(['2026-07-16', '2026-08-16'])
    expect(sorted.slice(2, 4).map(c => c.historyBills[0].due_date))
      .toEqual(['2026-09-20', '2026-11-01'])
    expect(sorted.slice(4).map(c => c.billingDay)).toEqual([20, 28])
  })

  it('keeps the numbers that are on screen non-decreasing within each tier', () => {
    // 卡片上显示的「逾期 X 日 / 距离还款日 X 日」必须与排序同源，
    // 否则用户会看到 2 日、11 日、5 日这种看起来坏掉的顺序。
    const cards = [
      card('unpaid', 10, [{ due_date: '2026-09-25', computed_status: 'unpaid' }]),
      card('unpaid', 10, [{ due_date: '2026-09-16', computed_status: 'unpaid' }]),
      card('unpaid', 10, [{ due_date: '2026-09-19', computed_status: 'unpaid' }]),
    ]
    const distances = order(cards).map(c => billsListSortKey(c, TODAY).distance)
    expect(distances).toEqual([2, 5, 11])
    expect(distances.every((d, i) => i === 0 || distances[i - 1] <= d)).toBe(true)
  })
})
