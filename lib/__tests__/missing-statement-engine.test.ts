import { describe, expect, it } from 'vitest'
import {
  actualStatementDateInMonth,
  addYearMonth,
  computeSuggestedDueDate,
  detectMissingStatements,
  normalizeMissingStatementGraceDays,
  type MissingStatementCardInput,
} from '../missing-statement'

function makeCard(
  overrides: Partial<MissingStatementCardInput['card']> & {
    id: string
    bank_name?: string
    card_name?: string
    currency?: string
    payment_due_type?: 'fixed' | 'after_billing' | 'fixed_before_billing'
    payment_due_value?: number
  },
  account?: MissingStatementCardInput['account'],
): MissingStatementCardInput {
  const {
    bank_name = '招商银行',
    card_name = '经典白',
    currency = 'CNY',
    payment_due_type = 'after_billing',
    payment_due_value = 20,
    ...cardFields
  } = overrides
  return {
    card: {
      holder_id: 'holder-1',
      account_id: account?.id ?? null,
      card_number_last4: '1111',
      billing_day: 10,
      override_billing_day: null,
      override_due_type: null,
      override_due_value: null,
      name_override: null,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
      ...cardFields,
      card_product: {
        bank_name,
        card_name,
        currency,
        payment_due_type,
        payment_due_value,
      },
    },
    account: account ?? null,
  }
}

