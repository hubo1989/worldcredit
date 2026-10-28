import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { recordPayment } from '../api/bills.server'

describe('bills.recordPayment: offline sync & idempotent payments', () => {
  let db: ReturnType<typeof createOpportunityDb>

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    // Base data
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp1', 'b1', '招商银行', '经典白', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc1', 'h1', 'cp1', 5);
      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status)
      VALUES ('b_test', 'cc1', '2026-10-01', '2026-10-25', 1000, 'unpaid');
    `)
  })

  it('records full payment and marks bill as paid', async () => {
    const res = await recordPayment({
      id: 'pay_uuid_1',
      bill_id: 'b_test',
      amount: 1000,
      paid_at: '2026-10-20',
      idempotency_key: 'idem_key_1',
    })

    expect(res.payment.id).toBe('pay_uuid_1')
    expect(res.payment.amount).toBe(1000)
    expect(res.bill_status).toBe('paid')
    expect(res.already_processed).toBeUndefined()

    const bill = await db.prepare('SELECT status FROM bills WHERE id = ?').bind('b_test').first<{ status: string }>()
    expect(bill?.status).toBe('paid')

    const syncRows = (
      await db.prepare('SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE row_id = ?').bind('pay_uuid_1').all()
    ).results
    expect(syncRows).toEqual([
      { owner_id: 'u1', tbl: 'payments', row_id: 'pay_uuid_1', op: 'upsert' }
    ])
  })

  it('is idempotent: re-submitting same idempotency_key returns existing payment and does not duplicate', async () => {
    const res1 = await recordPayment({
      id: 'pay_uuid_1',
      bill_id: 'b_test',
      amount: 400,
      idempotency_key: 'idem_key_2',
    })
    expect(res1.bill_status).toBe('partial')

    // Replay with exact same idempotency_key
    const res2 = await recordPayment({
      id: 'pay_uuid_1',
      bill_id: 'b_test',
      amount: 400,
      idempotency_key: 'idem_key_2',
    })

    expect(res2.already_processed).toBe(true)
    expect(res2.payment.id).toBe('pay_uuid_1')

    const count = await db.prepare('SELECT COUNT(*) AS c FROM payments WHERE bill_id = ?').bind('b_test').first<{ c: number }>()
    expect(count?.c).toBe(1)
  })

  it('accumulates partial payments until fully paid', async () => {
    await recordPayment({
      id: 'p1',
      bill_id: 'b_test',
      amount: 400,
      idempotency_key: 'key_p1',
    })

    const res2 = await recordPayment({
      id: 'p2',
      bill_id: 'b_test',
      amount: 600,
      idempotency_key: 'key_p2',
    })

    expect(res2.bill_status).toBe('paid')

    const bill = await db.prepare('SELECT status FROM bills WHERE id = ?').bind('b_test').first<{ status: string }>()
    expect(bill?.status).toBe('paid')

    const syncRows = (
      await db.prepare('SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE row_id = ?').bind('p2').all()
    ).results
    expect(syncRows).toEqual([
      { owner_id: 'u1', tbl: 'payments', row_id: 'p2', op: 'upsert' }
    ])
  })

  it('rejects payment amount exceeding remaining due', async () => {
    await recordPayment({
      id: 'p1',
      bill_id: 'b_test',
      amount: 800,
      idempotency_key: 'key_p1',
    })

    // Remaining is 200, trying to pay 250
    await expect(
      recordPayment({
        id: 'p2',
        bill_id: 'b_test',
        amount: 250,
        idempotency_key: 'key_p2',
      })
    ).rejects.toThrow(/超过剩余应还/)
  })

  it('rejects payment when bill is already paid', async () => {
    await recordPayment({
      id: 'p1',
      bill_id: 'b_test',
      amount: 1000,
      idempotency_key: 'key_p1',
    })

    // Now trying to pay again with a new key
    await expect(
      recordPayment({
        id: 'p2',
        bill_id: 'b_test',
        amount: 100,
        idempotency_key: 'key_p2',
      })
    ).rejects.toThrow(/已结清/)
  })
})
