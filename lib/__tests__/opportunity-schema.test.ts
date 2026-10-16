// lib/__tests__/opportunity-schema.test.ts — 0013 schema contract, exercised
// against real SQLite (CHECK/FK/triggers), not re-stated in JS. Covers:
//   - migration applies cleanly from empty and over existing data
//   - one active account-card link per (definition, card)
//   - quota 0 / NULL semantics and per-event ceiling CHECKs
//   - cycle↔version binding must match definition and version window
//   - immutable events / versions / account / cycle / link identity
//   - private-holder and card-ownership protection triggers

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createOpportunityDb,
  createSqliteD1,
  SQLITE_D1_MIGRATIONS_DIR,
  type SqliteD1,
} from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'

let db: SqliteD1

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
})

afterEach(() => {
  db.close()
})

const { users, holders, cards } = FIXTURE_IDS

function row<T = Record<string, unknown>>(sql: string, ...params: (string | number | null)[]): T | null {
  return (db.raw.prepare(sql).get(...params) as T) ?? null
}

// ---- minimal insertion helpers (schema tests speak SQL directly) ----

async function insertDefinition(overrides: Record<string, unknown> = {}): Promise<void> {
  const d = {
    id: 'def-1',
    kind: 'benefit',
    legacy_benefit_id: null as string | null,
    legacy_promo_id: null as string | null,
    visibility: 'shared',
    private_holder_id: null as string | null,
    created_by: users.adminA,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_definitions
         (id, kind, legacy_benefit_id, legacy_promo_id, visibility, private_holder_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(d.id, d.kind, d.legacy_benefit_id, d.legacy_promo_id, d.visibility, d.private_holder_id, d.created_by, d.created_at)
    .run()
}

async function insertVersion(overrides: Record<string, unknown> = {}): Promise<void> {
  const v = {
    id: 'rv-1',
    definition_id: 'def-1',
    version: 1,
    effective_from: '2026-01-01',
    effective_until_before: null as string | null,
    rules_json: '{"v":1}',
    verification: 'unverified',
    published_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_rule_versions
         (id, definition_id, version, effective_from, effective_until_before, rules_json, verification, published_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(v.id, v.definition_id, v.version, v.effective_from, v.effective_until_before, v.rules_json, v.verification, v.published_at)
    .run()
}

async function insertAccount(overrides: Record<string, unknown> = {}): Promise<void> {
  const a = {
    id: 'acc-1',
    definition_id: 'def-1',
    holder_id: holders.self,
    scope_kind: 'card',
    scope_key: `card:${cards.selfMain}`,
    created_by: users.adminA,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_accounts
         (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(a.id, a.definition_id, a.holder_id, a.scope_kind, a.scope_key, a.created_by, a.created_at)
    .run()
}

async function insertLink(overrides: Record<string, unknown> = {}): Promise<void> {
  const l = {
    account_id: 'acc-1',
    definition_id: 'def-1',
    holder_id: holders.self,
    card_id: cards.selfMain,
    retired_at: null as string | null,
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_account_cards
         (account_id, definition_id, holder_id, card_id, retired_at)
       VALUES (?,?,?,?,?)`,
    )
    .bind(l.account_id, l.definition_id, l.holder_id, l.card_id, l.retired_at)
    .run()
}

interface CycleOptions {
  id?: string
  account_id?: string
  version_id?: string
  version_as_of_on?: string
  cycle_key?: string
  allocation_kind?: 'regular' | 'grant'
  period_start_on?: string
  period_end_before?: string | null
  usable_start_on?: string
  usable_end_before?: string | null
  count_limit?: number | null
}

async function insertCycle(overrides: CycleOptions = {}): Promise<void> {
  const c = {
    id: 'cyc-1',
    account_id: 'acc-1',
    version_id: 'rv-1',
    version_as_of_on: '2026-10-01',
    cycle_key: '2026-10',
    allocation_kind: 'regular' as 'regular' | 'grant',
    period_start_on: '2026-10-01',
    period_end_before: '2026-11-01' as string | null,
    usable_start_on: '2026-10-01',
    usable_end_before: '2026-11-01' as string | null,
    time_zone: 'Asia/Shanghai',
    count_limit: 6 as number | null,
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_cycles
         (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
          period_start_on, period_end_before, usable_start_on, usable_end_before,
          time_zone, count_limit, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'2026-10-01T00:00:00Z')`,
    )
    .bind(
      c.id,
      c.account_id,
      c.version_id,
      c.version_as_of_on,
      c.cycle_key,
      c.allocation_kind,
      c.period_start_on,
      c.period_end_before,
      c.usable_start_on,
      c.usable_end_before,
      c.time_zone,
      c.count_limit,
    )
    .run()
}

async function insertUsage(overrides: Record<string, unknown> = {}): Promise<void> {
  const u = {
    id: 'usg-1',
    account_id: 'acc-1',
    cycle_id: 'cyc-1',
    card_id: cards.selfMain,
    used_on: '2026-10-05',
    quantity: 1,
    created_by: users.adminA,
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_usages
         (id, account_id, cycle_id, card_id, used_on, quantity, created_by, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(u.id, u.account_id, u.cycle_id, u.card_id, u.used_on, u.quantity, u.created_by, u.created_by, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')
    .run()
}

async function insertCommand(overrides: Record<string, unknown> = {}): Promise<void> {
  const c = {
    id: 'cmd-1',
    actor_user_id: users.adminA,
    request_key: 'rq-1',
    request_hash: 'hash-1',
    command_type: 'record_usage',
    created_at: '2026-10-05T00:00:00Z',
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_commands (id, actor_user_id, request_key, request_hash, command_type, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(c.id, c.actor_user_id, c.request_key, c.request_hash, c.command_type, c.created_at)
    .run()
}

interface EventOptions {
  id?: string
  command_id?: string
  entity_kind?: 'account' | 'usage' | 'cycle' | 'task' | 'fulfillment' | 'legacy'
  entity_id?: string
  event_type?: string
  account_id?: string | null
  cycle_id?: string | null
  delta_opening_count?: number
  delta_opening_minor?: number
  delta_used_count?: number
  delta_used_minor?: number
  delta_reserved_count?: number
  delta_reserved_minor?: number
}

async function insertEvent(overrides: EventOptions = {}): Promise<void> {
  const e = {
    id: 'ev-1',
    command_id: 'cmd-1',
    entity_kind: 'usage',
    entity_id: 'usg-1',
    event_type: 'usage.recorded',
    account_id: 'acc-1' as string | null,
    cycle_id: 'cyc-1' as string | null,
    delta_opening_count: 0,
    delta_opening_minor: 0,
    delta_used_count: 1,
    delta_used_minor: 0,
    delta_reserved_count: 0,
    delta_reserved_minor: 0,
    ...overrides,
  }
  await db
    .prepare(
      `INSERT INTO opportunity_events
         (id, command_id, entity_kind, entity_id, event_type, account_id, cycle_id,
          delta_opening_count, delta_opening_minor, delta_used_count, delta_used_minor,
          delta_reserved_count, delta_reserved_minor, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'2026-10-05T00:00:00Z')`,
    )
    .bind(
      e.id,
      e.command_id,
      e.entity_kind,
      e.entity_id,
      e.event_type,
      e.account_id,
      e.cycle_id,
      e.delta_opening_count,
      e.delta_opening_minor,
      e.delta_used_count,
      e.delta_used_minor,
      e.delta_reserved_count,
      e.delta_reserved_minor,
    )
    .run()
}

/** A second account on the same definition but scoped to the whole holder. */
async function insertHolderAccount(): Promise<void> {
  await insertAccount({ id: 'acc-holder', scope_kind: 'holder', scope_key: `holder:${holders.self}` })
}

/** Build the minimal consistent world def-1/rv-1/acc-1/link/cyc-1 for mutation tests. */
async function seedMinimalWorld(): Promise<void> {
  await insertDefinition()
  await insertVersion()
  await insertAccount()
  await insertLink()
  await insertCycle()
  await insertCommand()
}

describe('0013 applies cleanly and preserves existing data', () => {
  it('applies to an empty database with no foreign-key violations', () => {
    const fresh = createOpportunityDb() // all migrations, including 0013
    expect(fresh.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    fresh.close()
  })

  it('keeps pre-0013 rows and ids intact when upgrading seeded data', async () => {
    const upgrading = createSqliteD1()
    const oldFiles = readdirSync(SQLITE_D1_MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f < '0013')
      .sort()
    for (const f of oldFiles) upgrading.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, f), 'utf8'))
    await seedOpportunityFixtures(upgrading)

    const cardsBefore = (upgrading.raw.prepare('SELECT id FROM credit_cards ORDER BY id').all() as { id: string }[]).map((r) => r.id)
    const usersBefore = upgrading.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }

    const newFiles = readdirSync(SQLITE_D1_MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f >= '0013')
      .sort()
    expect(newFiles).toContain('0013_opportunity_accounts_ledger.sql')
    for (const f of newFiles) upgrading.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, f), 'utf8'))

    const cardsAfter = (upgrading.raw.prepare('SELECT id FROM credit_cards ORDER BY id').all() as { id: string }[]).map((r) => r.id)
    const usersAfter = upgrading.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    expect(cardsAfter).toEqual(cardsBefore)
    expect(usersAfter.n).toBe(usersBefore.n)
    expect(upgrading.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    upgrading.close()
  })

  it('adds nullable issued_on / activated_on to credit_cards', async () => {
    const card = row<{ issued_on: string | null; activated_on: string | null }>(
      'SELECT issued_on, activated_on FROM credit_cards WHERE id=?',
      cards.selfMain,
    )
    expect(card).toEqual({ issued_on: null, activated_on: null })
    await db.prepare('UPDATE credit_cards SET issued_on=? WHERE id=?').bind('2022-06-01', cards.selfMain).run()
    expect(row<{ issued_on: string }>('SELECT issued_on FROM credit_cards WHERE id=?', cards.selfMain)?.issued_on).toBe('2022-06-01')
  })
})

describe('account-card links: one active link per definition and card', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
  })

  it('rejects a second active link for the same card and definition', async () => {
    await insertHolderAccount()
    await expect(insertLink({ account_id: 'acc-holder' })).rejects.toThrow(/UNIQUE/)
  })

  it('allows the same card+definition to link again once the old link is retired', async () => {
    await insertHolderAccount()
    await expect(insertLink({ account_id: 'acc-holder' })).rejects.toThrow(/UNIQUE/)
    await db
      .prepare('UPDATE opportunity_account_cards SET retired_at=? WHERE account_id=? AND card_id=?')
      .bind('2026-10-10T00:00:00Z', 'acc-1', cards.selfMain)
      .run()
    await insertLink({ account_id: 'acc-holder' })
    const active = db.raw
      .prepare('SELECT COUNT(*) AS n FROM opportunity_account_cards WHERE retired_at IS NULL AND card_id=?')
      .get(cards.selfMain) as { n: number }
    expect(active.n).toBe(1)
  })

  it('a second account on the same definition+scope is rejected by scope_key uniqueness', async () => {
    await expect(
      insertAccount({ id: 'acc-dup-scope', scope_key: `card:${cards.selfMain}` }),
    ).rejects.toThrow(/UNIQUE/)
  })

  it('rejects a link whose holder does not own the card or account', async () => {
    await expect(
      insertLink({ holder_id: holders.family, card_id: cards.selfSecond }),
    ).rejects.toThrow(/FOREIGN KEY/)
    await insertDefinition({ id: 'def-2' })
    await expect(
      insertLink({ definition_id: 'def-2', card_id: cards.selfSecond }),
    ).rejects.toThrow(/FOREIGN KEY/)
  })
})

describe('cycles: quota semantics and version binding', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
  })

  it('accepts count_limit 0 and NULL as unlimited', async () => {
    await insertCycle({ id: 'cyc-0', cycle_key: '2026-11', version_as_of_on: '2026-11-01', period_start_on: '2026-11-01', period_end_before: null, usable_start_on: '2026-11-01', usable_end_before: null, count_limit: 0 })
    await insertCycle({ id: 'cyc-null', cycle_key: '2026-12', version_as_of_on: '2026-12-01', period_start_on: '2026-12-01', period_end_before: null, usable_start_on: '2026-12-01', usable_end_before: null, count_limit: null })
    const limits = db.raw
      .prepare("SELECT id, count_limit FROM opportunity_cycles WHERE id IN ('cyc-0','cyc-null')")
      .all() as { id: string; count_limit: number | null }[]
    expect(limits).toEqual([
      { id: 'cyc-0', count_limit: 0 },
      { id: 'cyc-null', count_limit: null },
    ])
  })

  it('rejects a cycle bound to another definition version', async () => {
    await insertDefinition({ id: 'def-2' })
    await insertVersion({ id: 'rv-2', definition_id: 'def-2' })
    await expect(
      insertCycle({ id: 'cyc-bad', cycle_key: 'x1', version_id: 'rv-2' }),
    ).rejects.toThrow('OPPORTUNITY_CYCLE_VERSION_MISMATCH')
  })

  it('rejects version_as_of_on outside the version window', async () => {
    await expect(
      insertCycle({ id: 'cyc-early', cycle_key: 'x1', version_as_of_on: '2025-12-31', period_start_on: '2025-12-31' }),
    ).rejects.toThrow('OPPORTUNITY_CYCLE_VERSION_MISMATCH')
  })

  it('rejects events that push a cycle past its limit', async () => {
    await insertCycle({ id: 'cyc-0', cycle_key: '2026-11', version_as_of_on: '2026-11-01', period_start_on: '2026-11-01', period_end_before: '2026-12-01', usable_start_on: '2026-11-01', usable_end_before: '2026-12-01', count_limit: 0 })
    await insertUsage({ id: 'usg-0', cycle_id: 'cyc-0' })
    await insertCommand({ id: 'cmd-0', request_key: 'rq-0' })
    await expect(
      insertEvent({ id: 'ev-0', command_id: 'cmd-0', entity_id: 'usg-0', cycle_id: 'cyc-0', delta_used_count: 1 }),
    ).rejects.toThrow(/CHECK constraint failed/)
    expect(row<{ used_count: number }>('SELECT used_count FROM opportunity_cycles WHERE id=?', 'cyc-0')?.used_count).toBe(0)
  })
})

