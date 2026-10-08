import { describe, expect, it } from 'vitest'
import {
  amountToneClass,
  badgeToneClass,
  billBadgeView,
  deriveAccountMode,
} from '../bills-view-model'
import type { CardWithBillsSummary } from '../api/bills'

function card(bank: string): CardWithBillsSummary['card'] {
  return {
    id: 'card-' + bank,
    holder_id: 'h1',
    card_product_id: 'p1',
    card_number_last4: '0000',
    credit_limit: 0,
    billing_day: 1,
    status: 'active',
    card_type: 'credit',
    created_at: '',
    card_product: { bank_name: bank, currency: 'CNY' },
  } as unknown as CardWithBillsSummary['card']
}

function item(opts: {
  bank: string
  holderId?: string
  status?: CardWithBillsSummary['status']
  unpaidAmount?: number
  historyCount?: number
}): CardWithBillsSummary {
  return {
    card: card(opts.bank),
    holder_id: opts.holderId ?? 'h1',
    status: opts.status ?? ('unpaid' as const),
    activeBill: null,
    unpaidAmount: opts.unpaidAmount ?? 1000,
    graceDays: 10,
    billingDay: 1,
    nextDueDate: new Date('2026-10-10'),
    historyBills: Array.from({ length: opts.historyCount ?? 1 }, () => ({})),
  } as unknown as CardWithBillsSummary
}

describe('deriveAccountMode', () => {
  it('同一持卡人同一家银行多张卡 → 多卡一账户', () => {
    const cards = [item({ bank: '中国建设银行' }), item({ bank: '中国建设银行' })]
    expect(deriveAccountMode('h1', '中国建设银行', cards)).toBe('multi')
  })

  it('同一持卡人单张卡 → 单卡单账户', () => {
    const cards = [item({ bank: '汇丰银行' })]
    expect(deriveAccountMode('h1', '汇丰银行', cards)).toBe('single')
  })

  it('同银行但跨持卡人 → 各自 single', () => {
    const cards = [item({ bank: '交通银行' }), item({ bank: '交通银行', holderId: 'h2' })]
    expect(deriveAccountMode('h1', '交通银行', cards)).toBe('single')
    expect(deriveAccountMode('h2', '交通银行', cards)).toBe('single')
  })

  it('银行名缺失时按空串匹配，不抛错', () => {
    const cards = [item({ bank: '' })]
    expect(deriveAccountMode('h1', '', cards)).toBe('single')
  })
})

describe('billBadgeView', () => {
  it('逾期 → danger 徽章', () => {
    expect(billBadgeView(item({ bank: 'A', status: 'overdue' }))).toEqual({
      text: '逾期',
      tone: 'danger',
    })
  })

  it('部分还款 → warn 徽章', () => {
    expect(billBadgeView(item({ bank: 'A', status: 'partial' })).tone).toBe('warn')
  })

  it('待还款 → warn 徽章', () => {
    expect(billBadgeView(item({ bank: 'A', status: 'unpaid' }))).toEqual({
      text: '待还款',
      tone: 'warn',
    })
  })

  it('有历史账单且结清 → 本期已结清 success', () => {
    expect(
      billBadgeView(item({ bank: 'A', status: 'unissued', unpaidAmount: 0 }))
    ).toEqual({ text: '本期已结清', tone: 'success' })
  })

  it('无历史账单且结清 → 未出账单 success', () => {
    expect(
      billBadgeView(item({ bank: 'A', status: 'unissued', unpaidAmount: 0, historyCount: 0 }))
    ).toEqual({ text: '未出账单', tone: 'success' })
  })
})

describe('badgeToneClass / amountToneClass', () => {
  it('三种 tone 都映射到 soft 底 + ink 文字', () => {
    expect(badgeToneClass('danger')).toBe('bg-d-danger-soft text-d-danger-ink')
    expect(badgeToneClass('warn')).toBe('bg-d-gold-soft text-d-warn-ink')
    expect(badgeToneClass('success')).toBe('bg-d-success-soft text-d-success-ink')
  })

  it('金额色：逾期红 / 部分还款金 / 结清 muted / 其余主文字', () => {
    expect(amountToneClass(item({ bank: 'A', status: 'overdue' }))).toBe('text-d-danger-ink')
    expect(amountToneClass(item({ bank: 'A', status: 'partial' }))).toBe('text-d-gold')
    expect(amountToneClass(item({ bank: 'A', status: 'unissued', unpaidAmount: 0 }))).toBe(
      'text-d-muted'
    )
    expect(amountToneClass(item({ bank: 'A', status: 'unpaid' }))).toBe('text-d-text')
  })
})