describe('lib/missing-statement 纯计算引擎', () => {
  it('normalizeMissingStatementGraceDays 正确保留 0 并回落非法值到 3', () => {
    expect(normalizeMissingStatementGraceDays(0)).toBe(0)
    expect(normalizeMissingStatementGraceDays(3)).toBe(3)
    expect(normalizeMissingStatementGraceDays(15)).toBe(15)
    expect(normalizeMissingStatementGraceDays(-1)).toBe(3)
    expect(normalizeMissingStatementGraceDays(16)).toBe(3)
    expect(normalizeMissingStatementGraceDays(3.5)).toBe(3)
    expect(normalizeMissingStatementGraceDays(null)).toBe(3)
    expect(normalizeMissingStatementGraceDays(undefined)).toBe(3)
    expect(normalizeMissingStatementGraceDays('5')).toBe(3)
  })

  it('AC-01: 宽限期边界（daysPast <= graceDays 不触发，> graceDays 触发）', () => {
    const card = makeCard({ id: 'c1', billing_day: 10 })
    const bills = [{ card_id: 'c1', bill_month: '2026-09' }]

    expect(
      detectMissingStatements({ cards: [card], bills, today: '2026-10-10', graceDays: 3 }).items,
    ).toHaveLength(0)
    expect(
      detectMissingStatements({ cards: [card], bills, today: '2026-10-13', graceDays: 3 }).items,
    ).toHaveLength(0)

    const hit = detectMissingStatements({
      cards: [card],
      bills,
      today: '2026-10-14',
      graceDays: 3,
    }).items
    expect(hit).toHaveLength(1)
    expect(hit[0].missingBillMonth).toBe('2026-10')
    expect(hit[0].expectedStatementDate).toBe('2026-10-10')
    expect(hit[0].daysPast).toBe(4)

    // graceDays = 0 时次日立即触发（禁止 0 || 3 退化）
    const hitZeroGrace = detectMissingStatements({
      cards: [card],
      bills,
      today: '2026-10-11',
      graceDays: 0,
    }).items
    expect(hitZeroGrace).toHaveLength(1)
    expect(hitZeroGrace[0].graceDays).toBe(0)
    expect(hitZeroGrace[0].daysPast).toBe(1)
  })

  it('AC-02: override_billing_day 优先与月末 29-31 日收拢（含平年与闰年二月）', () => {
    expect(actualStatementDateInMonth(31, '2026-02')).toBe('2026-02-28')
    expect(actualStatementDateInMonth(31, '2024-02')).toBe('2024-02-29')
    expect(actualStatementDateInMonth(31, '2026-04')).toBe('2026-04-30')

    const card = makeCard({ id: 'c-eom', billing_day: 10, override_billing_day: 31 })
    const bills = [{ card_id: 'c-eom', bill_month: '2026-01' }]

    expect(
      detectMissingStatements({ cards: [card], bills, today: '2026-03-03', graceDays: 3 }).items,
    ).toHaveLength(0)

    const hit = detectMissingStatements({
      cards: [card],
      bills,
      today: '2026-03-04',
      graceDays: 3,
    }).items
    expect(hit).toHaveLength(1)
    expect(hit[0].missingBillMonth).toBe('2026-02')
    expect(hit[0].expectedStatementDate).toBe('2026-02-28')
    expect(hit[0].daysPast).toBe(4)

    // 闰年 2024-02 收拢为 29 日
    const leapHit = detectMissingStatements({
      cards: [card],
      bills: [{ card_id: 'c-eom', bill_month: '2024-01' }],
      today: '2024-03-04',
      graceDays: 3,
    }).items
    expect(leapHit[0].expectedStatementDate).toBe('2024-02-29')
    expect(leapHit[0].daysPast).toBe(4)
  })

  it('AC-03: 跨年自然滚动与多月连续断档锁定首期缺失账期', () => {
    expect(addYearMonth('2026-12', 1)).toBe('2027-01')
    expect(addYearMonth('2026-01', -1)).toBe('2025-12')

    const cDec = makeCard({ id: 'c-dec', billing_day: 10 })
    const hitJan = detectMissingStatements({
      cards: [cDec],
      bills: [{ card_id: 'c-dec', bill_month: '2026-12' }],
      today: '2027-01-14',
      graceDays: 3,
    }).items
    expect(hitJan[0].missingBillMonth).toBe('2027-01')
    expect(hitJan[0].daysPast).toBe(4)

    const cGap = makeCard({ id: 'c-gap', billing_day: 27 })
    const hitGap = detectMissingStatements({
      cards: [cGap],
      bills: [{ card_id: 'c-gap', bill_month: '2026-08' }],
      today: '2026-11-04',
      graceDays: 3,
    }).items
    expect(hitGap[0].missingBillMonth).toBe('2026-09')
    expect(hitGap[0].expectedStatementDate).toBe('2026-09-27')
    expect(hitGap[0].daysPast).toBe(38)
  })

  it('AC-04: 严格排除 frozen / cancelled / loan / archived 账户卡片', () => {
    const archivedAcc = {
      id: 'acc-arch',
      holder_id: 'holder-1',
      bank_name: '工商银行',
      currency: 'CNY',
      statement_mode: 'independent' as const,
      billing_day: 5,
      due_type: 'after_billing' as const,
      due_value: 20,
      primary_card_id: 'c-arch',
      status: 'archived' as const,
    }
    const cards = [
      makeCard({ id: 'c-frozen', billing_day: 5, status: 'frozen' }),
      makeCard({ id: 'c-cancel', billing_day: 5, status: 'cancelled' }),
      makeCard({ id: 'c-loan', billing_day: 5, card_type: 'loan' }),
      makeCard({ id: 'c-arch', billing_day: 5 }, archivedAcc),
    ]
    const bills = cards.map((c) => ({ card_id: c.card.id, bill_month: '2026-09' }))
    const res = detectMissingStatements({ cards, bills, today: '2026-10-20', graceDays: 3 })
    expect(res.items).toHaveLength(0)
  })

  it('AC-05: 从未有过账单的卡按建卡日首个账单日起算且仅提示最近超期周期', () => {
    const cardNew = makeCard({
      id: 'c-new',
      billing_day: 10,
      created_at: '2026-11-25 02:00:00',
    })
    const cardOlder = makeCard({
      id: 'c-older',
      billing_day: 10,
      created_at: '2026-11-05 02:00:00',
    })
    const cardVeryOld = makeCard({
      id: 'c-old',
      billing_day: 10,
      created_at: '2026-03-01 00:00:00',
    })

    const res = detectMissingStatements({
      cards: [cardNew, cardOlder, cardVeryOld],
      bills: [],
      today: '2026-11-25',
      graceDays: 3,
    })

    expect(res.byCarrierCardId.get('c-new')).toBeUndefined()
    const olderHit = res.byCarrierCardId.get('c-older')
    expect(olderHit?.missingBillMonth).toBe('2026-11')
    expect(olderHit?.daysPast).toBe(15)

    // 长期空白卡只定位距今天最近的一个超期账期，不倒追数月
    const veryOldHit = res.byCarrierCardId.get('c-old')
    expect(veryOldHit?.missingBillMonth).toBe('2026-11')
  })

  it('AC-06: 多卡合并账户去重、副卡账单消除及主卡停用顺位回退', () => {
    const mergedAcc = {
      id: 'acc-cmb',
      holder_id: 'holder-1',
      bank_name: '招商银行',
      currency: 'CNY',
      statement_mode: 'merged' as const,
      billing_day: 10,
      due_type: 'after_billing' as const,
      due_value: 20,
      primary_card_id: 'c1',
      status: 'active' as const,
    }
    const c1 = makeCard(
      { id: 'c1', card_number_last4: '1001', billing_day: 10, created_at: '2026-01-01T00:00:00Z' },
      mergedAcc,
    )
    const c2 = makeCard(
      { id: 'c2', card_number_last4: '2002', billing_day: 10, created_at: '2026-01-02T00:00:00Z' },
      mergedAcc,
    )
    const c3 = makeCard(
      { id: 'c3', card_number_last4: '3003', billing_day: 10, created_at: '2026-01-03T00:00:00Z' },
      mergedAcc,
    )

    // 仅 1 条合并账户缺账，挂载在主卡 c1，c2/c3 被抑制
    const res1 = detectMissingStatements({
      cards: [c1, c2, c3],
      bills: [{ card_id: 'c2', account_id: 'acc-cmb', bill_month: '2026-09' }],
      today: '2026-10-14',
      graceDays: 3,
    })
    expect(res1.items).toHaveLength(1)
    expect(res1.items[0].anchorCardId).toBe('c1')
    expect(res1.items[0].isMerged).toBe(true)
    expect(res1.items[0].subject).toContain('合并账单')
    expect(res1.items[0].subject).toContain('等 3 张卡')
    expect(res1.suppressedCardIds.has('c2')).toBe(true)
    expect(res1.suppressedCardIds.has('c3')).toBe(true)

    // 账单挂在副卡且包含 2026-10 后立即消除
    const resCleared = detectMissingStatements({
      cards: [c1, c2, c3],
      bills: [{ card_id: 'c2', bill_month: '2026-10' }],
      today: '2026-10-14',
      graceDays: 3,
    })
    expect(resCleared.items).toHaveLength(0)

    // 主卡 c1 停用后顺位落到历史账单更多的活跃副卡 c3
    const c1Cancelled = makeCard(
      {
        id: 'c1',
        status: 'cancelled',
        card_number_last4: '1001',
        billing_day: 10,
        created_at: '2026-01-01T00:00:00Z',
      },
      mergedAcc,
    )
    const resFallback = detectMissingStatements({
      cards: [c1Cancelled, c2, c3],
      bills: [
        { card_id: 'c3', account_id: 'acc-cmb', bill_month: '2026-09' },
        { card_id: 'c3', account_id: 'acc-cmb', bill_month: '2026-08' },
      ],
      today: '2026-10-14',
      graceDays: 3,
    })
    expect(resFallback.items).toHaveLength(1)
    expect(resFallback.items[0].anchorCardId).toBe('c3')
    expect(resFallback.carrierCardIdByAccountId.get('acc-cmb')).toBe('c3')

    // 全部停用/销卡后产生 0 条
    const resAllCancelled = detectMissingStatements({
      cards: [
        c1Cancelled,
        makeCard({ id: 'c2', status: 'frozen' }, mergedAcc),
        makeCard({ id: 'c3', status: 'cancelled' }, mergedAcc),
      ],
      bills: [{ card_id: 'c3', account_id: 'acc-cmb', bill_month: '2026-09' }],
      today: '2026-10-14',
      graceDays: 3,
    })
    expect(resAllCancelled.items).toHaveLength(0)
  })

  it('草稿箱关联提示与三种还款日推算规则', () => {
    const cAfter = makeCard({
      id: 'c-after',
      billing_day: 10,
      payment_due_type: 'after_billing',
      payment_due_value: 20,
    })
    const cFixed = makeCard({
      id: 'c-fixed',
      billing_day: 20,
      payment_due_type: 'fixed',
      payment_due_value: 31,
    })
    const cFixedBefore = makeCard({
      id: 'c-before',
      billing_day: 25,
      payment_due_type: 'fixed_before_billing',
      payment_due_value: 15,
    })

    expect(computeSuggestedDueDate(cAfter.card, null, '2026-10')).toBe('2026-10-30')
    expect(computeSuggestedDueDate(cFixed.card, null, '2026-01')).toBe('2026-02-28')
    expect(computeSuggestedDueDate(cFixedBefore.card, null, '2026-10')).toBe('2026-10-15')

    const resWithDraft = detectMissingStatements({
      cards: [cAfter],
      bills: [{ card_id: 'c-after', bill_month: '2026-09' }],
      drafts: [
        {
          id: 'draft-pwd',
          card_id: 'c-after',
          bill_month: null,
          parse_status: 'needs_password',
        },
      ],
      today: '2026-10-14',
      graceDays: 3,
    })
    expect(resWithDraft.items).toHaveLength(1)
    expect(resWithDraft.items[0].pendingDraftId).toBe('draft-pwd')
    expect(resWithDraft.items[0].pendingDraftStatus).toBe('needs_password')
  })
})