describe('rule versions: immutability and non-overlap', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
  })

  it('cannot update or delete published version content', async () => {
    await expect(
      db.prepare('UPDATE opportunity_rule_versions SET rules_json=? WHERE id=?').bind('{"v":2}', 'rv-1').run(),
    ).rejects.toThrow('OPPORTUNITY_IMMUTABLE_VERSION')
    await expect(
      db.prepare('DELETE FROM opportunity_rule_versions WHERE id=?').bind('rv-1').run(),
    ).rejects.toThrow('OPPORTUNITY_IMMUTABLE_VERSION')
  })

  it('rejects overlapping effective windows; adjacent half-open windows are fine', async () => {
    await expect(
      insertVersion({ id: 'rv-overlap', version: 2, effective_from: '2026-06-01', effective_until_before: '2027-01-01' }),
    ).rejects.toThrow('OPPORTUNITY_VERSION_OVERLAP')
    // Close rv-1 first (cyc-1 as-of 2026-10-01 stays covered), then rv-2 may start exactly at the end:
    await db.prepare('UPDATE opportunity_rule_versions SET effective_until_before=? WHERE id=?').bind('2026-11-01', 'rv-1').run()
    await insertVersion({ id: 'rv-2', version: 2, effective_from: '2026-11-01' })
  })

  it('closing effective_until_before cannot be loosened or strand existing cycles', async () => {
    // rv-1 is open-ended; a close that would exclude cyc-1 (as-of 2026-10-01) is refused:
    await expect(
      db.prepare('UPDATE opportunity_rule_versions SET effective_until_before=? WHERE id=?').bind('2026-09-01', 'rv-1').run(),
    ).rejects.toThrow('OPPORTUNITY_VERSION_END_CONFLICT')
    // A close that still covers the cycle succeeds, and reopening it is then refused:
    await db.prepare('UPDATE opportunity_rule_versions SET effective_until_before=? WHERE id=?').bind('2026-11-01', 'rv-1').run()
    await expect(
      db.prepare('UPDATE opportunity_rule_versions SET effective_until_before=NULL WHERE id=?').bind('rv-1').run(),
    ).rejects.toThrow('OPPORTUNITY_VERSION_END_CONFLICT')
  })
})

