import { describe, it, expect } from 'vitest'
import { createFakeD1, type FakeDb, type Row } from './fakeD1'
import {
  findOrCreateCardForHolder,
  loadHolderScope,
  pickCardProductForBank,
  keepPaidStatus,
  persistNestedBills,
  upsertBillForCard,
} from '../../lib/email-core/bills'
import type { BillParseResult, NestedBillMessage } from '../../lib/email-core/types'

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

const message = (over: Partial<NestedBillMessage> = {}): NestedBillMessage => ({
  label: 'bill.eml',
  subject: '账单',
  from: 'bill@bank.com',
  to: 'me@x.com',
  date: 'Mon, 17 Aug 2026 09:00:00 +0800',
  text: '尊敬的张改菊女士，您本期账单如下',
  headerName: '张改菊女士',
  bodyName: '张改菊',
  ...over,
})

describe('loadHolderScope', () => {
  it('只读该用户名下的持卡人，默认持卡人取最早创建的那个', async () => {
    const { db } = seed()
    const scope = await loadHolderScope(db, 'u1')
    expect(scope.holders.map(h => h.id)).toEqual(['h1', 'h2'])
    expect(scope.defaultHolderId).toBe('h1')
    // TEXT 列里存的 JSON 字符串被归一化成数组
    expect(scope.holders[0].aliases).toEqual(['张改菊女士'])
  })
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

describe('index.ts 直发路径不变量', () => {
  // 直发路径与附件路径行为必须一致：重发邮件不能把已还清账单打回未还款。
  // 纯函数测不到「某个 SQL 里写死了 'unpaid'」，所以在源码层加不变量。
  it('直发路径复用 upsertBillForCard 落账单（状态保护只此一份，不再内联 SQL）', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '../src/index.ts'), 'utf8')
    expect(src).toContain('await upsertBillForCard(db, cardId, aiResult, { trusted })')
    // 内联 UPDATE bills 曾把非 0 元重发邮件的 paid 状态覆盖回 unpaid，必须保持移除
    expect(src).not.toMatch(/UPDATE bills SET/)
  })

  it('非 statement 邮件（自动扣款通知/还款提醒）在建卡之前就被跳过', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '../src/index.ts'), 'utf8')
    expect(src).toContain("aiResult.email_kind && aiResult.email_kind !== 'statement'")
  })
})

describe('persistNestedBills', () => {
  const parseFrom = (over: Partial<BillParseResult> = {}) => async () => parsedBill(over)

  it('识别出持卡人并写入账单', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const result = await persistNestedBills(db, scope, [message()], parseFrom())
    expect(result.written).toHaveLength(1)
    expect(result.written[0].holderId).toBe('h1')
    expect(result.written[0].matchSource).toBe('header_name')
    expect(tables.bills).toHaveLength(1)
    expect(tables.bills[0].card_id).toBe('c1')
  })

  it('[P0] 名册外的人 + 已存在的同月账单：跳过而不是覆盖', async () => {
    const { db, tables } = seed()
    tables.bills.push({
      id: 'b1', card_id: 'c1', bill_month: '2026-08', bill_amount: 6000,
      min_payment: null, due_date: '2026-09-20', statement_date: '2026-08-16', status: 'unpaid',
    })
    const scope = await loadHolderScope(db, 'u1')
    // To 头与正文都认不出人 -> 回落默认持卡人 h1（= 既有账单那张卡）
    const result = await persistNestedBills(
      db, scope,
      [message({ headerName: '王小明', bodyName: null })],
      parseFrom({ bill_amount: 99999 })
    )
    expect(result.written).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('保留原值')
    expect(tables.bills[0].bill_amount).toBe(6000)
  })

  it('识别出对方是另一个持卡人时正常写入他自己的卡', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const result = await persistNestedBills(
      db, scope,
      [message({ headerName: '高敏', bodyName: '高敏' })],
      parseFrom()
    )
    expect(result.written[0].holderId).toBe('h2')
    expect(tables.bills[0].card_id).toBe('c2')
  })

  it('非账单或字段不全时跳过', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const result = await persistNestedBills(db, scope, [message()], parseFrom({ is_bill: false }))
    expect(result.written).toHaveLength(0)
    expect(result.skipped[0].reason).toContain('非账单')
    expect(tables.bills).toHaveLength(0)
  })

  it('无正文时跳过', async () => {
    const { db } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const result = await persistNestedBills(db, scope, [message({ text: '   ' })], parseFrom())
    expect(result.skipped[0].reason).toContain('无正文')
  })

  it('AI 解析抛错时跳过并保留原因', async () => {
    const { db } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const failing = async () => { throw new Error('boom') }
    const result = await persistNestedBills(db, scope, [message()], failing)
    expect(result.skipped[0].reason).toContain('boom')
  })

  it('匹配不到银行导致建卡失败时跳过并给出原因', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')
    const result = await persistNestedBills(
      db, scope,
      [message({ headerName: '高敏' })],
      parseFrom({ card_last4: '7777', bank_name: 'Chase Bank', currency: 'USD' })
    )
    expect(result.written).toHaveLength(0)
    expect(result.skipped[0].reason).toContain('Chase Bank')
    expect(tables.credit_cards).toHaveLength(2)
  })
})

describe('归属不可信时绝不自动建卡（2026-10-16 民生 0872 回归）', () => {
  it('回落默认持卡人 + 未知尾号：不建卡不写账单，落待确认草稿', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')
    expect(scope.userId).toBe('u1')

    const result = await persistNestedBills(
      db, scope,
      [message({ label: 'minsheng.eml', headerName: null, bodyName: null })],
      async () => parsedBill({ card_last4: '0872', bank_name: '中国民生银行' }),
    )

    expect(result.written).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('待确认草稿')
    // 不建卡、不写账单
    expect(tables.credit_cards.filter((c: Row) => c.card_number_last4 === '0872')).toHaveLength(0)
    expect(tables.bills).toHaveLength(0)
    // 草稿已保存（card_id 为空，等界面选卡确认）
    const drafts = tables.bill_import_drafts ?? []
    expect(drafts).toHaveLength(1)
    expect(drafts[0].card_id).toBeNull()
    expect(drafts[0].created_by).toBe('u1')
  })

  it('归属可信 + 未知尾号：仍然自动建卡（既有行为不回退）', async () => {
    const { db, tables } = seed()
    const scope = await loadHolderScope(db, 'u1')

    const result = await persistNestedBills(
      db, scope,
      [message({ label: 'gm.eml', headerName: '高敏' })],
      async () => parsedBill({ card_last4: '5678', bank_name: '招商银行' }),
    )

    expect(result.written).toHaveLength(1)
    expect(tables.credit_cards.filter((c: Row) => c.card_number_last4 === '5678')).toHaveLength(1)
    expect(tables.bills).toHaveLength(1)
  })
})
