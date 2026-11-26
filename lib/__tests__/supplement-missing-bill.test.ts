import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import {
  clearOverride,
  getBillByCardMonth,
  getBillDetail,
  getCardsWithBillsSummary,
  supplementMissingBill,
} from '../api/bills.server'
import { dispatchRpc } from '../api/rpc-dispatch'
import { upsertBillForCard } from '../email-core/bills'
import { ingestStatementEmail } from '../email-core/ingest'
import { buildDuplicateBillPreview, confirmBillImportDraft } from '../api/billDrafts.server'
import { getBillItems } from '../api/billItems.server'

function makeMemoryBucket() {
  const objects = new Map<string, Uint8Array>()
  return {
    objects,
    async put(key: string, value: ArrayBuffer | Uint8Array | string) {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value)
      objects.set(key, bytes)
      return { key }
    },
  } as unknown as R2Bucket & { objects: Map<string, Uint8Array> }
}

describe('bills.supplementMissingBill 与迟到邮件防重融合', () => {
  let db: SqliteD1

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    await db.batch([
      db
        .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
        .bind('u-admin', 'admin@test.local', 'h', '管理员', 'admin'),
      db
        .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
        .bind('u-member', 'member@test.local', 'h', '成员', 'member'),
      db
        .prepare(
          `INSERT INTO card_holders (id, created_by, managed_by, auth_user_id, name) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('h-admin', 'u-admin', 'u-admin', null, '主卡人'),
      db
        .prepare(
          `INSERT INTO card_holders (id, created_by, managed_by, auth_user_id, name) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('h-member', 'u-admin', 'u-admin', 'u-member', '成员卡人'),
      db
        .prepare(`INSERT INTO banks (id, name, statement_mode, quota_mode) VALUES (?, ?, ?, ?)`)
        .bind('bank-cmb', '招商银行', 'merged', 'shared'),
      db
        .prepare(
          `INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind('prod-cmb', 'bank-cmb', '招商银行', '经典白', 'CNY', 'after_billing', 20),
      db
        .prepare(
          `INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, billing_day, due_type, due_value, primary_card_id, status)
           VALUES (?, ?, ?, ?, ?, 'merged', 'shared', 5, 'after_billing', 20, NULL, 'active')`,
        )
        .bind('acc-cmb', 'h-admin', 'bank-cmb', '招商银行', 'CNY'),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'credit', ?)`,
        )
        .bind('c-cmb-1', 'h-admin', 'acc-cmb', 'prod-cmb', '1001', 5, '2025-01-01T00:00:00Z'),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'credit', ?)`,
        )
        .bind('c-cmb-2', 'h-admin', 'acc-cmb', 'prod-cmb', '2002', 5, '2025-01-02T00:00:00Z'),
      db
        .prepare(`UPDATE credit_accounts SET primary_card_id = 'c-cmb-1' WHERE id = 'acc-cmb'`),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', 'credit', ?)`,
        )
        .bind('c-ind', 'h-admin', 'prod-cmb', '3003', 5, '2025-01-01T00:00:00Z'),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', 'credit', ?)`,
        )
        .bind('c-mem', 'h-member', 'prod-cmb', '4004', 5, '2025-01-01T00:00:00Z'),
    ])
  })

  afterEach(() => {
    setDb(null)
    db.close()
  })

  it('AC-08: 正常补录与 0 元零账单写 bill_amount_override 且立即消除超期状态', async () => {
    // 1) 正常补录（不钉住默认推算日期）
    const res = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-ind',
      bill_month: '2026-10',
      bill_amount: 1280.5,
      min_payment: 128.05,
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
      pin_min_payment: true,
    })
    expect(res.action).toBe('created')
    expect(res.is_zero_bill).toBe(false)
    expect(res.payment_created).toBe(false)
    expect(res.bill.bill_amount_override).toBe(1280.5)
    expect(res.bill.min_payment_override).toBe(128.05)
    expect(res.bill.due_date_override).toBeUndefined()
    expect(res.bill.statement_date_override).toBeUndefined()

    // 2) 一键确认 0 元零账单：status=paid，不写 payments 行
    const zero = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-ind',
      bill_month: '2026-11',
      bill_amount: 0,
      due_date: '2026-11-25',
      statement_date: '2026-11-05',
    })
    expect(zero.action).toBe('created')
    expect(zero.is_zero_bill).toBe(true)
    expect(zero.payment_created).toBe(false)
    expect(zero.bill.status).toBe('paid')
    expect(zero.bill.bill_amount_override).toBe(0)

    const pmtCount = await db
      .prepare('SELECT COUNT(*) AS cnt FROM payments WHERE bill_id = ?')
      .bind(zero.bill.id)
      .first<{ cnt: number }>()
    expect(Number(pmtCount?.cnt ?? 0)).toBe(0)

    const summary = await getCardsWithBillsSummary('u-admin')
    const indSummary = summary.find((s) => s.card.id === 'c-ind')
    expect(indSummary?.missingStatement).toBeNull()
  })

  it('AC-09: 补录过期历史账单勾选 mark_as_paid 遵守 0022 触发器 3 步顺序原子结清', async () => {
    const res = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-ind',
      bill_month: '2026-09',
      bill_amount: 500,
      due_date: '2026-09-25',
      statement_date: '2026-09-05',
      mark_as_paid: true,
    })
    expect(res.action).toBe('created')
    expect(res.payment_created).toBe(true)
    expect(res.bill.status).toBe('paid')

    const detail = await getBillDetail(res.bill.id)
    expect(detail.payments).toHaveLength(1)
    expect(detail.payments[0].amount).toBe(500)
    expect(detail.payments[0].channel).toBe('手动补录结清')
  })

  it('AC-06: 从合并账户副卡补录统一归属 primary_card_id 与 account_id 并跨卡查重', async () => {
    const clientUuid = '11111111-2222-4333-8444-555555555555'
    const res = await supplementMissingBill({
      id: clientUuid,
      user_id: 'u-admin',
      card_id: 'c-cmb-2',
      bill_month: '2026-10',
      bill_amount: 888,
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
    })
    expect(res.bill.id).toBe(clientUuid)
    expect(res.bill.card_id).toBe('c-cmb-1')
    expect(res.bill.account_id).toBe('acc-cmb')

    // 同 UUID 离线重放幂等
    const replay = await supplementMissingBill({
      id: clientUuid,
      user_id: 'u-admin',
      card_id: 'c-cmb-2',
      bill_month: '2026-10',
      bill_amount: 888,
      due_date: '2026-10-25',
    })
    expect(replay.action).toBe('replayed')

    // 通过副卡或主卡查重均命中同一账单
    const bySub = await getBillByCardMonth('c-cmb-2', '2026-10')
    expect(bySub?.id).toBe(clientUuid)
    const preview = await buildDuplicateBillPreview('c-cmb-2', '2026-10')
    expect(preview?.bill_id).toBe(clientUuid)

    // 再从主卡补录同月返回 409 CONFLICT
    await expect(
      supplementMissingBill({
        user_id: 'u-admin',
        card_id: 'c-cmb-1',
        bill_month: '2026-10',
        bill_amount: 999,
        due_date: '2026-10-25',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('AC-12: 迟到邮件金额一致时静默更新基础列、补齐明细与附件（按 sha256 去重）且不产生草稿', async () => {
    const manual = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-cmb-1',
      bill_month: '2026-10',
      bill_amount: 1280.5,
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
      pin_due_date: true,
    })

    const d1 = db as unknown as D1Database

    const outcome = await upsertBillForCard(
      d1,
      'c-cmb-2',
      {
        is_bill: true,
        bank_name: '招商银行',
        card_last4: '2002',
        currency: 'CNY',
        bill_month: '2026-10',
        bill_amount: 1280.5,
        min_payment: 130,
        statement_date: '2026-10-05',
        due_date: '2026-10-26',
        due_date_status: 'exact',
      },
      {
        trusted: true,
        protectExisting: true,
        newStatementItems: {
          billId: 'mail_bill_late_1',
          items: [
            { transaction_date: '2026-10-01', description: '盒马鲜生', amount: 280.5 },
            { transaction_date: '2026-10-03', description: '京东商城', amount: 1000 },
          ],
        },
      },
    )
    expect(outcome.action).toBe('updated')
    expect(outcome.billId).toBe(manual.bill.id)

    const billRow = await db
      .prepare('SELECT bill_amount, bill_amount_override, due_date, due_date_override, min_payment FROM bills WHERE id = ?')
      .bind(manual.bill.id)
      .first<{
        bill_amount: number
        bill_amount_override: number | null
        due_date: string
        due_date_override: string | null
        min_payment: number | null
      }>()
    expect(billRow?.bill_amount).toBe(1280.5)
    expect(billRow?.bill_amount_override).toBe(1280.5)
    expect(billRow?.due_date).toBe('2026-10-26')
    // 钉住的 due_date_override 保持 2026-10-25 不被覆盖
    expect(billRow?.due_date_override).toBe('2026-10-25')
    expect(billRow?.min_payment).toBe(130)

    const items = await getBillItems(manual.bill.id)
    expect(items).toHaveLength(2)

    // 0 元零账单遇到迟到 0 元官方邮件同样静默融合、保留 paid 状态
    const zeroManual = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-ind',
      bill_month: '2026-10',
      bill_amount: 0,
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
    })
    const zeroOutcome = await upsertBillForCard(
      d1,
      'c-ind',
      {
        is_bill: true,
        bank_name: '招商银行',
        card_last4: '3003',
        currency: 'CNY',
        bill_month: '2026-10',
        bill_amount: 0,
        min_payment: 0,
        statement_date: '2026-10-05',
        due_date: '2026-10-25',
        due_date_status: 'exact',
      },
      { trusted: true, protectExisting: true },
    )
    expect(zeroOutcome.action).toBe('updated')
    expect(zeroOutcome.billId).toBe(zeroManual.bill.id)

    // 纯文本直达 ingestStatementEmail 静默融合（不产生草稿）
    const bucket = makeMemoryBucket()
    const textIngest = await ingestStatementEmail({
      db: d1,
      userId: 'u-admin',
      bucket,
      deliveryId: 'deliv-text-match',
      top: {
        headers: {
          from: 'bill@cmbchina.com',
          to: '主卡人 <bills@20160325.xyz>',
          subject: '招行10月账单',
          date: '2026-10-08',
          charset: 'utf-8',
          contentType: 'text/plain',
          encoding: 'utf-8',
        },
        text: '尊敬的主卡人，招商银行尾号2002 2026-10账单应还1280.50元',
        attachments: [],
      },
      parseText: async () => ({
        is_bill: true,
        email_kind: 'statement',
        confidence: 0.96,
        bank_name: '招商银行',
        card_last4: '2002',
        currency: 'CNY',
        bill_month: '2026-10',
        bill_amount: 1280.5,
        min_payment: 130,
        statement_date: '2026-10-05',
        due_date: '2026-10-26',
        due_date_status: 'exact',
      }),
    })
    expect(textIngest.billIds).toEqual([manual.bill.id])
    expect(textIngest.draftIds).toEqual([])
  })

  it('AC-13: 迟到邮件金额冲突时保护 0 元/手填账单，停入草稿箱并在撤销覆盖后回落导入值', async () => {
    const zero = await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-ind',
      bill_month: '2026-10',
      bill_amount: 0,
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
    })

    const d1 = db as unknown as D1Database
    const conflictIngest = await ingestStatementEmail({
      db: d1,
      userId: 'u-admin',
      deliveryId: 'deliv-conflict',
      top: {
        headers: {
          from: 'bill@cmbchina.com',
          to: '主卡人 <bills@20160325.xyz>',
          subject: '招行10月账单',
          date: '2026-10-09',
          charset: 'utf-8',
          contentType: 'text/plain',
          encoding: 'utf-8',
        },
        text: '尊敬的主卡人，尾号3003 2026-10账单应还1280.50元',
        attachments: [],
      },
      parseText: async () => ({
        is_bill: true,
        email_kind: 'statement',
        confidence: 0.96,
        bank_name: '招商银行',
        card_last4: '3003',
        currency: 'CNY',
        bill_month: '2026-10',
        bill_amount: 1280.5,
        min_payment: 128,
        statement_date: '2026-10-05',
        due_date: '2026-10-25',
        due_date_status: 'exact',
      }),
    })

    expect(conflictIngest.billIds).toEqual([])
    expect(conflictIngest.draftIds).toHaveLength(1)

    // 原 0 元账单完全受保护
    const afterRow = await db
      .prepare('SELECT bill_amount, bill_amount_override, status FROM bills WHERE id = ?')
      .bind(zero.bill.id)
      .first<{ bill_amount: number; bill_amount_override: number | null; status: string }>()
    expect(afterRow?.bill_amount_override).toBe(0)
    expect(afterRow?.status).toBe('paid')

    // 管理员确认合并草稿（保留手填 0 元，更新导入基线 1280.5），再撤销手填后回落为 1280.5 unpaid
    await confirmBillImportDraft(conflictIngest.draftIds[0], { conflict_resolution: 'merge_update' }, 'u-admin')
    const mergedRow = await db
      .prepare('SELECT bill_amount, bill_amount_override, status FROM bills WHERE id = ?')
      .bind(zero.bill.id)
      .first<{ bill_amount: number; bill_amount_override: number | null; status: string }>()
    expect(mergedRow?.bill_amount).toBe(1280.5)
    expect(mergedRow?.bill_amount_override).toBe(0)
    expect(mergedRow?.status).toBe('paid')

    const cleared = await clearOverride(zero.bill.id, ['amount'])
    expect(cleared.bill_amount_override).toBeUndefined()
    expect(cleared.bill_amount).toBe(1280.5)
  })

  it('AC-14: 成员权限隔离（越权补录他人卡返回 403，本人卡正常通过）', async () => {
    const memberSession = {
      id: 'u-member',
      email: 'member@test.local',
      name: '成员',
      role: 'member' as const,
      created_at: '2026-01-01T00:00:00Z',
    }

    const denied = await dispatchRpc(
      'bills',
      'supplementMissingBill',
      [
        {
          card_id: 'c-ind',
          bill_month: '2026-10',
          bill_amount: 100,
          due_date: '2026-10-25',
        },
      ],
      memberSession,
    )
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)

    const allowed = await dispatchRpc(
      'bills',
      'supplementMissingBill',
      [
        {
          card_id: 'c-mem',
          bill_month: '2026-10',
          bill_amount: 0,
          due_date: '2026-10-25',
        },
      ],
      memberSession,
    )
    expect(allowed.ok).toBe(true)
    expect(allowed.status).toBe(200)
  })
})
