import { describe, it, expect } from 'vitest'
import {
  compareBillsListCards,
  compareBillsListCardsByMode,
  compareUnifiedBills,
  payableToSortCard,
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
  extra: { graceDays?: number; nextDueDate?: Date | string } = {},
): BillsListCard => ({
  status,
  billingDay,
  graceDays: extra.graceDays ?? 0,
  nextDueDate: extra.nextDueDate ?? '2026-10-10',
  historyBills: dues,
})

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


describe('BILL-02 sort modes: compareBillsListCardsByMode', () => {
  it('max_interest_free puts the card with the longest interest-free days first (within tier)', () => {
    const short = card('unissued', 5, [], { graceDays: 12, nextDueDate: '2026-09-20' })
    const long = card('unissued', 25, [], { graceDays: 48, nextDueDate: '2026-11-01' })
    const mid = card('unissued', 15, [], { graceDays: 30, nextDueDate: '2026-10-14' })
    const sorted = [short, long, mid].sort((a, b) => compareBillsListCardsByMode(a, b, 'max_interest_free', TODAY))
    expect(sorted.map(c => c.graceDays)).toEqual([48, 30, 12])
  })

  it('[口径] 未结清卡按「今天交易→下一期还款日」排，不按当前未还账单的还款日', () => {
    // 今天 09-14：unpaid 卡当前账单 09-20 到期（只剩 6 天），但今天刷卡进的是
    // 下一期（11-01 还款，48 天）；unissued 卡下一期 10-14 还款（30 天）。
    // 旧口径把 unpaid 按 6 天排最后——今天的新交易与那张已出账的账单无关。
    const unpaid = card('unpaid', 5, [{ due_date: '2026-09-20', computed_status: 'unpaid' }], {
      graceDays: 48,
      nextDueDate: '2026-11-01',
    })
    const unissued = card('unissued', 15, [], { graceDays: 30, nextDueDate: '2026-10-14' })
    const sorted = [unissued, unpaid].sort((a, b) => compareBillsListCardsByMode(a, b, 'max_interest_free', TODAY))
    expect(sorted[0].status).toBe('unpaid')
    expect(sorted[1].status).toBe('unissued')
  })

  it('[口径] max_interest_free 不分组：免息长的未结清卡排在免息短的待还款卡前面', () => {
    // 2026-10-20 用户回归：51 天的未出账单卡曾被「逾期→待还→未出账单」
    // 分组压到第 5 位，前面是 41/39 天的待还款卡。该模式回答「现在刷哪张卡」，
    // 免息最长必须排最前，分组只在 nearest_due / nearest_billing 生效。
    const longest = card('unissued', 27, [], { graceDays: 51, nextDueDate: '2026-12-04' })
    const unpaid41 = card('unpaid', 22, [{ due_date: '2026-10-14', computed_status: 'unpaid' }], {
      graceDays: 41, nextDueDate: '2026-10-25',
    })
    const unpaid39 = card('unpaid', 9, [{ due_date: '2026-10-12', computed_status: 'unpaid' }], {
      graceDays: 39, nextDueDate: '2026-10-23',
    })
    const sorted = [unpaid41, unpaid39, longest].sort((a, b) =>
      compareBillsListCardsByMode(a, b, 'max_interest_free', TODAY)
    )
    expect(sorted).toEqual([longest, unpaid41, unpaid39])
  })

  it('nearest_billing orders by days until next billing date ascending', () => {
    const far = card('unissued', 28, [])
    const near = card('unissued', 16, []) // 2 天后出账
    const mid = card('unissued', 20, [])
    const sorted = [far, near, mid].sort((a, b) => compareBillsListCardsByMode(a, b, 'nearest_billing', TODAY))
    expect(sorted.map(c => c.billingDay)).toEqual([16, 20, 28])
  })

  it('nearest_due keeps the original urgency ordering (default mode)', () => {
    const far = card('unpaid', 5, [{ due_date: '2026-10-30', computed_status: 'unpaid' }])
    const near = card('unpaid', 5, [{ due_date: '2026-09-16', computed_status: 'unpaid' }])
    const sorted = [far, near].sort((a, b) => compareBillsListCardsByMode(a, b, 'nearest_due', TODAY))
    expect(sorted[0].historyBills[0].due_date).toBe('2026-09-16')
  })
})


