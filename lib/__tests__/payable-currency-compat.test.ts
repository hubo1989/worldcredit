import { describe, it, expect, afterEach } from 'vitest'
import currencyFixtures from '../../shared/fixtures/payable-currencies.json'
import { createOpportunityDb, createSqliteD1, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { RpcDomainError } from '../api/errors'
import * as payablesShared from '../api/payables.shared'
import {
  createRecurringPayable,
  updateRecurringPayable,
  getRecurringPayables,
} from '../api/payables.server'

describe('payable currency normalization, RPC errors, and legacy D1 migration', () => {
  let db: SqliteD1 | null = null

  function mountFreshDb(): SqliteD1 {
    db = createOpportunityDb()
    db.exec("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash')")
    setDb(db as unknown as D1Database)
    return db
  }

  afterEach(() => {
    db?.close()
    db = null
  })

  it('matches shared/fixtures/payable-currencies.json codes, labels, symbols, and normalization cases', () => {
    const normalizePayableCurrency = (
      payablesShared as unknown as {
        normalizePayableCurrency?: (raw: unknown) => string | null
      }
    ).normalizePayableCurrency

    expect(payablesShared.PAYABLE_CURRENCIES).toEqual(
      currencyFixtures.currencies.map(item => item.code)
    )
    for (const item of currencyFixtures.currencies) {
      expect(
        payablesShared.PAYABLE_CURRENCY_LABELS[
          item.code as keyof typeof payablesShared.PAYABLE_CURRENCY_LABELS
        ]
      ).toBe(item.label)
    }
    expect(typeof normalizePayableCurrency).toBe('function')
    for (const item of currencyFixtures.normalization_cases) {
      expect(normalizePayableCurrency!(item.raw), item.id).toBe(item.expected)
    }
  })

  it('normalizes trimmed/lowercase codes and Chinese aliases on create and update', async () => {
    mountFreshDb()

    const created = await createRecurringPayable({
      created_by: 'u1',
      name: '海外服务器',
      category: 'utility',
      amount: 20,
      currency: ' usd ',
      due_day: 8,
    })
    expect(created.currency).toBe('USD')

    const cnyAlias = await createRecurringPayable({
      created_by: 'u1',
      name: '房租',
      category: 'rent',
      amount: 3200,
      currency: ' 人民币 ',
      due_day: 5,
    })
    expect(cnyAlias.currency).toBe('CNY')

    const hkdAlias = await updateRecurringPayable(created.id, { currency: '港币' })
    expect(hkdAlias.currency).toBe('HKD')
  })

  it('rejects unknown or malformed currencies with RpcDomainError VALIDATION_FAILED (HTTP 400)', async () => {
    mountFreshDb()

    for (const invalid of ['EUR', 'RMB', '']) {
      await expect(
        createRecurringPayable({
          created_by: 'u1',
          name: '测试应付',
          category: 'other',
          amount: 100,
          currency: invalid,
          due_day: 10,
        })
      ).rejects.toMatchObject({
        name: 'RpcDomainError',
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    }

    await expect(
      createRecurringPayable({
        created_by: 'u1',
        name: '   ',
        category: 'other',
        amount: 100,
        currency: 'CNY',
        due_day: 10,
      })
    ).rejects.toBeInstanceOf(RpcDomainError)
  })

  it('preserves historical unknown EUR when updating non-currency fields, and rejects active EUR currency edits', async () => {
    const sqlite = mountFreshDb()
    sqlite.exec(`
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, is_active, created_at)
      VALUES ('legacy-eur', 'u1', '欧洲订阅', 'other', 88, 'EUR', 12, 1, '2026-01-01T00:00:00Z');
    `)

    // Unchanged legacy EUR (or omitting currency) must allow non-currency edits without converting EUR -> CNY.
    const keptViaOmit = await updateRecurringPayable('legacy-eur', { name: '欧洲订阅（改名）' })
    expect(keptViaOmit.currency).toBe('EUR')
    expect(keptViaOmit.name).toBe('欧洲订阅（改名）')
    expect(keptViaOmit.amount).toBe(88)

    await expect(updateRecurringPayable('legacy-eur', { currency: 'EUR' })).rejects.toMatchObject({
      name: 'RpcDomainError',
      code: 'VALIDATION_FAILED',
      status: 400,
    })

    const listed = await getRecurringPayables('u1', new Date(2026, 9, 10))
    expect(listed.find(item => item.id === 'legacy-eur')?.currency).toBe('EUR')
  })

  it('migration 0026 safely normalizes known currency forms while leaving unknown EUR and amounts untouched', async () => {
    const sqlite = createSqliteD1()
    // Apply up to 0025 first, seed legacy messy rows, then apply 0026.
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '../../migrations/d1')
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const migration0026 = files.find(f => f.startsWith('0026_'))
    expect(migration0026).toBeDefined()

    for (const file of files) {
      if (file >= migration0026!) break
      sqlite.exec(readFileSync(join(dir, file), 'utf8'))
    }

    sqlite.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day)
      VALUES
        ('p-usd', 'u1', '云服务器', 'utility', 19.99, ' usd ', 1),
        ('p-cny', 'u1', '房租', 'rent', 4500, ' 人民币 ', 5),
        ('p-hkd', 'u1', '保险', 'insurance', 1200, '港币', 15),
        ('p-eur', 'u1', '欧洲软件', 'other', 49.5, 'EUR', 20),
        ('p-eur-space', 'u1', '欧洲会员', 'other', 9.9, ' eur ', 21);
    `)

    sqlite.exec(readFileSync(join(dir, migration0026!), 'utf8'))

    const rows = (
      await sqlite
        .prepare('SELECT id, amount, currency FROM recurring_payables ORDER BY id')
        .all<{ id: string; amount: number; currency: string }>()
    ).results

    expect(rows).toEqual([
      { id: 'p-cny', amount: 4500, currency: 'CNY' },
      { id: 'p-eur', amount: 49.5, currency: 'EUR' },
      { id: 'p-eur-space', amount: 9.9, currency: ' eur ' },
      { id: 'p-hkd', amount: 1200, currency: 'HKD' },
      { id: 'p-usd', amount: 19.99, currency: 'USD' },
    ])
    sqlite.close()
  })
})
