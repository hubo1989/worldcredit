import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSqliteD1, SQLITE_D1_MIGRATIONS_DIR, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb, setWorkerEnv } from '../db/client'
import { createSessionValue, type SessionUser } from '../session'
import { createBill, createPayment, getBillDetail } from '../api/bills.server'
import { confirmBillImportDraft, createBillImportDraft } from '../api/billDrafts.server'
import { batchImportBillItems, getBillItems } from '../api/billItems.server'
import { dispatchRpc } from '../api/rpc-dispatch'
import { POST as pull } from '../../app/api/sync/pull/route'

const migrations = readdirSync(SQLITE_D1_MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort()
const direction3 = migrations.filter(name => /^004[0-2]_/.test(name))
const filesBefore = migrations.filter(name => name < '0040')
const a: SessionUser = { id: 'ownerA', email: 'a@example.com', name: null, role: 'member', created_at: '' }
const b: SessionUser = { id: 'ownerB', email: 'b@example.com', name: null, role: 'member', created_at: '' }

let db: SqliteD1

function apply(names: string[]) {
  for (const name of names) db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, name), 'utf8'))
}

beforeEach(() => {
  db = createSqliteD1()
  setDb(db as unknown as D1Database)
  setWorkerEnv({ SESSION_SECRET: 'test-secret-at-least-16-chars' })
  apply(filesBefore)
  db.exec(
    "INSERT INTO users (id, email, password_hash) VALUES ('ownerA', 'a@example.com', 'hash'), ('ownerB', 'b@example.com', 'hash');" +
    "INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES " +
    "('holderA', 'ownerA', 'ownerA', 'A', 'ownerA'), ('holderB', 'ownerB', 'ownerB', 'B', 'ownerB');" +
    "INSERT INTO banks (id, name) VALUES ('bank', 'Example Bank');" +
    "INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value) " +
    "VALUES ('product', 'bank', 'Example Bank', 'Example Card', 'USD', 'after_billing', 20);" +
    "INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day) VALUES " +
    "('cardA', 'holderA', 'product', '1234', 5), ('cardB', 'holderB', 'product', '5678', 5);" +
    "INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date) VALUES " +
    "('billA', 'cardA', '2026-10', 100, '2026-10-15'), ('billB', 'cardB', '2026-11', 100, '2026-11-15');",
  )
})

afterEach(() => db.close())

async function changes(table: string, rowId: string) {
  return (await db.prepare('SELECT owner_id, op FROM sync_changes WHERE tbl = ? AND row_id = ? ORDER BY seq')
    .bind(table, rowId).all()).results
}

function addPlan(id: string, cardId: string, sourceItemId: string | null = null) {
  return db.prepare(
    "INSERT INTO installment_plans (id, card_id, source_item_id, title, currency, principal_amount, total_periods, start_month, due_day) " +
    "VALUES (?, ?, ?, 'plan', 'USD', 100, 2, '2026-11', 15)",
  ).bind(id, cardId, sourceItemId).run()
}

function payment(id: string, fields: readonly (string | number | null)[]) {
  return db.prepare(
    'INSERT INTO payments (id, bill_id, amount, idempotency_key, settled_currency, settled_amount, locked_fx_rate) ' +
    "VALUES (?, 'billA', 1, ?, ?, ?, ?)",
  ).bind(id, id, ...fields).run()
}

async function sync(session: SessionUser, cursor = 0, reconcile?: Array<{ tbl: string; row_id: string }>) {
  const token = await createSessionValue(session)
  const response = await pull(new Request('https://app.all-bill.com/api/sync/pull', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ cursor, reconcile }),
  }))
  expect(response.status).toBe(200)
  return await response.json() as {
    cursor: number
    changes: Array<{ tbl: string; row_id: string; op: 'delete' | 'upsert'; row?: Record<string, unknown> }>
  }
}

