import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb, setWorkerEnv } from '../db/client'
import { createSessionValue, type SessionUser } from '../session'
import { POST as pullHandler } from '../../app/api/sync/pull/route'
import { POST as pushHandler } from '../../app/api/sync/push/route'

describe('End-to-end /api/sync/pull & /api/sync/push', () => {
  let db: ReturnType<typeof createOpportunityDb>
  let token: string

  const mockUser: SessionUser = {
    id: 'u_sync_test',
    email: 'sync_user@example.com',
    name: 'Sync User',
    role: 'member',
    created_at: '2026-10-21T00:00:00Z',
  }

  beforeAll(async () => {
    setWorkerEnv({ SESSION_SECRET: 'test-secret-at-least-16-chars' })
    token = await createSessionValue(mockUser)
  })

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    // Base schema seed
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u_sync_test', 'sync_user@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp1', 'b1', '招商银行', '经典白', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES ('h1', 'u_sync_test', 'u_sync_test', '本人', 'u_sync_test');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc1', 'h1', 'cp1', 5);
      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status)
      VALUES ('bill_1', 'cc1', '2026-10-01', '2026-10-25', 1000, 'unpaid');
    `)
  })

  it('rejects unauthenticated pull requests', async () => {
    const req = new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ cursor: 0 }),
    })
    const res = await pullHandler(req)
    expect(res.status).toBe(401)
  })

  it('pulls all initial changes and advances cursor', async () => {
    const req = new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cursor: 0 }),
    })
    const res = await pullHandler(req)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      cursor: number
      changes: Array<{ tbl: string; op: string; row?: Record<string, unknown> }>
    }

    expect(data.cursor).toBeGreaterThan(0)
    const tables = data.changes.map(c => c.tbl)
    expect(tables).toContain('banks')
    expect(tables).toContain('card_products')
    expect(tables).toContain('card_holders')
    expect(tables).toContain('credit_cards')
    expect(tables).toContain('bills')

    // Second pull with advanced cursor returns empty changes
    const req2 = new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cursor: data.cursor }),
    })
    const res2 = await pullHandler(req2)
    const data2 = (await res2.json()) as { cursor: number; changes: unknown[] }
    expect(data2.changes).toEqual([])
    expect(data2.cursor).toBe(data.cursor)
  })

  it('pushes offline mutation (recordPayment) and verifies pull reflects it', async () => {
    // 1. Initial pull to advance cursor
    const pullReq1 = new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cursor: 0 }),
    })
    const pullRes1 = await pullHandler(pullReq1)
    const { cursor: startCursor } = (await pullRes1.json()) as { cursor: number }

    // 2. Push mutation
    const pushReq = new Request('https://app.all-bill.com/api/sync/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        client_id: 'ios_client_1',
        mutations: [
          {
            id: 'mut_pay_1',
            name: 'bills.recordPayment',
            args: [
              {
                id: 'pay_from_ios',
                bill_id: 'bill_1',
                amount: 1000,
                idempotency_key: 'idem_ios_1',
              },
            ],
          },
        ],
      }),
    })

    const pushRes = await pushHandler(pushReq)
    expect(pushRes.status).toBe(200)

    const pushData = (await pushRes.json()) as {
      results: Array<{ id: string; ok: boolean; already_processed?: boolean; error?: string }>
    }
    expect(pushData.results).toHaveLength(1)
    expect(pushData.results[0].ok).toBe(true)
    expect(pushData.results[0].ok).toBe(true)

    // 3. Repeat exact same push -> returns already_processed: true
    const pushReqRepeat = new Request('https://app.all-bill.com/api/sync/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        client_id: 'ios_client_1',
        mutations: [
          {
            id: 'mut_pay_1',
            name: 'bills.recordPayment',
            args: [
              {
                id: 'pay_from_ios',
                bill_id: 'bill_1',
                amount: 1000,
                idempotency_key: 'idem_ios_1',
              },
            ],
          },
        ],
      }),
    })
    const pushResRepeat = await pushHandler(pushReqRepeat)
    const pushDataRepeat = (await pushResRepeat.json()) as {
      results: Array<{ id: string; ok: boolean; already_processed?: boolean }>
    }
    expect(pushDataRepeat.results[0].already_processed).toBe(true)

    // 4. Pull incremental changes from startCursor -> receives payments and bills update
    const pullReq2 = new Request('https://app.all-bill.com/api/sync/pull', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cursor: startCursor }),
    })
    const pullRes2 = await pullHandler(pullReq2)
    const pullData2 = (await pullRes2.json()) as {
      cursor: number
      changes: Array<{ tbl: string; op: string; row?: Record<string, unknown> }>
    }

    expect(pullData2.cursor).toBeGreaterThan(startCursor)
    const newTables = pullData2.changes.map(c => c.tbl)
    expect(newTables).toContain('payments')
    expect(newTables).toContain('bills')

    const billChange = pullData2.changes.find(c => c.tbl === 'bills')
    expect(billChange?.row?.status).toBe('paid')

    const payChange = pullData2.changes.find(c => c.tbl === 'payments')
    expect(payChange?.row?.id).toBe('pay_from_ios')
  })
})
