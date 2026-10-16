// lib/__tests__/opportunity-existing-regressions.test.ts — P0 regressions for
// the existing promos/benefits surface, reproduced against real SQLite with
// the fixed fixture world:
//   1. userBanks came from the whole catalog, not the user's own cards
//   2. expired / disabled / future promos were returned as live
//   3. assertBenefitAccess's unqualified LIMIT 1 denied a member who does
//      hold the product (two holders share one product)
//   4. next-month usage leaked into this month's count; registrations had no
//      date / expiry / quota protection

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS, FIXTURE_NOW_ON } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { getPromosWithBanks } from '../api/promos.server'
import { getAllMyBenefits, recordBenefitUsage } from '../api/benefits.server'
import { getCardDetail } from '../api/cards.server'
import { assertBenefitAccess, MemberScopeError } from '../api/member-scope'

let db: SqliteD1

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('getPromosWithBanks: user scope and live-window prefilter', () => {
  it('member without cards sees no user banks and only currently live promos', async () => {
    const { promos, userBanks } = await getPromosWithBanks(FIXTURE_IDS.users.memberA, FIXTURE_NOW_ON)
    expect(userBanks).toEqual([])
    const ids = promos.map((p) => p.id)
    expect(ids).toContain(FIXTURE_IDS.promos.live)
    expect(ids).toContain(FIXTURE_IDS.promos.bankOnly)
    expect(ids).not.toContain(FIXTURE_IDS.promos.expired)
    expect(ids).not.toContain(FIXTURE_IDS.promos.future)
    expect(ids).not.toContain(FIXTURE_IDS.promos.disabled)
    // Shape compatibility: old callers read these fields.
    for (const p of promos) {
      expect(typeof p.bank_name).toBe('string')
      expect(typeof p.title).toBe('string')
    }
  })

  it("userBanks come from the user's own active credit cards, not the catalog", async () => {
    const { userBanks } = await getPromosWithBanks(FIXTURE_IDS.users.adminA, FIXTURE_NOW_ON)
    // h-self/h-family credit cards: 招商银行. The loan card's 工商银行 and the
    // foreign USD product (admin B's world) must not leak in.
    expect(userBanks).toEqual(['招商银行'])
  })

  it('another admin sees only their own world', async () => {
    const { userBanks } = await getPromosWithBanks(FIXTURE_IDS.users.adminB, FIXTURE_NOW_ON)
    expect(userBanks).toEqual(['Chase'])
  })
})

describe('assertBenefitAccess: product held by two holders', () => {
  it('allows the member whose holder shares the product (no LIMIT 1 misfire)', async () => {
    const ctx = { userId: 'u-x', role: 'member' as const, holderIds: [FIXTURE_IDS.holders.family] }
    await expect(
      assertBenefitAccess(FIXTURE_IDS.benefits.cmbClassicLounge, ctx),
    ).resolves.toBeUndefined()
  })

  it('still rejects a member whose holders do not hold the product', async () => {
    const ctx = { userId: 'u-x', role: 'member' as const, holderIds: [FIXTURE_IDS.holders.memberSelf] }
    await expect(
      assertBenefitAccess(FIXTURE_IDS.benefits.cmbClassicLounge, ctx),
    ).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('getAllMyBenefits: period filtering', () => {
  it('last month usage does not leak into this month (monthly benefit)', async () => {
    await db.batch([
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-sep', FIXTURE_IDS.benefits.cmbLifeMovie, '2026-09-20'),
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-oct', FIXTURE_IDS.benefits.cmbLifeMovie, '2026-10-02'),
    ])
    const mine = await getAllMyBenefits(FIXTURE_IDS.users.adminA)
    const movie = mine.find((b) => b.id === FIXTURE_IDS.benefits.cmbLifeMovie)
    expect(movie).toBeDefined()
    expect(movie?.usage_count).toBe(1)
  })

  it('card detail counts the same period window as the benefit list (unified getCycleWindow)', async () => {
    await db.batch([
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-sep2', FIXTURE_IDS.benefits.cmbLifeMovie, '2026-09-20'),
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-oct2', FIXTURE_IDS.benefits.cmbLifeMovie, '2026-10-02'),
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-oct3', FIXTURE_IDS.benefits.cmbLifeMovie, '2026-10-10'),
    ])
    const detail = await getCardDetail(FIXTURE_IDS.cards.selfSecond, FIXTURE_NOW_ON)
    const movie = detail.benefits.find((b) => b.id === FIXTURE_IDS.benefits.cmbLifeMovie)
    expect(movie?.used).toBe(2)
    // Same number as the list page computes for the same day:
    const mine = await getAllMyBenefits(FIXTURE_IDS.users.adminA, FIXTURE_NOW_ON)
    expect(mine.find((b) => b.id === FIXTURE_IDS.benefits.cmbLifeMovie)?.usage_count).toBe(2)
  })

  it('yearly benefits reset at reset_month, not at the calendar year boundary', async () => {
    // cmbClassicLounge is yearly; pin reset_month to July and check the window
    // rolls over mid-year instead of on Jan 1st.
    await db
      .prepare('UPDATE benefits SET reset_month = ? WHERE id = ?')
      .bind(7, FIXTURE_IDS.benefits.cmbClassicLounge)
      .run()
    await db.batch([
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-jun', FIXTURE_IDS.benefits.cmbClassicLounge, '2026-06-30'),
      db
        .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES (?,?,?)')
        .bind('u-jul', FIXTURE_IDS.benefits.cmbClassicLounge, '2026-07-01'),
    ])
    const mine = await getAllMyBenefits(FIXTURE_IDS.users.adminA, FIXTURE_NOW_ON)
    expect(mine.find((b) => b.id === FIXTURE_IDS.benefits.cmbClassicLounge)?.usage_count).toBe(1)
  })
})

describe('recordBenefitUsage: input protection', () => {
  it('rejects a future used_at date', async () => {
    // Compare against the real clock the service uses — a hardcoded “future”
    // date goes stale once the wall clock passes it.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await expect(
      recordBenefitUsage({
        benefit_id: FIXTURE_IDS.benefits.cmbLifeMovie,
        used_at: tomorrow,
        note: undefined,
      }),
    ).rejects.toThrow(/未来|不能超过|invalid|日期/i)
  })

  it('rejects an expired benefit', async () => {
    await db
      .prepare('UPDATE benefits SET expiry_date = ? WHERE id = ?')
      .bind('2026-10-01', FIXTURE_IDS.benefits.cmbLifeMovie)
      .run()
    await expect(
      recordBenefitUsage({
        benefit_id: FIXTURE_IDS.benefits.cmbLifeMovie,
        used_at: FIXTURE_NOW_ON,
        note: undefined,
      }),
    ).rejects.toThrow(/过期|expired/i)
  })

  it('rejects once the period quota is exhausted, allows below it', async () => {
    // monthly quota 2: two uses this month -> third rejected
    for (let i = 0; i < 2; i++) {
      await recordBenefitUsage({
        benefit_id: FIXTURE_IDS.benefits.cmbLifeMovie,
        used_at: FIXTURE_NOW_ON,
        note: undefined,
      })
    }
    await expect(
      recordBenefitUsage({
        benefit_id: FIXTURE_IDS.benefits.cmbLifeMovie,
        used_at: FIXTURE_NOW_ON,
        note: undefined,
      }),
    ).rejects.toThrow(/额度|quota|次数/i)
  })
})
