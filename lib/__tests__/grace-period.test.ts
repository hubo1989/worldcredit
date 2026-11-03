import { describe, it, expect } from 'vitest'
import { calculateCardGracePeriod } from '../api/bills.server'
import type { CardProduct, CreditCard } from '../types'

/**
 * 「今日刷卡免息期」口径回归（2026-11-02 用户规则）：
 * 今天交易 → 落在下一期账单 → 到该期还款日的天数，最大的卡排最上面。
 *
 * 国内多数银行账单日当天刷卡当天出账：当天交易进当期账单（出得最快、
 * 免息最短），最长免息的第一天是账单日的后一天。三个关键边界：
 *   1. 今天 == 账单日：交易进当期（本月出账），免息只剩账单日→还款日；
 *   2. 今天 == 账单日+1：交易归下一期，免息期最长（选卡刷就挑这一天）；
 *   3. 未结清卡曾退化为「距当前未还账单的还款日」——今天的新交易
 *      进的是下一期，与当前欠款无关（排序层已改，见 bills-list-order）。
 */

const product = (over: Partial<CardProduct> = {}): CardProduct => ({
  id: 'p1',
  bank_name: '招商银行',
  card_name: '经典白',
  country: 'CN',
  currency: 'CNY',
  payment_due_type: 'after_billing',
  payment_due_value: 20,
  is_active: true,
  created_at: '2026-01-01',
  ...over,
})

const card = (over: Partial<CreditCard> = {}, productOver: Partial<CardProduct> = {}): CreditCard & { card_product: CardProduct } => ({
  id: 'c1',
  holder_id: 'h1',
  card_product_id: 'p1',
  credit_limit: 50000,
  billing_day: 27,
  status: 'active',
  card_type: 'credit',
  created_at: '2026-01-01',
  card_product: product(productOver),
  ...over,
})

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('calculateCardGracePeriod：今天交易 → 下一期账单 → 该期还款日', () => {
  it('账单日未到：今天交易进本期账单，免息到本期还款日（账单日 27，今天 10-20）', () => {
    const r = calculateCardGracePeriod(card(), new Date(2026, 9, 20))
    expect(iso(r.nextBillingDate)).toBe('2026-10-27')
    expect(iso(r.nextDueDate)).toBe('2026-11-16') // 10-27 + 20 天
    expect(r.graceDays).toBe(27)
  })

  it('账单日已过：今天交易进下期账单（账单日 9，今天 10-20 → 11-09 出账）', () => {
    const r = calculateCardGracePeriod(card({ billing_day: 9 }), new Date(2026, 9, 20))
    expect(iso(r.nextBillingDate)).toBe('2026-11-09')
    expect(iso(r.nextDueDate)).toBe('2026-11-29')
    expect(r.graceDays).toBe(40)
  })

  it('[边界] 今天正好是账单日：当天交易进当期账单（当天刷卡当天出账），免息最短', () => {
    const r = calculateCardGracePeriod(card(), new Date(2026, 9, 27))
    expect(iso(r.nextBillingDate)).toBe('2026-10-27')
    expect(iso(r.nextDueDate)).toBe('2026-11-16')
    expect(r.graceDays).toBe(20) // 账单日当天出账：只剩账单日→还款日这一段
  })

  it('[边界] 账单日后一天：交易归下一期，免息期最长（新口径最长免息日）', () => {
    const r = calculateCardGracePeriod(card(), new Date(2026, 9, 28))
    expect(iso(r.nextBillingDate)).toBe('2026-11-27')
    expect(iso(r.nextDueDate)).toBe('2026-12-17')
    expect(r.graceDays).toBe(50)
  })

  it('账单日大于当月天数时按月末算（账单日 31，2 月）', () => {
    const r = calculateCardGracePeriod(card({ billing_day: 31 }), new Date(2026, 1, 10))
    expect(iso(r.nextBillingDate)).toBe('2026-02-28')
    expect(iso(r.nextDueDate)).toBe('2026-03-20')
  })

  it('fixed 还款日规则（产品级）：还款日固定在下月 16 日', () => {
    const r = calculateCardGracePeriod(
      card({}, { payment_due_type: 'fixed', payment_due_value: 16 }),
      new Date(2026, 9, 20),
    )
    expect(iso(r.nextBillingDate)).toBe('2026-10-27')
    expect(iso(r.nextDueDate)).toBe('2026-11-16')
    expect(r.graceDays).toBe(27)
  })

  it('贷款卡：免息期口径为距下一还款日', () => {
    const r = calculateCardGracePeriod(
      card({ card_type: 'loan', loan_due_day: 15 }),
      new Date(2026, 9, 20),
    )
    expect(iso(r.nextDueDate)).toBe('2026-11-15')
    expect(r.graceDays).toBe(26)
  })
})
