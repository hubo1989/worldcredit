import { describe, it, expect } from 'vitest'
import { createFakeD1, type FakeDb } from './fakeD1'
import {
  BILLING_DAY_GAP_TOLERANCE,
  BILLING_DAY_REFERENCE_GAP,
  deriveBillingDayFromEmail,
  findOrCreateCardForHolder,
  syncBillingDayFromBill,
} from '../src/bills'
import type { BillParseResult } from '../src/types'

/**
 * 账单日三件套的回归（2026-10-20 原文核对的产物）：
 *   1. deriveBillingDayFromEmail —— 证据强度：正文明示 > 出账日 > 50 天启发式；
 *   2. findOrCreateCardForHolder —— 三种证据都缺时绝不写默认值（邮储 0726/2891
 *      的卡档 10 就是「无依据默认 10」的污染），落待确认草稿；
 *   3. syncBillingDayFromBill —— 有客观日期证据互相印证才回写卡档，
 *      解决账单日只在建卡时写一次、之后永远残留旧值的问题。
 */

const PRODUCT = { id: 'p1', bank_name: '招商银行', currency: 'CNY', is_active: 1, created_at: '2026-01-01' }

function seed(): FakeDb {
  return createFakeD1({
    card_holders: [
      { id: 'h1', name: '呼博', aliases: null, created_by: 'u1', created_at: '2026-01-01' },
    ],
    card_products: [PRODUCT],
    credit_cards: [
      { id: 'c1', holder_id: 'h1', card_number_last4: '1234', card_product_id: 'p1', billing_day: 19 },
    ],
    bills: [],
  })
}

describe('deriveBillingDayFromEmail：证据优先级', () => {
  it('正文明示的「账单日 X」最优先（邮储正文「账单日 21」）', () => {
    expect(
      deriveBillingDayFromEmail({ statementDay: 21, statementDate: '2026-06-22', dueDate: null, receivedDate: null })
    ).toBe(21)
  })

  it('其次用本期出账日的「日」（民生 Statement Date 2026-09-22 → 22）', () => {
    expect(deriveBillingDayFromEmail({ statementDate: '2026-09-22' })).toBe(22)
  })

  it('出账日无效时不会掉进默认值', () => {
    expect(deriveBillingDayFromEmail({ statementDate: 'not-a-date' })).toBeNull()
  })
})

describe('deriveBillingDayFromEmail：50 天启发式', () => {
  const received = '2026-09-09T20:00:00+08:00'
  const dayOf = (gap: number) => {
    const due = new Date(new Date(received).getTime() + gap * 86_400_000)
    return deriveBillingDayFromEmail({ dueDate: due.toISOString().slice(0, 10), receivedDate: received })
  }

  it(`间隔恰好在 ${BILLING_DAY_REFERENCE_GAP}±${BILLING_DAY_GAP_TOLERANCE} 内时用收件日期当账单日`, () => {
    // 收件 9/9 → 间隔 50 天时账单日取 9（邮储 0726 正是这种：账单日 09）
    expect(dayOf(50)).toBe(9)
    expect(dayOf(BILLING_DAY_REFERENCE_GAP - BILLING_DAY_GAP_TOLERANCE)).toBe(9)
    expect(dayOf(BILLING_DAY_REFERENCE_GAP + BILLING_DAY_GAP_TOLERANCE)).toBe(9)
  })

  it('偏差超过容差时返回 null，宁留空不猜', () => {
    expect(dayOf(34)).toBeNull()
    expect(dayOf(66)).toBeNull()
    // 大陆卡常见的「出账→还款 20 天」间隔不满足 50 天假设，同样不猜
    expect(dayOf(20)).toBeNull()
  })

  it('缺还款日或收件日期时无法启用启发式', () => {
    expect(deriveBillingDayFromEmail({ receivedDate: received })).toBeNull()
    expect(deriveBillingDayFromEmail({ dueDate: '2026-10-29' })).toBeNull()
    expect(deriveBillingDayFromEmail({})).toBeNull()
  })
})

describe('findOrCreateCardForHolder：无证据不建卡', () => {
  // 收件时间用 +08:00 的 20:00（= UTC 12:00），保证 UTC 与 UTC+8 环境下
  // getDate() 取到同一天，测试不随运行时区漂移
  const received = '2026-09-14T20:00:00+08:00'

  it('启发式落在容差边界（间隔恰 35 天）时正常建卡，账单日取收件日的「日」', async () => {
    const { db, tables } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h1',
      cardTail: '8888',
      statementDate: null,
      statementDay: null,
      dueDate: '2026-10-19',
      receivedDate: received,
      bankName: '招商银行',
      currency: 'CNY',
    })
    expect(r.ok).toBe(true)
    const created = tables.credit_cards.find(c => c.card_number_last4 === '8888')
    expect(created?.billing_day).toBe(14)
  })

  it('三种证据都缺（50 天假设也不成立）时返回 needsDraft，卡表不被污染', async () => {
    const { db, tables } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h1',
      cardTail: '8888',
      statementDate: null,
      statementDay: null,
      dueDate: '2026-10-05', // 距收件约 21 天，50 天假设不成立
      receivedDate: received,
      bankName: '招商银行',
      currency: 'CNY',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.needsDraft).toBe(true)
      expect(r.reason).toContain('账单日')
    }
    expect(tables.credit_cards).toHaveLength(1)
  })
})

describe('syncBillingDayFromBill：卡档账单日回写', () => {
  const parsed = (over: Partial<BillParseResult> = {}): BillParseResult => ({
    is_bill: true,
    bill_month: '2026-09',
    bill_amount: 100,
    due_date: '2026-10-17',
    statement_date: null,
    ...over,
  })

  it('本期出账日的「日」与卡档不符且互相印证时回写（民生 9765：卡档 19，出账 27）', async () => {
    const { db, tables } = seed()
    const updated = await syncBillingDayFromBill(db, 'c1', parsed({ statement_date: '2026-09-27' }))
    expect(updated).toBe(true)
    expect(tables.credit_cards[0].billing_day).toBe(27)
  })

  it('只有正文明示的账单日、没有出账日佐证时不回写（防单证据幻觉，Chase "as of" 类污染）', async () => {
    const { db, tables } = seed()
    const updated = await syncBillingDayFromBill(db, 'c1', parsed({ statement_day: 27, statement_date: null }))
    expect(updated).toBe(false)
    expect(tables.credit_cards[0].billing_day).toBe(19)
  })

  it('明示账单日与上一期出账日一致（连续 2 期相同）时回写', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b0', card_id: 'c1', bill_month: '2026-08', statement_date: '2026-08-27',
      bill_amount: 1, due_date: '2026-09-16', status: 'paid', min_payment: null,
    })
    const updated = await syncBillingDayFromBill(
      db, 'c1', parsed({ statement_day: 27, statement_date: null })
    )
    expect(updated).toBe(true)
    expect(tables.credit_cards[0].billing_day).toBe(27)
  })

  it('卡档已一致时不动数据库', async () => {
    const { db, tables } = seed()
    const updated = await syncBillingDayFromBill(db, 'c1', parsed({ statement_date: '2026-09-19' }))
    expect(updated).toBe(false)
    expect(tables.credit_cards[0].billing_day).toBe(19)
  })

  it('没有任何证据时不回写', async () => {
    const { db, tables } = seed()
    const updated = await syncBillingDayFromBill(db, 'c1', parsed())
    expect(updated).toBe(false)
    expect(tables.credit_cards[0].billing_day).toBe(19)
  })
})
