import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import {
  getBillDashboardItems,
  getCardsWithBillsSummary,
  markAllOverdueBillsAsPaid,
  markBillAsPaid,
} from '../api/bills.server'
import { getAnalyticsSummary } from '../api/analytics.server'
import { RpcDomainError } from '../api/errors'
import { clearFxCache } from '../fx'

describe('bills & analytics: Cloudflare D1 100-bind limit and batch conflict handling', () => {
  let db: SqliteD1

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)
    await clearFxCache()

    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('bank1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
      VALUES ('cp1', 'bank1', '招商银行', '经典白', 'CNY', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
    `)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await clearFxCache()
    db.close()
  })

  async function seed110Bills() {
    // 11 cards × 10 months = 110 bills (> D1 100-param limit)
    for (let c = 1; c <= 11; c++) {
      const cardId = `cc_${c}`
      const accId = `acc_i_${cardId}`
      await db
        .prepare(
          `INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode)
           VALUES (?, 'h1', 'bank1', '招商银行', 'CNY', 'independent', 'independent')`
        )
        .bind(accId)
        .run()
      await db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status)
           VALUES (?, 'h1', ?, 'cp1', ?, 10, 'active')`
        )
        .bind(cardId, accId, String(1000 + c))
        .run()

      for (let m = 1; m <= 10; m++) {
        const billIndex = (c - 1) * 10 + m
        const billMonth = `2025-${String(m).padStart(2, '0')}`
        if (billIndex === 1) {
          // 复现生产异常：先按原金额 44660.61 全额还款，之后账单被覆写为 7376.45 且 status='unpaid'
          await db
            .prepare(
              `INSERT INTO bills (id, account_id, card_id, bill_month, statement_date, bill_amount, due_date, status)
               VALUES ('bill_settled_stale', ?, ?, '2026-09', '2026-08-25', 44660.61, '2026-09-15', 'unpaid')`
            )
            .bind(accId, cardId)
            .run()
          await db
            .prepare(
              `INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key)
               VALUES ('pay_stale_1', 'bill_settled_stale', 44660.61, '2026-09-14', '快捷全额结清', '历史还款', 'idem_stale_1')`
            )
            .run()
          await db
            .prepare(`UPDATE bills SET bill_amount = 7376.45, status = 'unpaid' WHERE id = 'bill_settled_stale'`)
            .run()
        } else if (billIndex === 2) {
          // 唯一一笔真正未还且已逾期的账单
          await db
            .prepare(
              `INSERT INTO bills (id, account_id, card_id, bill_month, statement_date, bill_amount, due_date, status)
               VALUES ('bill_real_overdue', ?, ?, '2026-08', '2026-08-01', 500, '2026-08-20', 'unpaid')`
            )
            .bind(accId, cardId)
            .run()
        } else {
          const billId = `bill_${billIndex}`
          await db
            .prepare(
              `INSERT INTO bills (id, account_id, card_id, bill_month, statement_date, bill_amount, due_date, status)
               VALUES (?, ?, ?, ?, '2099-12-01', 100, '2099-12-20', 'unpaid')`
            )
            .bind(billId, accId, cardId, billMonth)
            .run()
          await db
            .prepare(
              `INSERT INTO payments (id, bill_id, amount, paid_at, channel, idempotency_key)
               VALUES (?, ?, 100, '2026-10-01', '手动还款', ?)`
            )
            .bind(`pay_${billIndex}`, billId, `idem_${billIndex}`)
            .run()
          await db
            .prepare(`UPDATE bills SET status = 'paid' WHERE id = ?`)
            .bind(billId)
            .run()
        }
      }
    }
  }

  it('handles 110 bills without exceeding D1 100-param limit and settles only truly overdue bills', async () => {
    await seed110Bills()

    const items = await getBillDashboardItems(300, 'u1')
    expect(items).toHaveLength(110)

    const stale = items.find(b => b.id === 'bill_settled_stale')
    expect(stale).toBeDefined()
    expect(stale?.paid_amount).toBe(44660.61)
    expect(stale?.remaining_amount).toBe(0)
    expect(stale?.computed_status).toBe('paid')

    const realOverdue = items.find(b => b.id === 'bill_real_overdue')
    expect(realOverdue).toBeDefined()
    expect(realOverdue?.paid_amount).toBe(0)
    expect(realOverdue?.remaining_amount).toBe(500)
    expect(realOverdue?.computed_status).toBe('overdue')

    const summaries = await getCardsWithBillsSummary('u1')
    expect(summaries).toHaveLength(11)
    const totalUnpaid = summaries.reduce((sum, s) => sum + s.unpaidAmount, 0)
    expect(totalUnpaid).toBe(500)

    const paidResult = await markAllOverdueBillsAsPaid('u1')
    expect(paidResult).toEqual({ count: 1, totalAmount: 500 })

    const updatedOverdue = await db
      .prepare('SELECT status FROM bills WHERE id = ?')
      .bind('bill_real_overdue')
      .first<{ status: string }>()
    expect(updatedOverdue?.status).toBe('paid')

    const stalePayments = await db
      .prepare('SELECT COUNT(*) AS cnt FROM payments WHERE bill_id = ?')
      .bind('bill_settled_stale')
      .first<{ cnt: number }>()
    expect(stalePayments?.cnt).toBe(1)
  })

  it('throws instead of silently returning paid_amount=0 when payments query fails', async () => {
    await seed110Bills()

    const realDb = db as unknown as D1Database
    const failingDb: D1Database = {
      ...realDb,
      prepare(sql: string) {
        if (sql.includes('FROM payments WHERE bill_id IN')) {
          throw new Error('simulated payments query failure')
        }
        return realDb.prepare(sql)
      },
      batch: realDb.batch.bind(realDb),
    } as unknown as D1Database
    setDb(failingDb)

    await expect(getBillDashboardItems(300, 'u1')).rejects.toThrow(/simulated payments query failure/)
  })

  it('maps D1 overpayment trigger errors in markAllOverdueBillsAsPaid and markBillAsPaid to 409 CONFLICT', async () => {
    await db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode)
      VALUES ('acc_race', 'h1', 'bank1', '招商银行', 'CNY', 'independent', 'independent');
      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status)
      VALUES ('cc_race', 'h1', 'acc_race', 'cp1', '9999', 10, 'active');
      INSERT INTO bills (id, account_id, card_id, bill_month, statement_date, bill_amount, due_date, status)
      VALUES ('bill_race', 'acc_race', 'cc_race', '2026-09', '2026-09-01', 500, '2026-09-20', 'unpaid');
    `)

    const realDb = db as unknown as D1Database
    let racingPaymentInserted = false
    const racingDb: D1Database = {
      ...realDb,
      prepare: realDb.prepare.bind(realDb),
      async batch(statements: D1PreparedStatement[]) {
        if (!racingPaymentInserted) {
          racingPaymentInserted = true
          // 在查询余额之后、batch 写入之前模拟并发写入一笔全额还款，触发 trg_payments_guard_overpay
          await db
            .prepare(
              `INSERT INTO payments (id, bill_id, amount, paid_at, channel, idempotency_key)
               VALUES ('pay_concurrent', 'bill_race', 500, '2026-10-01', '手动还款', 'idem_concurrent')`
            )
            .run()
        }
        return realDb.batch(statements)
      },
    } as unknown as D1Database
    setDb(racingDb)

    let caughtBatchErr: unknown
    try {
      await markAllOverdueBillsAsPaid('u1')
    } catch (err) {
      caughtBatchErr = err
    }
    expect(caughtBatchErr).toBeInstanceOf(RpcDomainError)
    expect((caughtBatchErr as RpcDomainError).code).toBe('CONFLICT')
    expect((caughtBatchErr as RpcDomainError).status).toBe(409)

    // 再测试 markBillAsPaid 遇到局部并发还款触发 PAYMENT_EXCEEDS_REMAINING 时同样映射为 409 CONFLICT
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, statement_date, bill_amount, due_date, status)
      VALUES ('bill_race_2', 'acc_race', 'cc_race', '2026-08', '2026-08-01', 500, '2026-08-20', 'unpaid');
    `)
    let partialRaceInserted = false
    const racingSingleDb: D1Database = {
      ...realDb,
      prepare: realDb.prepare.bind(realDb),
      async batch(statements: D1PreparedStatement[]) {
        if (!partialRaceInserted) {
          partialRaceInserted = true
          await db
            .prepare(
              `INSERT INTO payments (id, bill_id, amount, paid_at, channel, idempotency_key)
               VALUES ('pay_concurrent_2', 'bill_race_2', 200, '2026-10-01', '手动还款', 'idem_concurrent_2')`
            )
            .run()
        }
        return realDb.batch(statements)
      },
    } as unknown as D1Database
    setDb(racingSingleDb)

    let caughtSingleErr: unknown
    try {
      await markBillAsPaid('bill_race_2', 500)
    } catch (err) {
      caughtSingleErr = err
    }
    expect(caughtSingleErr).toBeInstanceOf(RpcDomainError)
    expect((caughtSingleErr as RpcDomainError).code).toBe('CONFLICT')
    expect((caughtSingleErr as RpcDomainError).status).toBe(409)
  })

  it('runs getAnalyticsSummary across 110 bills without exceeding D1 100-param limit', async () => {
    await seed110Bills()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ rates: { CNY: 1 } }), { status: 200 }))
    )

    const summary = await getAnalyticsSummary({ holder_id: 'h1', display_currency: 'CNY' })
    // 7376.45 + 500 + 108 * 100 = 18676.45
    expect(summary.total_bill_amount).toBeCloseTo(18676.45, 2)
    // 44660.61 + 108 * 100 = 55460.61
    expect(summary.paid_amount).toBeCloseTo(55460.61, 2)
  })
})