describe('definitions and accounts: identity and private-holder guards', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
  })

  it('definition CHECKs: private needs holder, private_reward must be private, created_by only optional for legacy rows', async () => {
    await expect(
      insertDefinition({ id: 'def-bad-1', visibility: 'private', private_holder_id: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDefinition({ id: 'def-bad-2', kind: 'private_reward' }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDefinition({ id: 'def-bad-3', created_by: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    // Legacy-wrapped definitions may carry created_by NULL:
    await insertDefinition({ id: 'def-legacy', created_by: null, legacy_benefit_id: FIXTURE_IDS.benefits.cmbClassicLounge })
  })

  it('an account on a private definition must use the private holder', async () => {
    await insertDefinition({ id: 'def-priv', visibility: 'private', private_holder_id: holders.self })
    await expect(
      insertAccount({ id: 'acc-priv-bad', definition_id: 'def-priv', holder_id: holders.family, scope_key: `holder:${holders.family}` }),
    ).rejects.toThrow('OPPORTUNITY_PRIVATE_HOLDER_MISMATCH')
    await insertAccount({ id: 'acc-priv-ok', definition_id: 'def-priv', holder_id: holders.self, scope_key: `holder:${holders.self}` })
  })

  it('account / cycle / link identity columns are immutable', async () => {
    await expect(
      db.prepare('UPDATE opportunity_accounts SET holder_id=? WHERE id=?').bind(holders.family, 'acc-1').run(),
    ).rejects.toThrow('OPPORTUNITY_ACCOUNT_IDENTITY_IMMUTABLE')
    await expect(
      db.prepare('UPDATE opportunity_accounts SET scope_key=? WHERE id=?').bind('card:other', 'acc-1').run(),
    ).rejects.toThrow('OPPORTUNITY_ACCOUNT_IDENTITY_IMMUTABLE')
    await expect(
      db.prepare('UPDATE opportunity_cycles SET period_start_on=? WHERE id=?').bind('2026-09-01', 'cyc-1').run(),
    ).rejects.toThrow('OPPORTUNITY_CYCLE_IDENTITY_IMMUTABLE')
    await expect(
      db.prepare('UPDATE opportunity_cycles SET count_limit=? WHERE id=?').bind(12, 'cyc-1').run(),
    ).rejects.toThrow('OPPORTUNITY_CYCLE_IDENTITY_IMMUTABLE')
    await expect(
      db.prepare('UPDATE opportunity_account_cards SET card_id=? WHERE account_id=? AND card_id=?').bind(cards.selfSecond, 'acc-1', cards.selfMain).run(),
    ).rejects.toThrow('OPPORTUNITY_CARD_LINK_IMMUTABLE')
  })

  it('blocks moving a card to another holder while an opportunity link exists', async () => {
    await expect(
      db.prepare('UPDATE credit_cards SET holder_id=? WHERE id=?').bind(holders.family, cards.selfMain).run(),
    ).rejects.toThrow('OPPORTUNITY_CARD_OWNERSHIP_CONFLICT')
    // Cards without links still move freely:
    await db.prepare('UPDATE credit_cards SET holder_id=? WHERE id=?').bind(holders.self, cards.familyClassic).run()
  })
})

describe('events: immutability, projection, and shape CHECKs', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
    await insertUsage()
  })

  it('cannot be updated or deleted', async () => {
    await insertEvent()
    await expect(
      db.prepare('UPDATE opportunity_events SET reason=? WHERE id=?').bind('tamper', 'ev-1').run(),
    ).rejects.toThrow('OPPORTUNITY_IMMUTABLE_EVENT')
    await expect(
      db.prepare('DELETE FROM opportunity_events WHERE id=?').bind('ev-1').run(),
    ).rejects.toThrow('OPPORTUNITY_IMMUTABLE_EVENT')
  })

  it('applies six-dimension deltas to the cycle projection and bumps revision', async () => {
    await insertEvent({ delta_used_count: 2, delta_used_minor: 1500 })
    await insertCommand({ id: 'cmd-2', request_key: 'rq-2', request_hash: 'hash-2' })
    await insertEvent({
      id: 'ev-2',
      command_id: 'cmd-2',
      delta_used_count: 0,
      delta_reserved_count: 1,
      delta_reserved_minor: 500,
    })
    const cycle = row<{
      used_count: number
      used_minor: number
      reserved_count: number
      reserved_minor: number
      opening_used_count: number
      revision: number
    }>('SELECT used_count, used_minor, reserved_count, reserved_minor, opening_used_count, revision FROM opportunity_cycles WHERE id=?', 'cyc-1')
    expect(cycle).toMatchObject({
      used_count: 2,
      used_minor: 1500,
      reserved_count: 1,
      reserved_minor: 500,
      opening_used_count: 0,
      revision: 3, // 1 initial + 2 events
    })
  })

  it('events without cycle must carry zero deltas; events with cycle must carry account', async () => {
    await expect(
      insertEvent({ id: 'ev-nocycle', cycle_id: null, account_id: null, delta_used_count: 1 }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertEvent({ id: 'ev-cycle-noacct', account_id: null, cycle_id: 'cyc-1' }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await insertEvent({ id: 'ev-ok', cycle_id: null, account_id: null, delta_used_count: 0 })
  })
})

describe('usages and commands: real foreign keys and uniqueness', () => {
  beforeEach(async () => {
    await seedMinimalWorld()
  })

  it('a usage must reference an actual account-card link', async () => {
    await expect(insertUsage({ card_id: cards.selfSecond })).rejects.toThrow(/FOREIGN KEY/)
    await expect(insertUsage({ cycle_id: 'nope' })).rejects.toThrow(/FOREIGN KEY/)
    await insertUsage() // the linked card works
  })

  it('commands are unique per actor and request key; write_checks only ok=1', async () => {
    await insertCommand({ id: 'cmd-a', request_key: 'dup' })
    await expect(insertCommand({ id: 'cmd-b', request_key: 'dup' })).rejects.toThrow(/UNIQUE/)
    await insertCommand({ id: 'cmd-c', request_key: 'other' })
    await db
      .prepare('INSERT INTO opportunity_write_checks (command_id, ok) VALUES (?,1)')
      .bind('cmd-c')
      .run()
    await expect(
      db.prepare('INSERT INTO opportunity_write_checks (command_id, ok) VALUES (?,0)').bind('cmd-a').run(),
    ).rejects.toThrow(/CHECK constraint failed/)
  })
})