describe('direction 3 migrations and offline changes', () => {
  it('migrates existing rows, backfills an advanced sync cursor and leaves old payments readable', async () => {
    db.exec(
      "INSERT INTO bill_items (id, bill_id, card_id, card_tail, description, amount, item_type, category, source) " +
      "VALUES ('old', 'billA', 'cardA', '1234', 'refund', -30, 'refund', 'old taxonomy', 'legacy');" +
      "INSERT INTO payments (id, bill_id, amount, idempotency_key) VALUES ('legacy', 'billA', 20, 'legacy');",
    )
    const previous = await sync(a)
    apply(direction3)
    expect((await getBillItems('billA'))[0]).toMatchObject({
      id: 'old', card_id: 'cardA', card_tail: '1234', amount: 30, item_type: 'refund',
      category: null, source: 'manual',
    })
    expect(await db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] })
    const delta = await sync(a, previous.cursor)
    expect(delta.changes).toMatchObject([{ tbl: 'bill_items', row_id: 'old', op: 'upsert' }])
    const detail = await getBillDetail('billA')
    expect(detail.bill.bill_amount).toBe(100)
    expect(detail.payments[0]).toMatchObject({
      amount: 20, settled_currency: null, settled_amount: null, locked_fx_rate: null,
    })
  })

  it('enforces signed amounts, standard categories and valid installment fields', async () => {
    apply(direction3)
    const insert = (type: string, amount: number, category: string | null) =>
      db.prepare("INSERT INTO bill_items (id, bill_id, description, item_type, amount, category) VALUES ('i', 'billA', 'demo', ?, ?, ?)")
        .bind(type, amount, category).run()
    await expect(insert('purchase', -1, null)).rejects.toThrow(/CHECK/)
    await expect(insert('refund', -1, null)).rejects.toThrow(/CHECK/)
    await expect(insert('adjustment', -1, 'unknown')).rejects.toThrow(/CHECK/)
    await insert('adjustment', -1, null)
    await addPlan('plan', 'cardA', 'i')
    await expect(db.prepare("UPDATE installment_plans SET paid_periods = 3 WHERE id = 'plan'").run()).rejects.toThrow(/CHECK/)
    await expect(db.prepare("UPDATE installment_plans SET due_month_offset = 2 WHERE id = 'plan'").run()).rejects.toThrow(/CHECK/)
    await expect(db.prepare("UPDATE installment_plans SET billing_mode = 'invalid' WHERE id = 'plan'").run()).rejects.toThrow(/CHECK/)
    await db.prepare("DELETE FROM bill_items WHERE id = 'i'").run()
    expect(await db.prepare("SELECT source_item_id FROM installment_plans WHERE id = 'plan'").first()).toEqual({ source_item_id: null })
    expect((await changes('installment_plans', 'plan')).at(-1)).toEqual({ owner_id: 'ownerA', op: 'upsert' })
  })

  it('rejects every partial FX lock and allows backfill and clearing after full repayment', async () => {
    apply(direction3)
    for (const mask of [1, 2, 3, 4, 5, 6]) {
      const fields = ['CNY', 7, 7].map((value, index) => mask & (1 << index) ? value : null)
      await expect(payment('partial-' + mask, fields)).rejects.toThrow(/PAYMENT_FX_LOCK_INCOMPLETE/)
    }
    await payment('locked', ['CNY', 7, 7])
    await db.prepare("INSERT INTO payments (id, bill_id, amount, idempotency_key) VALUES ('p', 'billA', 99, 'p')").run()
    await expect(db.prepare("UPDATE payments SET settled_currency = 'CNY' WHERE id = 'p'").run())
      .rejects.toThrow(/PAYMENT_FX_LOCK_INCOMPLETE/)
    await db.prepare("UPDATE payments SET settled_currency = 'CNY', settled_amount = 693, locked_fx_rate = 7 WHERE id = 'p'").run()
    await expect(db.prepare("UPDATE payments SET amount = 100 WHERE id = 'p'").run()).rejects.toThrow(/PAYMENT_EXCEEDS_REMAINING/)
    await db.prepare("UPDATE payments SET settled_currency = NULL, settled_amount = NULL, locked_fx_rate = NULL WHERE id = 'p'").run()
    expect(await db.prepare("SELECT amount, settled_currency FROM payments WHERE id = 'p'").first()).toEqual({ amount: 99, settled_currency: null })
  })

  it('publishes owner-scoped rows, scope changes and cascade tombstones', async () => {
    apply(direction3)
    db.exec(
      "INSERT INTO bill_items (id, bill_id, description) VALUES ('i', 'billA', 'test');" +
      "INSERT INTO merchant_category_rules (id, user_id, normalized_merchant, display_merchant, category) " +
      "VALUES ('rule', 'ownerA', 'test', 'Test', 'other');",
    )
    await addPlan('plan', 'cardA', 'i')
    const targets = [
      { tbl: 'bill_items', row_id: 'i' }, { tbl: 'installment_plans', row_id: 'plan' },
      { tbl: 'merchant_category_rules', row_id: 'rule' },
    ]
    const beforeA = await sync(a)
    const beforeB = await sync(b)
    expect(beforeA.changes.filter(change => targets.some(target => target.row_id === change.row_id)).map(change => change.op))
      .toEqual(['upsert', 'upsert', 'upsert'])
    expect((await sync(b, beforeB.cursor, targets)).changes)
      .toEqual(targets.map(target => ({ ...target, op: 'delete' })))

    db.exec(
      "UPDATE bills SET card_id = 'cardB' WHERE id = 'billA';" +
      "UPDATE installment_plans SET card_id = 'cardB' WHERE id = 'plan';" +
      "UPDATE merchant_category_rules SET user_id = 'ownerB' WHERE id = 'rule';",
    )
    expect((await sync(a, beforeA.cursor)).changes.filter(change => targets.some(target => target.tbl === change.tbl)))
      .toEqual(targets.map(target => ({ ...target, op: 'delete' })))
    const afterB = await sync(b, beforeB.cursor)
    expect(afterB.changes.filter(change => targets.some(target => target.tbl === change.tbl)).map(change => change.op))
      .toEqual(['upsert', 'upsert', 'upsert'])

    db.exec("DELETE FROM card_holders WHERE id = 'holderB'; DELETE FROM users WHERE id = 'ownerB';")
    for (const target of targets) {
      expect((await changes(target.tbl, target.row_id)).at(-1)).toEqual({ owner_id: 'ownerB', op: 'delete' })
    }
  })

  it('writes tombstones for a holder manager transfer, bill deletion and direct item transfer', async () => {
    apply(direction3)
    db.exec("INSERT INTO bill_items (id, bill_id, description) VALUES ('i', 'billA', 'test');")
    await addPlan('plan', 'cardA')
    db.exec("UPDATE bill_items SET bill_id = 'billB' WHERE id = 'i';")
    expect(await changes('bill_items', 'i')).toEqual(expect.arrayContaining([
      { owner_id: 'ownerA', op: 'delete' }, { owner_id: 'ownerB', op: 'upsert' },
    ]))
    db.exec("UPDATE card_holders SET managed_by = 'ownerB' WHERE id = 'holderA';")
    expect(await changes('installment_plans', 'plan')).toEqual(expect.arrayContaining([
      { owner_id: 'ownerA', op: 'delete' }, { owner_id: 'ownerB', op: 'upsert' },
    ]))
    db.exec("DELETE FROM bills WHERE id = 'billB';")
    expect((await changes('bill_items', 'i')).at(-1)).toEqual({ owner_id: 'ownerB', op: 'delete' })
  })
})

