// lib/__tests__/legacy-ledger-consolidation.test.ts — /gmail-ledger 单轨收口（AC-09）。
//
// 锁三件事：
//   1) 旧写入口 markPayment / updateLedgerAmount 已封板 → 409 CONFLICT；
//   2) migrateLegacyLedgerToDrafts 把未关联条目幂等转入草稿箱，噪音条目被跳过；
//   3) legacy_ledger 草稿确认入账时继承历史还款（payments + matched_bill_id）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { ensureHub156Schema } from './helpers/hub156-schema'
import { setDb, setWorkerEnv } from '../db/client'
import { RpcDomainError } from '../api/errors'
import {
  migrateLegacyLedgerToDrafts,
  markPayment,
  updateLedgerAmount,
} from '../api/gmail-ledger.server'
import { confirmBillImportDraft, getBillImportDrafts } from '../api/billDrafts.server'
import { syncGmailLedgerToCardsAndBills } from '../api/sync-gmail.server'

let db: SqliteD1

beforeEach(async () => {
  db = createOpportunityDb()
  ensureHub156Schema(db)
  setDb(db as unknown as D1Database)
  setWorkerEnv({ SESSION_SECRET: 'legacy-ledger-secret' })
  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
    INSERT INTO banks (id, name) VALUES ('b_cmb', '招商银行');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
    VALUES ('cp_cmb', 'b_cmb', '招商银行', '招行经典白金', 'after_billing', 20);
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
    INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day)
    VALUES ('cc_8888', 'h1', 'cp_cmb', '8888', 15);
  `)
})

afterEach(() => {
  setDb(null)
  setWorkerEnv({})
  db.close()
})

function insertLedger(id: string, overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    ledger_id: `led_${id}`,
    bank: '招商银行',
    account_tail: '8888',
    statement_amount: 1000,
    minimum_payment: 100,
    due_date: '2026-12-05',
    statement_date: '2026-11-05',
    paid_amount: 0,
    payment_status: '未还款',
    created_by: 'u1',
    matched_card_id: 'cc_8888',
    ...overrides,
  }
  const keys = Object.keys(row)
  const values = keys.map(key => {
    const value = row[key]
    return typeof value === 'string' ? `'${String(value).replace(/'/g, "''")}'` : String(value)
  })
  db.raw.exec(`INSERT INTO gmail_ledger_entries (${keys.join(',')}) VALUES (${values.join(',')})`)
}

