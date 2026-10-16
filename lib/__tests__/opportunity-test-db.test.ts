// lib/__tests__/opportunity-test-db.test.ts — test-harness contract for the
// opportunity suite. Everything downstream asserts against real SQLite, so the
// harness itself must prove: migrations apply to an empty database, foreign
// keys reject bad rows, `.batch()` rolls back on the first failure, and each
// test gets a fresh isolated instance.

import { describe, it, expect } from 'vitest'
import {
  createSqliteD1,
  createOpportunityDb,
  SQLITE_D1_MIGRATIONS_DIR,
} from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS, FIXTURE_NOW_ON } from './helpers/opportunity-fixtures'

describe('sqlite-d1 harness: batch atomicity', () => {
  it('第二条 SQL 失败时回滚整批第一条', async () => {
    const db = createSqliteD1()
    db.exec('CREATE TABLE checks (id TEXT PRIMARY KEY, n INTEGER CHECK(n>=0))')
    await expect(
      db.batch([
        db.prepare('INSERT INTO checks VALUES (?,?)').bind('first', 1),
        db.prepare('INSERT INTO checks VALUES (?,?)').bind('second', -1),
      ]),
    ).rejects.toThrow()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM checks').get()).toEqual({ n: 0 })
    db.close()
  })

  it('batch 全部成功时保留结果并返回真实 meta.changes', async () => {
    const db = createSqliteD1()
    db.exec('CREATE TABLE checks (id TEXT PRIMARY KEY, n INTEGER CHECK(n>=0))')
    const results = await db.batch([
      db.prepare('INSERT INTO checks VALUES (?,?)').bind('a', 1),
      db.prepare('INSERT INTO checks VALUES (?,?)').bind('b', 2),
    ])
    expect(results).toHaveLength(2)
    expect(results[0].meta.changes).toBe(1)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM checks').get()).toEqual({ n: 2 })
    db.close()
  })
})

describe('sqlite-d1 harness: real migrations on an empty database', () => {
  it('按序应用 migrations/d1 并创建基线表', () => {
    const db = createOpportunityDb()
    const tables = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name)
    for (const t of ['users', 'banks', 'card_products', 'benefits', 'promos', 'card_holders', 'credit_cards', 'bills', 'push_subscriptions']) {
      expect(tables).toContain(t)
    }
    // 0012 landed (bank quota/statement modes) — proves the full sequence ran.
    const cols = db.raw.prepare('PRAGMA table_info(banks)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('quota_mode')
    db.close()
  })

  it('helper resolves the checked-in migrations directory', () => {
    expect(SQLITE_D1_MIGRATIONS_DIR.endsWith('migrations/d1')).toBe(true)
  })
})

describe('sqlite-d1 harness: foreign keys enforced', () => {
  it('外键违例在 run() 时抛错且不落库', async () => {
    const db = createOpportunityDb()
    const stmt = db
      .prepare(
        `INSERT INTO credit_cards (id, holder_id, card_product_id, credit_limit, billing_day) VALUES (?,?,?,?,?)`,
      )
      .bind('c-ghost', 'no-such-holder', 'no-such-product', 1000, 5)
    await expect(stmt.run()).rejects.toThrow(/FOREIGN KEY/)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM credit_cards').get()).toEqual({ n: 0 })
    db.close()
  })
})

