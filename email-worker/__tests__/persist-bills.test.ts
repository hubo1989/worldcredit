import { describe, it, expect } from 'vitest'
import { createFakeD1, type FakeDb } from './fakeD1'
import {
  findOrCreateCardForHolder,
  pickCardProductForBank,
  keepPaidStatus,
  upsertBillForCard,
} from '../../lib/email-core/bills'
import type { BillParseResult } from '../../lib/email-core/types'

const PRODUCT = { id: 'p1', bank_name: '招商银行', currency: 'CNY', is_active: 1, created_at: '2026-01-01' }

function seed(): FakeDb {
  return createFakeD1({
    card_holders: [
      { id: 'h1', name: '张改菊', aliases: '["张改菊女士"]', created_by: 'u1', created_at: '2026-01-01' },
      { id: 'h2', name: '高敏', aliases: null, created_by: 'u1', created_at: '2026-02-01' },
    ],
    card_products: [PRODUCT],
    credit_cards: [
      { id: 'c1', holder_id: 'h1', card_number_last4: '1234', card_product_id: 'p1' },
      { id: 'c2', holder_id: 'h2', card_number_last4: '1234', card_product_id: 'p1' },
    ],
    bills: [],
  })
}

const parsedBill = (over: Partial<BillParseResult> = {}): BillParseResult => ({
  is_bill: true,
  bank_name: '招商银行',
  card_last4: '1234',
  bill_amount: 6000,
  due_date: '2026-09-20',
  bill_month: '2026-08',
  statement_date: '2026-08-16',
  currency: 'CNY',
  ...over,
})

describe('pickCardProductForBank', () => {
  it('按银行名匹配，优先取币种一致的产品', () => {
    const products = [
      { id: 'cn', bank_name: '汇丰银行', currency: 'CNY' },
      { id: 'hk', bank_name: '汇丰银行', currency: 'HKD' },
    ]
    expect(pickCardProductForBank(products, '汇丰银行', 'HKD')?.id).toBe('hk')
    expect(pickCardProductForBank(products, '汇丰银行', 'CNY')?.id).toBe('cn')
  })

  it('银行名互相包含时也算命中', () => {
    expect(pickCardProductForBank([PRODUCT], '招商银行信用卡中心', null)?.id).toBe('p1')
  })

  it('精确银行名优先于包含匹配（Citibank 与 Citibank HK 是两家）', () => {
    const products = [
      { id: 'us', bank_name: 'Citibank', currency: 'USD' },
      { id: 'hk', bank_name: 'Citibank HK', currency: 'HKD' },
    ]
    expect(pickCardProductForBank(products, 'Citibank', 'USD')?.id).toBe('us')
    expect(pickCardProductForBank(products, 'Citibank HK', 'HKD')?.id).toBe('hk')
  })

  it('匹配不到银行时返回 null，不随便挑一个产品', () => {
    expect(pickCardProductForBank([PRODUCT], 'Chase Bank', 'USD')).toBeNull()
    expect(pickCardProductForBank([PRODUCT], null, 'CNY')).toBeNull()
    expect(pickCardProductForBank([PRODUCT], '   ', 'CNY')).toBeNull()
  })
})

describe('findOrCreateCardForHolder', () => {
  it('在持卡人范围内按尾号命中已有卡', async () => {
    const { db } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h2', cardTail: '1234', statementDate: null, bankName: '招商银行', currency: 'CNY',
    })
    expect(r).toEqual({ ok: true, cardId: 'c2', created: false })
  })

  it('匹配不到银行时不建卡，给出可读原因', async () => {
    const { db, tables } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h1', cardTail: '9999', statementDate: null, bankName: 'Chase Bank', currency: 'USD',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Chase Bank')
    // 关键：没有污染卡片表
    expect(tables.credit_cards).toHaveLength(2)
  })

  it('缺少尾号时不建卡', async () => {
    const { db, tables } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h1', cardTail: null, statementDate: null, bankName: '招商银行', currency: 'CNY',
    })
    expect(r.ok).toBe(false)
    expect(tables.credit_cards).toHaveLength(2)
  })

  it('匹配到银行时按该产品建卡，币种随产品而不是硬编码', async () => {
    const { db, tables } = seed()
    const r = await findOrCreateCardForHolder(db, {
      holderId: 'h1', cardTail: '8888', statementDate: '2026-08-16', bankName: '招商银行', currency: 'CNY',
    })
    expect(r.ok).toBe(true)
    const created = tables.credit_cards.find(c => c.card_number_last4 === '8888')
    expect(created?.card_product_id).toBe('p1')
    expect(created?.holder_id).toBe('h1')
    // 新建卡挂在匹配到的产品上，产品币种是 CNY，不会把外币卡标成 CNY 的问题由此避免
    expect(tables.card_products.find(p => p.id === created?.card_product_id)?.currency).toBe('CNY')
  })
})

