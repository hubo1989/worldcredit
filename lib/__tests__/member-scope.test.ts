// lib/__tests__/member-scope.test.ts — family-member data isolation contract.
//
// Members reach data through guards in lib/api/member-scope.ts; every guard must
// fail closed (throw MemberScopeError -> HTTP 403). These run against an
// in-memory D1 stub so the guards' real queries are exercised, not re-stated.
// assertBenefitAccess is additionally exercised against real SQLite: its SQL
// must scope the product->card join to the member's holders (P0 fix — an
// unqualified LIMIT 1 used to misfire when two holders share a product).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setDb } from '../db/client'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import {
  assertHolderAccess,
  assertHolderIdsAccess,
  assertCardAccess,
  assertBillAccess,
  assertLedgerAccess,
  assertDraftAccess,
  assertRecordAccess,
  assertBillListAccess,
  assertBenefitAccess,
  buildMemberContext,
  applyAnalyticsScope,
  filterCardsByHolder,
  filterHolders,
  MemberScopeError,
  type MemberContext,
} from '../api/member-scope'

const ROOT = join(__dirname, '../..')

// ── In-memory D1 stub: only the statements the guards actually issue. ──
type Row = Record<string, unknown>

interface Tables {
  card_holders: Row[]
  credit_cards: Row[]
  bills: Row[]
  bill_import_drafts: Row[]
  gmail_ledger_entries: Row[]
}

function makeDb(tables: Tables) {
  return {
    prepare(sql: string) {
      const norm = sql.replace(/\s+/g, ' ').trim()
      const run = (args: unknown[]): Row[] => {
        const eq = (a: unknown, b: unknown) => a === b
        const is = (re: RegExp) => re.test(norm)
        if (is(/FROM card_holders WHERE auth_user_id = \?/i)) {
          return tables.card_holders.filter(r => eq(r.auth_user_id, args[0]))
        }
        if (is(/SELECT holder_id FROM credit_cards WHERE id = \?/i)) {
          return tables.credit_cards.filter(r => eq(r.id, args[0])).map(r => ({ holder_id: r.holder_id }))
        }
        if (is(/SELECT cc\.holder_id FROM bills b JOIN credit_cards cc ON b\.card_id = cc\.id WHERE b\.id = \?/i)) {
          const bill = tables.bills.find(r => eq(r.id, args[0]))
          if (!bill) return []
          const card = tables.credit_cards.find(r => eq(r.id, bill.card_id))
          return card ? [{ holder_id: card.holder_id }] : []
        }
        if (is(/SELECT created_by FROM bill_import_drafts WHERE id = \?/i)) {
          return tables.bill_import_drafts.filter(r => eq(r.id, args[0])).map(r => ({ created_by: r.created_by }))
        }
        if (is(/SELECT created_by FROM gmail_ledger_entries WHERE ledger_id = \?/i)) {
          return tables.gmail_ledger_entries.filter(r => eq(r.ledger_id, args[0])).map(r => ({ created_by: r.created_by }))
        }
        throw new Error('unstubbed SQL: ' + norm)
      }
      return {
        bind(...args: unknown[]) {
          return {
            async all() { return { results: run(args) } },
            async first() { const r = run(args); return r.length ? r[0] : null },
            async run() { return { meta: { changes: 1 } } },
          }
        },
      }
    },
  } as unknown as D1Database
}

const TABLES: Tables = {
  card_holders: [
    { id: 'h-mine', auth_user_id: 'u-member' },
    { id: 'h-other', auth_user_id: null },
  ],
  credit_cards: [
    { id: 'c-mine', holder_id: 'h-mine' },
    { id: 'c-other', holder_id: 'h-other' },
  ],
  bills: [
    { id: 'b-mine', card_id: 'c-mine' },
    { id: 'b-other', card_id: 'c-other' },
  ],
  bill_import_drafts: [
    { id: 'd-mine', created_by: 'u-member' },
    { id: 'd-other', created_by: 'u-someone-else' },
  ],
  gmail_ledger_entries: [
    { ledger_id: 'l-mine', created_by: 'u-member' },
    { ledger_id: 'l-other', created_by: 'u-someone-else' },
    { ledger_id: 'l-ownerless', created_by: null },
  ],
}