describe('fixtures: fixed seed', () => {
  it('三位用户、holder/卡矩阵完整落库', async () => {
    const db = createOpportunityDb()
    await seedOpportunityFixtures(db)

    const users = db.raw.prepare('SELECT id, role FROM users ORDER BY id').all() as { id: string; role: string }[]
    expect(users).toEqual([
      { id: 'u-admin-a', role: 'admin' },
      { id: 'u-admin-b', role: 'admin' },
      { id: 'u-member-a', role: 'member' },
    ])

    // 无卡成员：member A 的 holder 存在但没有任何卡。
    const memberCards = db.raw
      .prepare('SELECT COUNT(*) AS n FROM credit_cards WHERE holder_id = ?')
      .get(FIXTURE_IDS.holders.memberSelf) as { n: number }
    expect(memberCards.n).toBe(0)

    // 两个 holder 持同产品（同款卡不自动共享个人用量的场景）。
    const sharedProductHolders = db.raw
      .prepare(
        `SELECT DISTINCT cc.holder_id FROM credit_cards cc WHERE cc.card_product_id = ? AND cc.status = 'active' AND cc.card_type = 'credit' ORDER BY cc.holder_id`,
      )
      .all(FIXTURE_IDS.products.cmbClassic) as { holder_id: string }[]
    expect(sharedProductHolders.map((r) => r.holder_id)).toEqual([FIXTURE_IDS.holders.family, FIXTURE_IDS.holders.self])

    // 同 holder 第二张卡、贷款卡、冻结卡、不同币种卡。
    const selfCardCount = db.raw
      .prepare('SELECT COUNT(*) AS n FROM credit_cards WHERE holder_id = ?')
      .get(FIXTURE_IDS.holders.self) as { n: number }
    expect(selfCardCount.n).toBe(3) // 信用主卡 + 第二张卡 + 贷款卡

    const loanCard = db.raw
      .prepare("SELECT COUNT(*) AS n FROM credit_cards WHERE id = ? AND card_type = 'loan'")
      .get(FIXTURE_IDS.cards.selfLoan) as { n: number }
    expect(loanCard.n).toBe(1)

    const frozenCard = db.raw
      .prepare("SELECT COUNT(*) AS n FROM credit_cards WHERE id = ? AND status = 'frozen'")
      .get(FIXTURE_IDS.cards.familyFrozen) as { n: number }
    expect(frozenCard.n).toBe(1)

    const usdProduct = db.raw
      .prepare("SELECT COUNT(*) AS n FROM card_products WHERE id = ? AND currency = 'USD'")
      .get(FIXTURE_IDS.products.chaseSapphire) as { n: number }
    expect(usdProduct.n).toBe(1)

    // admin B 的世界与 A 完全隔离。
    const adminBCards = db.raw
      .prepare('SELECT COUNT(*) AS n FROM credit_cards WHERE holder_id = ?')
      .get(FIXTURE_IDS.holders.adminB) as { n: number }
    expect(adminBCards.n).toBe(1)
    db.close()
  })

  it('活动覆盖有效/过期/未来/停用/无产品五种形态（供 P0 复现）', async () => {
    const db = createOpportunityDb()
    await seedOpportunityFixtures(db)
    const now = FIXTURE_NOW_ON
    for (const [id, expectLive] of [
      [FIXTURE_IDS.promos.live, true],
      [FIXTURE_IDS.promos.expired, false],
      [FIXTURE_IDS.promos.future, false],
      [FIXTURE_IDS.promos.disabled, false],
    ] as const) {
      const row = db.raw
        .prepare('SELECT is_active, start_date, end_date FROM promos WHERE id = ?')
        .get(id) as { is_active: number; start_date: string | null; end_date: string | null }
      const live =
        row.is_active === 1 &&
        (!row.start_date || row.start_date <= now) &&
        (!row.end_date || row.end_date >= now)
      expect(live).toBe(expectLive)
    }
    const bankOnly = db.raw
      .prepare('SELECT COUNT(*) AS n FROM promos WHERE id = ? AND card_product_id IS NULL AND bank_id IS NOT NULL')
      .get(FIXTURE_IDS.promos.bankOnly) as { n: number }
    expect(bankOnly.n).toBe(1)
    db.close()
  })
})

describe('harness isolation', () => {
  it('每个实例互相独立：写入不泄漏到新实例', async () => {
    const first = createOpportunityDb()
    await first.prepare('INSERT INTO banks (id, name) VALUES (?,?)').bind('b-leak', '泄漏测试银行').run()
    expect(first.raw.prepare("SELECT COUNT(*) AS n FROM banks WHERE id = 'b-leak'").get()).toEqual({ n: 1 })
    first.close()

    const second = createOpportunityDb()
    expect(second.raw.prepare("SELECT COUNT(*) AS n FROM banks WHERE id = 'b-leak'").get()).toEqual({ n: 0 })
    second.close()
  })

  it('close() 后句柄不可用（防止测试间共用连接）', () => {
    const db = createOpportunityDb()
    db.close()
    expect(() => db.raw.prepare('SELECT 1')).toThrow()
  })
})
