import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { isCmbStatement, parseCmbStatement } from '../email-core/cmb'
import {
  findOrCreateCardForHolder,
  upsertBillForCard,
  syncCreditLimitFromBill,
} from '../email-core/bills'
import { getBillDetail } from '../api/bills.server'
import {
  CMB_SINGLE_CARD_SYNTHETIC,
  CMB_MULTI_CARD_SYNTHETIC,
  CMB_YEAR_ROLLOVER_SYNTHETIC,
} from '../../email-worker/__tests__/fixtures/cmb-synthetic'

let db: SqliteD1

beforeEach(async () => {
  db = createOpportunityDb()
  setDb(db as unknown as D1Database)

  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'test@example.com', 'hash');
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '王小明');

    INSERT INTO banks (id, name, statement_mode, quota_mode)
    VALUES ('b_cmb', '招商银行', 'merged', 'shared');

    INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
    VALUES
      ('cp_cmb_classic', 'b_cmb', '招商银行', '经典白金卡', 'CNY', 'after_billing', 20);
  `)
})

describe('E6 统一账单 Phase 3：招行邮件解析与归并入库 (D1 实库集成)', () => {
  it('单卡合成账单识别、首次入库并建立合并账户与分卡小计', () => {
    // 1. 识别
    const isCmb = isCmbStatement({
      fromEmail: 'bill@cmbchina.com',
      subject: '尊敬的王小明先生，您好！以下是您的个人消费卡账户08月账单',
      text: CMB_SINGLE_CARD_SYNTHETIC,
    })
    expect(isCmb).toBe(true)

    // 2. 解析
    const parsed = parseCmbStatement(CMB_SINGLE_CARD_SYNTHETIC)
    expect(parsed.bill_month).toBe('2026-08')
    expect(parsed.due_date).toBe('2026-09-15')
    expect(parsed.bill_amount).toBe(18888.88)
    expect(parsed.credit_limit).toBe(80000)
    expect(parsed.formula_breakdown).toEqual({
      previous_balance: 2000,
      previous_payment: 2000,
      new_charges: 18888.88,
      adjustment: 0,
      interest: 0,
    })
    expect(parsed.card_subtotals).toHaveLength(1)
    expect(parsed.card_subtotals?.[0].card_last4).toBe('6688')
    expect(parsed.card_subtotals?.[0].amount).toBe(18888.88)
  })

  it('首张卡账单落库：自动创建 credit_account(merged, shared) 与卡片、账单及小计', async () => {
    const parsed = parseCmbStatement(CMB_SINGLE_CARD_SYNTHETIC)

    const d1 = db as unknown as D1Database
    const cardRes = await findOrCreateCardForHolder(d1, {
      holderId: 'h1',
      cardTail: parsed.card_last4 ?? null,
      bankName: parsed.bank_name ?? null,
      currency: parsed.currency ?? null,
      creditLimit: parsed.credit_limit ?? null,
      statementDate: parsed.statement_date ?? null,
      statementDay: parsed.statement_day ?? null,
      dueDate: parsed.due_date,
      receivedDate: '2026-08-01',
      allowCreate: true,
    })

    expect(cardRes.ok).toBe(true)
    if (!cardRes.ok) return

    expect(cardRes.created).toBe(true)
    const cardId = cardRes.cardId

    // 写入统一账单模型
    const billOutcome = await upsertBillForCard(d1, cardId, parsed, { trusted: true })
    expect(billOutcome.action).toBe('inserted')

    // 额度回填
    await syncCreditLimitFromBill(d1, cardId, parsed)

    // 验证 credit_accounts
    const acc = await db
      .prepare('SELECT * FROM credit_accounts WHERE holder_id = ?')
      .bind('h1')
      .first<{
        id: string
        statement_mode: string
        quota_mode: string
        shared_credit_limit: number
        primary_card_id: string
      }>()

    expect(acc).toBeDefined()
    expect(acc?.statement_mode).toBe('merged')
    expect(acc?.quota_mode).toBe('shared')
    expect(acc?.shared_credit_limit).toBe(80000)
    expect(acc?.primary_card_id).toBe(cardId)

    // 验证 bills
    const bill = await db
      .prepare('SELECT * FROM bills WHERE id = ?')
      .bind(billOutcome.billId)
      .first<{
        id: string
        account_id: string
        card_id: string
        bill_amount: number
        due_date: string
        bill_month: string
      }>()

    expect(bill).toBeDefined()
    expect(bill?.account_id).toBe(acc?.id)
    expect(bill?.card_id).toBe(cardId) // 锚点卡
    expect(bill?.bill_amount).toBe(18888.88)
    expect(bill?.due_date).toBe('2026-09-15')
    expect(bill?.bill_month).toBe('2026-08')

    // 验证 bill_card_subtotals
    const subs = (
      await db
        .prepare('SELECT * FROM bill_card_subtotals WHERE bill_id = ?')
        .bind(billOutcome.billId)
        .all<{ card_tail: string; subtotal_amount: number; card_id: string }>()
    ).results

    expect(subs).toHaveLength(1)
    expect(subs[0].card_tail).toBe('6688')
    expect(subs[0].subtotal_amount).toBe(18888.88)
    expect(subs[0].card_id).toBe(cardId)
  })

  it('多卡账单入库与未知尾号处理：未知尾号只展示、不自动建卡，且总额不反向覆写', async () => {
    const d1 = db as unknown as D1Database

    // 先建立已存在卡 6688 并归入招行合并账户
    const initCard = await findOrCreateCardForHolder(d1, {
      holderId: 'h1',
      cardTail: '6688',
      statementDate: null,
      bankName: '招商银行',
      currency: 'CNY',
      creditLimit: 80000,
      dueDate: '2026-09-15',
      receivedDate: '2026-08-01',
      allowCreate: true,
    })
    expect(initCard.ok).toBe(true)
    if (!initCard.ok) return

    // 此时多卡账单到来（包含已知卡 6688 与新未知卡 7799）
    const parsedMulti = parseCmbStatement(CMB_MULTI_CARD_SYNTHETIC)
    expect(parsedMulti.card_subtotals).toHaveLength(2)

    // 路由找卡：由于账户已存在，无论给什么尾号，都对齐到既有合并账户的锚点卡
    const routeRes = await findOrCreateCardForHolder(d1, {
      holderId: 'h1',
      cardTail: parsedMulti.card_last4 ?? null,
      statementDate: null,
      bankName: '招商银行',
      currency: 'CNY',
      dueDate: parsedMulti.due_date,
      receivedDate: '2026-08-01',
      allowCreate: true,
    })
    expect(routeRes.ok).toBe(true)
    if (!routeRes.ok) return
    expect(routeRes.created).toBe(false)
    expect(routeRes.cardId).toBe(initCard.cardId) // 对齐锚点卡

    // 入库
    const billOutcome = await upsertBillForCard(d1, routeRes.cardId, parsedMulti, { trusted: true })
    expect(billOutcome.action).toBe('inserted')

    // 铁律验证 1：未知尾号 7799 绝不自动在 credit_cards 建卡！
    const allCards = (
      await db
        .prepare('SELECT id, card_number_last4 FROM credit_cards WHERE holder_id = ?')
        .bind('h1')
        .all<{ id: string; card_number_last4: string }>()
    ).results
    expect(allCards).toHaveLength(1)
    expect(allCards[0].card_number_last4).toBe('6688')
    expect(allCards.some((c) => c.card_number_last4 === '7799')).toBe(false)

    // 铁律验证 2：未知尾号 7799 在 bill_card_subtotals 中如实呈现（card_id 为 NULL）
    const subs = (
      await db
        .prepare('SELECT card_tail, subtotal_amount, card_id FROM bill_card_subtotals WHERE bill_id = ? ORDER BY card_tail ASC')
        .bind(billOutcome.billId)
        .all<{ card_tail: string; subtotal_amount: number; card_id: string | null }>()
    ).results
    expect(subs).toHaveLength(2)
    expect(subs[0].card_tail).toBe('6688')
    expect(subs[0].subtotal_amount).toBe(15000)
    expect(subs[0].card_id).toBe(initCard.cardId)

    expect(subs[1].card_tail).toBe('7799')
    expect(subs[1].subtotal_amount).toBe(9500)
    expect(subs[1].card_id).toBeNull() // 未知卡只展示，card_id 为 null

    // 铁律验证 3：总额以账单为权威，不反向覆写；未归卡差额通过 getBillDetail 透明呈现
    const detail = await getBillDetail(billOutcome.billId)
    expect(detail.bill.bill_amount).toBe(25000) // 保持权威应还总额
    expect(detail.bill.subtotals).toHaveLength(2)
    // 25,000 - (15,000 + 9,500) = 500
    expect(detail.bill.unallocated_amount).toBe(500)
  })

  it('跨年账单日期推导（12月账单 -> 次年1月还款）', () => {
    const parsed = parseCmbStatement(CMB_YEAR_ROLLOVER_SYNTHETIC)
    expect(parsed.bill_month).toBe('2026-12')
    expect(parsed.due_date).toBe('2027-01-10')
  })

  // 本地真实样本验证
  const realSamplePath = '/tmp/wc-cmb-sample/cmb-statement-2026-08.txt'
  const hasRealSample = fs.existsSync(realSamplePath)

  it.runIf(hasRealSample)('真实招行样本本地入库验证', async () => {
    const content = fs.readFileSync(realSamplePath, 'utf8')
    const parsed = parseCmbStatement(content)

    const d1 = db as unknown as D1Database
    const cardRes = await findOrCreateCardForHolder(d1, {
      holderId: 'h1',
      cardTail: parsed.card_last4 ?? null,
      bankName: parsed.bank_name ?? null,
      currency: parsed.currency ?? null,
      creditLimit: parsed.credit_limit ?? null,
      statementDate: parsed.statement_date ?? null,
      statementDay: parsed.statement_day ?? null,
      dueDate: parsed.due_date,
      receivedDate: '2026-07-28',
      allowCreate: true,
    })

    expect(cardRes.ok).toBe(true)
    if (!cardRes.ok) return

    const billOutcome = await upsertBillForCard(d1, cardRes.cardId, parsed, { trusted: true })
    await syncCreditLimitFromBill(d1, cardRes.cardId, parsed)

    const detail = await getBillDetail(billOutcome.billId)
    // 结构断言：入库结果必须与解析值一致；真实金额/尾号不硬编码进仓库
    expect(detail.bill.bill_month).toBe(parsed.bill_month)
    expect(detail.bill.bill_amount).toBe(parsed.bill_amount)
    expect(detail.bill.min_payment).toBe(parsed.min_payment)
    expect(detail.bill.due_date).toBe(parsed.due_date)
    expect(detail.bill.subtotals).toHaveLength(parsed.card_subtotals?.length ?? 0)
    const firstTail = parsed.card_subtotals?.[0]?.card_last4 ?? parsed.card_last4
    expect(detail.bill.subtotals?.[0]?.card_tail).toBe(firstTail)
    expect(detail.bill.subtotals?.[0]?.subtotal_amount).toBe(parsed.card_subtotals?.[0]?.amount)
    // 单卡样本：小计=账户总额，无未归卡差额
    if ((parsed.card_subtotals?.length ?? 0) === 1) {
      expect(detail.bill.subtotals?.[0]?.subtotal_amount).toBe(parsed.bill_amount)
      expect(detail.bill.unallocated_amount).toBeUndefined()
    }
  })
})
