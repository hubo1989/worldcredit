import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as rpcHandler } from '../../app/api/rpc/[module]/[fn]/route'
import { POST as pullHandler } from '../../app/api/sync/pull/route'
import { POST as pushHandler } from '../../app/api/sync/push/route'
import { setDb, setWorkerEnv } from '../db/client'
import { createSessionValue, type SessionUser } from '../session'
import { ADMIN_EMAILS } from '../admin-emails'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'

const admin: SessionUser = {
  id: 'error-test-owner', email: ADMIN_EMAILS[0], name: 'Owner',
  role: 'admin', created_at: '2026-10-01T00:00:00Z',
}
let db: SqliteD1
let token: string
let memberToken: string
const payment = {
  id: 'payment-from-ios', bill_id: 'bill', amount: 1000,
  idempotency_key: 'error-test-idempotency',
}
interface MutationResult {
  id: string
  ok: boolean
  permanent?: boolean
  code?: string
  error?: string
  already_processed?: boolean
}

beforeAll(async () => {
  setWorkerEnv({ SESSION_SECRET: 'sync-business-error-test-secret-at-least-16-chars' })
  token = await createSessionValue(admin)
  memberToken = await createSessionValue({
    ...admin, id: 'error-test-member', email: 'error-test-member@example.test', role: 'member',
  })
})
beforeEach(() => {
  db = createOpportunityDb()
  setDb(db as unknown as D1Database)
  db.exec(`
    INSERT INTO users (id,email,password_hash) VALUES
      ('error-test-owner','error-test-owner@example.test','hash'),
      ('error-test-member','error-test-member@example.test','hash');
    INSERT INTO banks (id,name) VALUES ('bank','测试银行');
    INSERT INTO card_products (id,bank_id,bank_name,card_name)
      VALUES ('product','bank','测试银行','测试卡');
    INSERT INTO card_holders (id,created_by,managed_by,name)
      VALUES ('holder','error-test-owner','error-test-owner','本人');
    INSERT INTO credit_cards (id,holder_id,card_product_id,billing_day)
      VALUES ('card','holder','product',5);
    INSERT INTO bills (id,card_id,bill_month,due_date,bill_amount)
      VALUES ('bill','card','2026-10','2026-10-25',1000);
  `)
})
afterEach(() => {
  vi.restoreAllMocks()
  setDb(null)
  db.close()
})

async function push(name: string, args: unknown[], authToken = token) {
  const response = await pushHandler(new Request('https://app.all-bill.com/api/sync/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      client_id: 'error-test-ios',
      mutations: [{ id: 'error-test-mutation', name, args }],
    }),
  }))
  expect(response.status).toBe(200)
  const body = await response.json() as { results: MutationResult[] }
  expect(body.results).toHaveLength(1)
  return body.results[0]
}