const ctx: MemberContext = { userId: 'u-member', role: 'member', holderIds: ['h-mine'] }

beforeEach(() => {
  setDb(makeDb(TABLES))
})

describe('holder guards', () => {
  it('allows the member-ed holder', () => {
    expect(() => assertHolderAccess('h-mine', ctx)).not.toThrow()
  })
  it('rejects another holder', () => {
    expect(() => assertHolderAccess('h-other', ctx)).toThrow(MemberScopeError)
  })
  it('rejects a missing / non-string holder id', () => {
    expect(() => assertHolderAccess(undefined, ctx)).toThrow(MemberScopeError)
    expect(() => assertHolderAccess(42, ctx)).toThrow(MemberScopeError)
  })
  it('holder id lists pass only when every id is owned', () => {
    expect(() => assertHolderIdsAccess(['h-mine'], ctx)).not.toThrow()
    expect(() => assertHolderIdsAccess(['h-mine', 'h-other'], ctx)).toThrow(MemberScopeError)
    expect(() => assertHolderIdsAccess('h-mine', ctx)).toThrow(MemberScopeError)
  })
})

describe('card / bill guards', () => {
  it('allows cards and bills on the member-ed holder', async () => {
    await expect(assertCardAccess('c-mine', ctx)).resolves.toBeUndefined()
    await expect(assertBillAccess('b-mine', ctx)).resolves.toBeUndefined()
  })
  it('rejects cards and bills belonging to someone else', async () => {
    await expect(assertCardAccess('c-other', ctx)).rejects.toBeInstanceOf(MemberScopeError)
    await expect(assertBillAccess('b-other', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  it('rejects unknown ids (fail closed, not fall through)', async () => {
    await expect(assertCardAccess('nope', ctx)).rejects.toBeInstanceOf(MemberScopeError)
    await expect(assertBillAccess('nope', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('draft guard', () => {
  it('allows the member\'s own draft', async () => {
    await expect(assertDraftAccess('d-mine', ctx)).resolves.toBeUndefined()
  })
  it('rejects another user\'s draft', async () => {
    await expect(assertDraftAccess('d-other', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('gmail-ledger guard', () => {
  it('allows rows the member ingested', async () => {
    await expect(assertLedgerAccess('l-mine', ctx)).resolves.toBeUndefined()
  })
  it('rejects rows ingested by another account', async () => {
    await expect(assertLedgerAccess('l-other', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  it('rejects ownerless rows (no created_by) rather than sharing them', async () => {
    await expect(assertLedgerAccess('l-ownerless', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('record guard dispatches by type', () => {
  it('routes bill/card/holder types to the matching guard', async () => {
    await expect(assertRecordAccess('bill', 'b-mine', ctx)).resolves.toBeUndefined()
    await expect(assertRecordAccess('card', 'c-mine', ctx)).resolves.toBeUndefined()
    await expect(assertRecordAccess('holder', 'h-mine', ctx)).resolves.toBeUndefined()
  })
  it('rejects an unknown record type instead of allowing it', async () => {
    await expect(assertRecordAccess('mystery', 'b-mine', ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('bill list guard fails closed', () => {
  it('allows a list of owned bills', async () => {
    await expect(assertBillListAccess([{ id: 'b-mine' }], ctx)).resolves.toBeUndefined()
  })
  it('rejects a list containing a bill owned by someone else', async () => {
    await expect(assertBillListAccess([{ id: 'b-mine' }, { id: 'b-other' }], ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  // Regression: this used to `return` early on a non-array, which let an
  // unvalidated payload through — the opposite of the module's fail-closed rule.
  it('rejects a non-array payload instead of returning early', async () => {
    await expect(assertBillListAccess(undefined, ctx)).rejects.toBeInstanceOf(MemberScopeError)
    await expect(assertBillListAccess('b-mine', ctx)).rejects.toBeInstanceOf(MemberScopeError)
    await expect(assertBillListAccess({ id: 'b-mine' }, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  it('still allows an empty list', async () => {
    await expect(assertBillListAccess([], ctx)).resolves.toBeUndefined()
  })
})

describe('analytics scoping', () => {
  it('rewrites an unscoped filter to the member\'s holder', async () => {
    const filters: Record<string, unknown> = {}
    await applyAnalyticsScope(filters, ctx)
    expect(filters.holder_id).toBe('h-mine')
  })
  it('rejects a filter naming another holder', async () => {
    await expect(applyAnalyticsScope({ holder_id: 'h-other' }, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  it('rejects a non-object filter', async () => {
    await expect(applyAnalyticsScope(null, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
  it('requires a holder binding when one cannot be inferred', async () => {
    const unbound: MemberContext = { userId: 'u-nobody', role: 'member', holderIds: [] }
    await expect(applyAnalyticsScope({}, unbound)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('response filters', () => {
  it('keeps only rows owned by the member', () => {
    expect(filterCardsByHolder([{ holder_id: 'h-mine' }, { holder_id: 'h-other' }], ctx)).toEqual([{ holder_id: 'h-mine' }])
    expect(filterHolders([{ id: 'h-mine' }, { id: 'h-other' }], ctx)).toEqual([{ id: 'h-mine' }])
  })
  it('drops rows with no holder id instead of treating them as shared', () => {
    expect(filterCardsByHolder([{ holder_id: undefined }], ctx)).toEqual([])
  })
})

describe('benefit guard against real SQLite', () => {
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

  it('allows a member whose holder genuinely holds the product (two holders share it)', async () => {
    const ctx: MemberContext = { userId: 'u-x', role: 'member', holderIds: [FIXTURE_IDS.holders.family] }
    await expect(assertBenefitAccess(FIXTURE_IDS.benefits.cmbClassicLounge, ctx)).resolves.toBeUndefined()
  })

  it('rejects a member without a card of that product, even though the product exists', async () => {
    const ctx: MemberContext = { userId: 'u-x', role: 'member', holderIds: [FIXTURE_IDS.holders.memberSelf] }
    await expect(assertBenefitAccess(FIXTURE_IDS.benefits.cmbClassicLounge, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })

  it('rejects a member with no holder bindings at all (fail closed)', async () => {
    const ctx: MemberContext = { userId: 'u-x', role: 'member', holderIds: [] }
    await expect(assertBenefitAccess(FIXTURE_IDS.benefits.cmbClassicLounge, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })

  it('rejects a non-string benefit id', async () => {
    const ctx: MemberContext = { userId: 'u-x', role: 'member', holderIds: [FIXTURE_IDS.holders.family] }
    await expect(assertBenefitAccess(undefined, ctx)).rejects.toBeInstanceOf(MemberScopeError)
  })
})

describe('admin posture', () => {
  it('resolves admin context without looking up holder bindings', async () => {
    // Admins skip guards entirely, so buildMemberContext must not need a
    // holder binding for them; the route only consults it for members.
    setDb({ prepare() { throw new Error('admin path must not query the database') } } as unknown as D1Database)
    const admin = await buildMemberContext({ id: 'u-admin', role: 'admin' })
    expect(admin).toEqual({ userId: 'u-admin', role: 'admin', holderIds: [] })
  })

  it('the RPC route only runs memberGuard for members', () => {
    // Source-level invariant: the admin bypass lives in the route, not in each
    // guard, so every guard can assume a member context.
    const route = readFileSync(join(ROOT, 'app/api/rpc/[module]/[fn]/route.ts'), 'utf8')
    expect(route).toMatch(/if \(session\.role === 'member'\)/)
    expect(route).toMatch(/entry\.admin && session\.role !== 'admin'/)
  })
})
