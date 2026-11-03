import {
  NO_BANK_TAG,
  countByTag,
  countEntities,
  countStatuses,
  filterCardsForView,
  filterPayablesForView,
} from '../bills-view-model'
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
  accountModeOverride?: 'multi' | 'single'
}): CardWithBillsSummary {
  return {
    card: { ...card(opts.bank), account_mode_override: opts.accountModeOverride ?? null },
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

  it('account_mode_override 钉住为 single 时，即使同银行两张卡也显示单卡', () => {
    const cards = [
      item({ bank: '招商银行', accountModeOverride: 'single' }),
      item({ bank: '招商银行' }),
    ]
    expect(deriveAccountMode('h1', '招商银行', cards)).toBe('single')
  })

  it('account_mode_override 钉住为 multi 时，单卡也显示多卡一账户', () => {
    const cards = [item({ bank: '招商银行', accountModeOverride: 'multi' })]
    expect(deriveAccountMode('h1', '招商银行', cards)).toBe('multi')
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

describe('filterCardsForView / filterPayablesForView', () => {
  const payable = (
    id: string,
    holderId: string | null,
    status: 'unpaid' | 'paid' | 'overdue',
    bankName: string | null = null
  ) => ({ id, holder_id: holderId, status, bank_name: bankName })

  const rows = [
    payable('rent-me', 'h-me', 'unpaid', '招商银行'),
    payable('loan-me', 'h-me', 'paid', '招商银行'),
    payable('insurance-wang', 'h-wang', 'overdue', null),
    payable('shared', null, 'unpaid', null),
  ]

  const base = {
    entityType: 'all' as const,
    statuses: [] as Array<'unpaid' | 'overdue' | 'unissued' | 'paid'>,
    dimension: 'holder' as const,
    selectedTag: 'all',
  }

  it('默认：返回所有固定支出', () => {
    expect(filterPayablesForView(rows, base).map(p => p.id)).toEqual([
      'rent-me',
      'loan-me',
      'insurance-wang',
      'shared',
    ])
  })

  it('按持卡人筛选', () => {
    expect(
      filterPayablesForView(rows, { ...base, selectedTag: 'h-me' }).map(p => p.id)
    ).toEqual(['rent-me', 'loan-me'])
  })

  it('状态多选为 OR：待还 + 已逾期', () => {
    expect(
      filterPayablesForView(rows, { ...base, statuses: ['unpaid', 'overdue'] }).map(p => p.id)
    ).toEqual(['rent-me', 'insurance-wang', 'shared'])
  })

  it('已付归入「已还款」', () => {
    expect(filterPayablesForView(rows, { ...base, statuses: ['paid'] }).map(p => p.id)).toEqual([
      'loan-me',
    ])
  })

  it('对象类型只看固定支出时，卡片为空', () => {
    const card = {
      holder_id: 'h-me',
      status: 'unpaid' as const,
      card: { card_product: { bank_name: '招商银行' } },
    }
    expect(filterCardsForView([card], { ...base, entityType: 'payables' })).toEqual([])
    expect(filterPayablesForView(rows, { ...base, entityType: 'cards' })).toEqual([])
  })

  it('银行维度按固定支出的银行匹配；非银行单独成桶', () => {
    expect(
      filterPayablesForView(rows, { ...base, dimension: 'bank', selectedTag: '招商银行' }).map(
        p => p.id
      )
    ).toEqual(['rent-me', 'loan-me'])
    expect(
      filterPayablesForView(rows, { ...base, dimension: 'bank', selectedTag: NO_BANK_TAG }).map(
        p => p.id
      )
    ).toEqual(['insurance-wang', 'shared'])
  })

  it('部分还款归入待还（卡状态口径）', () => {
    const card = {
      holder_id: 'h-me',
      status: 'partial' as const,
      card: { card_product: { bank_name: '招商银行' } },
    }
    expect(filterCardsForView([card], { ...base, statuses: ['unpaid'] }).length).toBe(1)
    expect(filterCardsForView([card], { ...base, statuses: ['overdue'] }).length).toBe(0)
  })

  it('计数：对象数与状态数随筛选变化', () => {
    const cards = [
      {
        holder_id: 'h-me',
        status: 'unpaid' as const,
        card: { card_product: { bank_name: '招商银行' } },
      },
      {
        holder_id: 'h-wang',
        status: 'overdue' as const,
        card: { card_product: { bank_name: '工商银行' } },
      },
    ]
    expect(countEntities(cards, rows, base)).toEqual({ cards: 2, payables: 4 })
    expect(countStatuses(cards, rows, base)).toEqual({
      unpaid: 3,
      overdue: 2,
      unissued: 0,
      paid: 1,
    })
    expect(countByTag(cards, rows, base).noBank).toBe(2)
  })
})