async function rpc(fn: string, args: unknown[]) {
  return rpcHandler(new Request(`https://app.all-bill.com/api/rpc/bills/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ args }),
  }), { params: Promise.resolve({ module: 'bills', fn }) })
}

describe('explicit bill business errors on the RPC and sync surfaces', () => {
  it.each([
    { input: null, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, idempotency_key: '' }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, bill_id: '' }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, amount: 0 }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, amount: -1 }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, amount: '100' }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, id: 123 }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, paid_at: 123 }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, channel: {} }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, note: [] }, status: 400, code: 'VALIDATION_FAILED' },
    { input: { ...payment, bill_id: 'missing' }, status: 404, code: 'NOT_FOUND' },
    { input: { ...payment, amount: 1001 }, status: 409, code: 'CONFLICT' },
  ])('maps recordPayment business refusal to $status/$code', async ({ input, status, code }) => {
    const response = await rpc('recordPayment', [input])
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({
      data: null, code, error: expect.any(String), details: {}, request_id: expect.any(String),
    })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 })
  })

  it.each([
    { args: ['bill', -1], status: 400, code: 'VALIDATION_FAILED' },
    { args: ['bill', '100'], status: 400, code: 'VALIDATION_FAILED' },
    { args: ['bill'], status: 400, code: 'VALIDATION_FAILED' },
    { args: ['', 100], status: 400, code: 'VALIDATION_FAILED' },
    { args: ['missing', 100], status: 404, code: 'NOT_FOUND' },
  ])('maps amount override business refusal to $status/$code', async ({ args, status, code }) => {
    const response = await rpc('setBillAmountOverride', args)
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ data: null, code })
    expect(db.raw.prepare("SELECT bill_amount_override FROM bills WHERE id='bill'").get())
      .toEqual({ bill_amount_override: null })
  })

  it('keeps zero and null valid for the existing amount override API', async () => {
    expect((await rpc('setBillAmountOverride', ['bill', 0])).status).toBe(200)
    expect(db.raw.prepare("SELECT bill_amount_override FROM bills WHERE id='bill'").get())
      .toEqual({ bill_amount_override: 0 })
    expect((await rpc('setBillAmountOverride', ['bill', null])).status).toBe(200)
    expect(db.raw.prepare("SELECT bill_amount_override FROM bills WHERE id='bill'").get())
      .toEqual({ bill_amount_override: null })
  })

  it('permanently rejects an already-settled bill and replays the cached failure without executing it', async () => {
    db.exec("UPDATE bills SET status='paid' WHERE id='bill'")
    const initialCursor = db.raw.prepare('SELECT MAX(seq) AS seq FROM sync_changes').get()?.seq
    const result = await push('bills.recordPayment', [payment])
    expect(result).toMatchObject({ ok: false, permanent: true, code: 'CONFLICT' })
    expect(result.error).toContain('已结清')
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 })
    expect(db.raw.prepare('SELECT MAX(seq) AS seq FROM sync_changes').get()?.seq).toBe(initialCursor)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_mutations').get()).toEqual({ n: 1 })

    // The refusal itself creates no change event. Reconcile still returns the
    // authoritative bill and deletes the client's optimistic payment entity.
    const pulled = await pullHandler(new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cursor: initialCursor, reconcile: [
        { tbl: 'bills', row_id: 'bill' }, { tbl: 'payments', row_id: payment.id },
      ] }),
    }))
    expect(await pulled.json()).toMatchObject({
      cursor: initialCursor, has_more: false, changes: [
        { tbl: 'bills', row_id: 'bill', op: 'upsert', row: expect.objectContaining({ status: 'paid' }) },
        { tbl: 'payments', row_id: payment.id, op: 'delete' },
      ],
    })

    // Even if the bill is later reopened, the same mutation remains refused.
    db.exec("UPDATE bills SET status='unpaid' WHERE id='bill'")
    expect(await push('bills.recordPayment', [payment])).toEqual({ ...result, already_processed: true })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 })
  })

  it('returns permanent conflict when actual payments leave no remaining due despite stale status', async () => {
    db.exec(`INSERT INTO payments (id,bill_id,amount,idempotency_key)
      VALUES ('elsewhere-payment','bill',1000,'elsewhere-key')`)
    expect(await push('bills.recordPayment', [payment])).toMatchObject({
      ok: false, permanent: true, code: 'CONFLICT', error: expect.stringContaining('已无应还金额'),
    })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 1 })
  })

  it('keeps the existing member authorization guard before any billing mutation', async () => {
    expect(await push('bills.recordPayment', [payment], memberToken)).toMatchObject({
      ok: false, permanent: true, error: expect.stringContaining('无权访问'),
    })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 })
  })

  it.each(['idempotency lookup', 'bill lookup', 'payment total', 'write batch'])(
    'keeps a transient D1 %s failure retryable and permits the same mutation to succeed later',
    async phase => {
      const message = 'D1 temporarily unavailable; 账单不存在 is diagnostic text only'
      const prepare = db.prepare.bind(db)
      let failOnce = true
      if (phase === 'write batch') {
        vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error(message))
      } else {
        vi.spyOn(db, 'prepare').mockImplementation(sql => {
          const shouldFail = phase === 'idempotency lookup'
            ? sql.startsWith('SELECT * FROM payments WHERE idempotency_key')
            : phase === 'bill lookup' ? sql.includes('SELECT b.*, cc.id AS cc_id')
              : sql.startsWith('SELECT SUM(amount) AS total FROM payments')
          if (failOnce && shouldFail) {
            failOnce = false
            throw new Error(message)
          }
          return prepare(sql)
        })
      }
      const first = await push('bills.recordPayment', [payment])
      expect(first).toMatchObject({ ok: false, permanent: false, error: message })
      expect(first.code).toBeUndefined()
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_mutations').get()).toEqual({ n: 0 })
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 })
      expect(await push('bills.recordPayment', [payment])).toMatchObject({ ok: true })
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 1 })
    },
  )

  it('keeps amount override D1 failures as HTTP 500 and retryable push results', async () => {
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('UPDATE bills SET bill_amount_override')) {
        throw new Error('D1 unavailable')
      }
      return prepare(sql)
    })
    const response = await rpc('setBillAmountOverride', ['bill', 1200])
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ data: null, error: 'D1 unavailable' })
    expect(await push('bills.setBillAmountOverride', ['bill', 1200])).toMatchObject({
      ok: false, permanent: false, error: 'D1 unavailable',
    })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_mutations').get()).toEqual({ n: 0 })
  })
})