describe('upsertBillForCard', () => {
  it('首次写入插入新账单', async () => {
    const { db, tables } = seed()
    const r = await upsertBillForCard(db, 'c1', parsedBill(), { trusted: true })
    expect(r.action).toBe('inserted')
    expect(tables.bills).toHaveLength(1)
    expect(tables.bills[0].status).toBe('unpaid')
  })

  it('[P1] 重发不会把已还清账单降级成未还款', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b1', card_id: 'c1', bill_month: '2026-08', bill_amount: 6000,
      min_payment: null, due_date: '2026-09-20', statement_date: '2026-08-16', status: 'paid',
    })
    const r = await upsertBillForCard(db, 'c1', parsedBill({ bill_amount: 6100 }), { trusted: true })
    expect(r.action).toBe('updated')
    // 金额等字段可以更新，但状态必须保留
    expect(tables.bills[0].status).toBe('paid')
    expect(tables.bills[0].bill_amount).toBe(6100)
  })

  it('[P1] partial 与 overdue 同样不被降级成 unpaid', async () => {
    for (const status of ['partial', 'overdue']) {
      const { db, tables } = seed()
      tables.bills.push({
        id: 'b1', card_id: 'c1', bill_month: '2026-08', bill_amount: 6000,
        min_payment: null, due_date: '2026-09-20', statement_date: null, status,
      })
      await upsertBillForCard(db, 'c1', parsedBill(), { trusted: true })
      expect(tables.bills[0].status).toBe(status)
    }
  })

  it('原本 unpaid 时保持 unpaid', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b1', card_id: 'c1', bill_month: '2026-08', bill_amount: 6000,
      min_payment: null, due_date: '2026-09-20', statement_date: null, status: 'unpaid',
    })
    await upsertBillForCard(db, 'c1', parsedBill(), { trusted: true })
    expect(tables.bills[0].status).toBe('unpaid')
  })

  it('[P0] 归属不可信 + 该月账单已存在时不覆盖', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b1', card_id: 'c1', bill_month: '2026-08', bill_amount: 6000,
      min_payment: null, due_date: '2026-09-20', statement_date: '2026-08-16', status: 'unpaid',
    })
    const r = await upsertBillForCard(db, 'c1', parsedBill({ bill_amount: 99999 }), { trusted: false })
    expect(r.action).toBe('preserved')
    expect(r.reason).toContain('2026-08')
    expect(tables.bills[0].bill_amount).toBe(6000)
    expect(tables.bills).toHaveLength(1)
  })

  it('归属不可信但库里还没有这条账单时仍然插入', async () => {
    const { db, tables } = seed()
    const r = await upsertBillForCard(db, 'c1', parsedBill(), { trusted: false })
    expect(r.action).toBe('inserted')
    expect(tables.bills).toHaveLength(1)
  })

  it('不同月份本来就该是两条独立账单', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b1', card_id: 'c1', bill_month: '2026-07', bill_amount: 5000,
      min_payment: null, due_date: '2026-08-20', statement_date: null, status: 'paid',
    })
    const r = await upsertBillForCard(db, 'c1', parsedBill({ bill_month: '2026-08' }), { trusted: false })
    expect(r.action).toBe('inserted')
    expect(tables.bills).toHaveLength(2)
  })
})

describe('keepPaidStatus（直发与附件路径共用的状态保护）', () => {
  it('保留 paid / partial / overdue', () => {
    expect(keepPaidStatus('paid')).toBe('paid')
    expect(keepPaidStatus('partial')).toBe('partial')
    expect(keepPaidStatus('overdue')).toBe('overdue')
  })

  it('unpaid 与缺失状态回落到 unpaid', () => {
    expect(keepPaidStatus('unpaid')).toBe('unpaid')
    expect(keepPaidStatus(null)).toBe('unpaid')
    expect(keepPaidStatus(undefined)).toBe('unpaid')
    expect(keepPaidStatus('')).toBe('unpaid')
  })
})