describe('bill item normal entry points', () => {
  beforeEach(() => apply(direction3))

  it('stores a draft and its details with inherited currency and authoritative totals', async () => {
    const draft = await createBillImportDraft({
      created_by: 'ownerA', card_id: 'cardA', source_type: 'text',
      parsed_payload: {
        bill_amount: 200, bill_month: '2027-01', due_date: '2027-01-20',
        items: [{ description: '淘宝退款', item_type: 'refund', amount: -20 }],
      },
    })
    const bill = await confirmBillImportDraft(draft.id)
    const detail = await getBillDetail(bill.id)
    expect(detail.bill.bill_amount).toBe(200)
    expect(detail.items).toMatchObject([{ amount: 20, currency: 'USD', item_type: 'refund', category: 'shopping', source: 'llm' }])
  })

  it('supports legacy bill creation and payment with empty details', async () => {
    const bill = await createBill({
      card_id: 'cardA', bill_month: '2026-12', bill_amount: 30, due_date: '2026-12-15', status: 'unpaid',
    })
    await createPayment({ bill_id: bill.id, amount: 10, paid_at: '2026-12-01' })
    expect(await getBillDetail(bill.id)).toMatchObject({
      bill: { bill_amount: 30 }, items: [], payments: [{ amount: 10 }],
    })
  })

  it('rolls back the parent, details and sync rows when a later insert fails', async () => {
    db.exec("CREATE TRIGGER test_reject_bad_item BEFORE INSERT ON bill_items WHEN NEW.description = 'reject' BEGIN SELECT RAISE(ABORT, 'fixture_rejected'); END;")
    const before = await db.prepare('SELECT MAX(seq) AS seq FROM sync_changes').first()
    const items = Array.from({ length: 7 }, (_, index) => ({ description: index === 6 ? 'reject' : 'valid', amount: 10 }))
    await expect(createBill({
      card_id: 'cardA', bill_month: '2026-12', bill_amount: 100, due_date: '2026-12-15', status: 'unpaid', items,
    })).rejects.toThrow(/fixture_rejected/)
    expect(await db.prepare("SELECT id FROM bills WHERE bill_month = '2026-12'").first()).toBeNull()
    expect(await db.prepare('SELECT count(*) AS count FROM bill_items').first()).toEqual({ count: 0 })
    expect(await db.prepare('SELECT MAX(seq) AS seq FROM sync_changes').first()).toEqual(before)
  })

  it('imports 500 rows within the D1 bind limit and rejects unsupported row counts before writing', async () => {
    const items = Array.from({ length: 500 }, (_, index) => ({ description: 'transaction ' + index, amount: 0.01 }))
    expect((await batchImportBillItems({ bill_id: 'billA', items })).inserted).toBe(500)
    await expect(batchImportBillItems({ bill_id: 'billA', items: [...items, items[0]] })).rejects.toThrow(/500/)
    expect((await getBillDetail('billA')).items).toHaveLength(500)
  })

  it('scopes RPC requests, binds merchant rules to the session and preserves explicit category edits', async () => {
    const created = await dispatchRpc('billItems', 'createBillItem', [{
      bill_id: 'billA', description: 'SQ *Starbucks #12', amount: 10, category: 'shopping',
      remember_merchant: true, user_id: b.id,
    }], a)
    expect(created.status).toBe(200)
    const id = (created.data as { id: string }).id
    expect(await dispatchRpc('billItems', 'getMerchantCategoryRules', [a.id], b))
      .toMatchObject({ status: 200, data: [] })
    expect(await dispatchRpc('billItems', 'getMerchantCategoryRules', [b.id], a))
      .toMatchObject({ status: 200, data: [{ user_id: a.id, normalized_merchant: 'starbucks', category: 'shopping' }] })
    expect((await dispatchRpc('billItems', 'getBillItems', ['billA'], b)).status).toBe(403)
    expect((await dispatchRpc('billItems', 'deleteBillItem', [id], b)).status).toBe(403)
    expect((await dispatchRpc('billItems', 'updateBillItem', [id, { category: 'dining' }], b)).status).toBe(403)
    expect((await dispatchRpc('billItems', 'createBillItem', [{
      bill_id: 'billA', card_id: 'cardB', description: 'foreign card', amount: 50,
    }], a)).status).toBe(400)

    expect(await dispatchRpc('billItems', 'updateBillItem', [id, {
      category: 'dining', remember_merchant: true,
    }], a)).toMatchObject({ status: 200, data: { id, category: 'dining' } })
    expect(await dispatchRpc('billItems', 'createBillItem', [{
      bill_id: 'billA', card_tail: '1234', description: 'Starbucks #42', amount: 8,
    }], a)).toMatchObject({ status: 200, data: { category: 'dining', card_id: 'cardA', currency: 'USD' } })
    expect(await dispatchRpc('billItems', 'updateBillItem', [id, { category: null }], a))
      .toMatchObject({ status: 200, data: { id, category: null } })
    expect(await dispatchRpc('billItems', 'clearBillItems', ['billA'], a))
      .toMatchObject({ status: 200, data: { deleted: 2 } })
    expect(await getBillDetail('billA')).toMatchObject({ bill: { bill_amount: 100 }, items: [] })
  })
})