describe('unified sorting: payables mixed with credit cards', () => {
  it('maps payable statuses into the card urgency groups', () => {
    const paid = payableToSortCard({ status: 'paid', due_date: '2026-09-02', days_until_due: -12, due_day: 2 })
    const overdue = payableToSortCard({ status: 'overdue', due_date: '2026-09-02', days_until_due: -12, due_day: 2 })
    const unpaid = payableToSortCard({ status: 'unpaid', due_date: '2026-09-20', days_until_due: 6, due_day: 20 })
    expect(paid.status).toBe('unissued')
    expect(overdue.status).toBe('overdue')
    expect(unpaid.status).toBe('unpaid')
  })

  it('overdue payable sits above unpaid cards; paid payable sinks to the cleared group', () => {
    const overdueLoan = payableToSortCard({ status: 'overdue', due_date: '2026-09-02', days_until_due: -12, due_day: 2 })
    const unpaidCard = card('unpaid', 5, [{ due_date: '2026-09-20', computed_status: 'unpaid' }])
    const paidLoan = payableToSortCard({ status: 'paid', due_date: '2026-09-02', days_until_due: -12, due_day: 2 })
    const unissuedCard = card('unissued', 25, [])

    const sorted = [unissuedCard, unpaidCard, paidLoan, overdueLoan].sort((a, b) =>
      compareUnifiedBills(a, b, 'nearest_due', TODAY)
    )
    expect(sorted.map(c => c.status)).toEqual(['overdue', 'unpaid', 'unissued', 'unissued'])
    // 逾期贷款第一，两个已结清的殿后
    expect(sorted[0].payableSource).toBe(true)
  })

  it('nearest_due interleaves an unpaid payable between cards by days-until-due', () => {
    const cardDueTomorrow = card('unpaid', 5, [{ due_date: '2026-09-15', computed_status: 'unpaid' }])
    const cardDueNextWeek = card('unpaid', 5, [{ due_date: '2026-09-21', computed_status: 'unpaid' }])
    const loanDueIn3d = payableToSortCard({ status: 'unpaid', due_date: '2026-09-17', days_until_due: 3, due_day: 17 })
    const sorted = [cardDueNextWeek, loanDueIn3d, cardDueTomorrow].sort((a, b) =>
      compareUnifiedBills(a, b, 'nearest_due', TODAY)
    )
    expect(sorted.map(c => (c.payableSource ? 'loan' : 'card'))).toEqual(['card', 'loan', 'card'])
  })

  it('max_interest_free keeps payables in their tier but after regular cards', () => {
    const paidLoan = payableToSortCard({ status: 'paid', due_date: '2026-09-02', days_until_due: -12, due_day: 2 })
    const longFreeCard = card('unissued', 25, [], { graceDays: 48, nextDueDate: '2026-11-01' })
    const sorted = [paidLoan, longFreeCard].sort((a, b) =>
      compareUnifiedBills(a, b, 'max_interest_free', TODAY)
    )
    expect(sorted[0].payableSource).toBeUndefined() // 普通卡在前
  })
})


describe('regression: max_interest_free must differ from nearest_due', () => {
  it('orders two unpaid cards differently under the two modes', () => {
    // 两张未结清卡：当前未还账单 dueSoon 更近，但下一期还款日 dueFar 更远。
    // nearest_due 看当前欠款压力（近的在前）；max_interest_free 看今天刷卡
    // 的理论免息期（下一期还款日远的在前）——两个轴本来就不同。
    const dueSoon = card('unpaid', 5, [{ due_date: '2026-09-16', computed_status: 'unpaid' }], {
      nextDueDate: '2026-10-20',
    })
    const dueFar = card('unpaid', 5, [{ due_date: '2026-10-10', computed_status: 'unpaid' }], {
      nextDueDate: '2026-11-20',
    })
    const byDue = [dueFar, dueSoon].sort((a, b) =>
      compareUnifiedBills(a, b, 'nearest_due', TODAY)
    )
    const byFree = [dueSoon, dueFar].sort((a, b) =>
      compareUnifiedBills(a, b, 'max_interest_free', TODAY)
    )
    // nearest_due：当前还款日近的在前；max_interest_free：下一期还款日远的在前
    expect(byDue[0]).toBe(dueSoon)
    expect(byFree[0]).toBe(dueFar)
  })
})