describe('旧写入口封板', () => {
  beforeEach(() => {
    insertLedger('e1')
  })

  it('markPayment 抛 409 CONFLICT 且不写库', async () => {
    let caught: unknown
    try {
      await markPayment('led_e1', { paid_amount: 500, payment_status: '部分还款' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RpcDomainError)
    expect((caught as RpcDomainError).status).toBe(409)
    expect((caught as RpcDomainError).details.reason).toBe('LEGACY_LEDGER_SEALED')
    const row = await db.raw
      .prepare("SELECT paid_amount, payment_status FROM gmail_ledger_entries WHERE id = 'e1'")
      .get() as { paid_amount: number; payment_status: string }
    expect(Number(row.paid_amount)).toBe(0)
    expect(row.payment_status).toBe('未还款')
  })

  it('updateLedgerAmount 抛 409 CONFLICT 且不写库', async () => {
    await expect(updateLedgerAmount('led_e1', { statement_amount: 2000 })).rejects.toThrow(
      /已收口至统一草稿箱/,
    )
    const row = await db.raw
      .prepare("SELECT statement_amount FROM gmail_ledger_entries WHERE id = 'e1'")
      .get() as { statement_amount: number }
    expect(Number(row.statement_amount)).toBe(1000)
  })
})

describe('migrateLegacyLedgerToDrafts', () => {
  it('未关联条目转入草稿箱并回写迁移标记', async () => {
    insertLedger('e1')
    const result = await migrateLegacyLedgerToDrafts('u1')
    expect(result.migrated).toBe(1)
    const drafts = await getBillImportDrafts('u1')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_type).toBe('legacy_ledger')
    expect(drafts[0].parsed_payload.bill_amount).toBe(1000)
    expect(drafts[0].parsed_payload.legacy_ledger?.ledger_id).toBe('led_e1')
    const row = await db.raw
      .prepare("SELECT migration_status, migrated_draft_id FROM gmail_ledger_entries WHERE id = 'e1'")
      .get() as { migration_status: string; migrated_draft_id: string }
    expect(row.migration_status).toBe('migrated_to_draft')
    expect(row.migrated_draft_id).toBe(drafts[0].id)
  })

  it('已关联正式账单的条目不重复生成草稿', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b1', 'cc_8888', '2026-11', 1000, '2026-12-05', 'paid');
    `)
    insertLedger('e1', { matched_bill_id: 'b1' })
    const result = await migrateLegacyLedgerToDrafts('u1')
    expect(result.migrated).toBe(0)
    expect(await getBillImportDrafts('u1')).toHaveLength(0)
  })

  it('溢缴款 / 贷方余额 / 无账期附属卡明细被跳过', async () => {
    insertLedger('overpay', { is_overpayment: 1 })
    insertLedger('credit', { amount_direction: 'credit' })
    insertLedger('subcard', { due_date: null, statement_date: null })
    insertLedger('manual', { due_date: null, statement_date: null, manually_priced: 1 })
    const result = await migrateLegacyLedgerToDrafts('u1')
    // 只有 manual（人工补录）值得进草稿箱
    expect(result.migrated).toBe(1)
    const drafts = await getBillImportDrafts('u1')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].parsed_payload.legacy_ledger?.ledger_id).toBe('led_manual')
    const skipped = await db.raw
      .prepare("SELECT id FROM gmail_ledger_entries WHERE migration_status = 'skipped_noise' ORDER BY id")
      .all() as Array<{ id: string }>
    expect(skipped.map(row => row.id)).toEqual(['credit', 'overpay', 'subcard'])
  })

  it('同卡同期同金额重复记录只保留已还最高的一条', async () => {
    insertLedger('a', { paid_amount: 0 })
    insertLedger('b', { paid_amount: 300 })
    insertLedger('c', { paid_amount: 100 })
    const result = await migrateLegacyLedgerToDrafts('u1')
    expect(result.migrated).toBe(1)
    const drafts = await getBillImportDrafts('u1')
    expect(drafts[0].parsed_payload.legacy_ledger?.ledger_id).toBe('led_b')
  })

  it('重复调用幂等：第二次不再新增草稿', async () => {
    insertLedger('e1')
    const first = await migrateLegacyLedgerToDrafts('u1')
    const second = await migrateLegacyLedgerToDrafts('u1')
    expect(first.migrated).toBe(1)
    expect(second.migrated).toBe(0)
    const rows = await db.raw
      .prepare('SELECT COUNT(*) AS n FROM bill_import_drafts')
      .get() as { n: number }
    expect(Number(rows.n)).toBe(1)
  })

  it('无金额条目也进草稿箱并带补录告警', async () => {
    insertLedger('zero', { statement_amount: 0, due_date: null, statement_date: null })
    await migrateLegacyLedgerToDrafts('u1')
    const drafts = await getBillImportDrafts('u1')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].parsed_payload.bill_amount).toBeNull()
    expect(drafts[0].parsed_payload.warnings?.join('')).toContain('无金额')
  })
})

describe('legacy_ledger 草稿确认入账继承历史还款', () => {
  it('确认后补写 payments、重算状态、回填 matched_bill_id', async () => {
    insertLedger('e1', { paid_amount: 400, payment_status: '部分还款', payment_date: '2026-11-10' })
    await migrateLegacyLedgerToDrafts('u1')
    const draft = (await getBillImportDrafts('u1'))[0]

    const bill = await confirmBillImportDraft(draft.id, undefined, 'u1')
    expect(bill.status).toBe('partial')

    const payments = await db.raw
      .prepare('SELECT amount, idempotency_key FROM payments WHERE bill_id = ?')
      .all(bill.id) as Array<{ amount: number; idempotency_key: string }>
    expect(payments).toHaveLength(1)
    expect(Number(payments[0].amount)).toBe(400)
    expect(payments[0].idempotency_key).toBe('legacy_ledger_pay:led_e1')

    const ledger = await db.raw
      .prepare("SELECT matched_bill_id FROM gmail_ledger_entries WHERE id = 'e1'")
      .get() as { matched_bill_id: string }
    expect(ledger.matched_bill_id).toBe(bill.id)
  })

  it('历史已还清的草稿确认后账单状态为 paid', async () => {
    insertLedger('e1', { paid_amount: 1000, payment_status: '已还清' })
    await migrateLegacyLedgerToDrafts('u1')
    const draft = (await getBillImportDrafts('u1'))[0]
    const bill = await confirmBillImportDraft(draft.id, undefined, 'u1')
    expect(bill.status).toBe('paid')
  })
})

describe('sync-gmail 安全桥接', () => {
  it('不再自动建卡或直写 bills，只把历史条目迁进草稿箱', async () => {
    insertLedger('e1')
    const result = await syncGmailLedgerToCardsAndBills('u1')
    expect(result.syncedCardsCount).toBe(0)
    expect(result.syncedBillsCount).toBe(0)
    expect(result.migratedDrafts).toBe(1)
    const bills = await db.raw.prepare('SELECT COUNT(*) AS n FROM bills').get() as { n: number }
    expect(Number(bills.n)).toBe(0)
    const cards = await db.raw.prepare('SELECT COUNT(*) AS n FROM credit_cards').get() as { n: number }
    expect(Number(cards.n)).toBe(1) // 只有 beforeEach 里那张卡
  })

  it('缺少用户 ID 时拒绝全局同步', async () => {
    await expect(syncGmailLedgerToCardsAndBills()).rejects.toThrow(/当前用户 ID/)
  })
})
