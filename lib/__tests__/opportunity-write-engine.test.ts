// lib/__tests__/opportunity-write-engine.test.ts — the idempotent atomic
// command engine (tech spec §7), exercised against real SQLite with the
// checked-in D1 migrations, so batch rollback, CHECK enforcement and the
// event→projection trigger are the database's, never a mock's:
//   1. same key + same payload replays the committed result, writes one event set
//   2. same key + different payload → IDEMPOTENCY_CONFLICT, no side effects
//   3. a later event over quota rolls back command, earlier events, projection
//   4. UPDATE affecting 0 rows is NOT an error — revision guards must be batch assertions
//   5. another actor cannot replay or execute someone else's command key
//   6. reconcile replays the six dimensions and reports exact diffs, read-only

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import {
  seedOpportunityFixtures,
  seedOpportunityLedgerWorld,
  FIXTURE_IDS,
  LEDGER_IDS,
} from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  runOpportunityCommand,
  reconcileOpportunityCycle,
  type CommandSpec,
} from '../opportunities/writes.server'
import { canonicalJson, hashCommandPayload } from '../opportunities/hash'
import {
  OpportunityError,
  quotaExceeded,
  revisionConflict,
} from '../opportunities/errors'
import type { OpportunityActor } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const l = LEDGER_IDS

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }
const NOW = '2026-10-15T08:00:00Z'

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  await seedOpportunityLedgerWorld(db)
  setDb(db as unknown as D1Database)
})

// ---------------------------------------------------------------------------
// Test commands. These mirror how Task 9/10 impls will call the engine:
// assertions carry the batch-internal authorization/revision/quota guard,
// events carry the six-dimension deltas, statements are the mutable rows.
// ---------------------------------------------------------------------------

/** Server-side scope predicate for the in-batch authorization assertion. */
function holderScope(actor: OpportunityActor): { sql: string; binds: unknown[] } {
  return actor.role === 'admin'
    ? { sql: '(h.created_by = ? OR h.managed_by = ?)', binds: [actor.user_id, actor.user_id] }
    : { sql: 'h.auth_user_id = ?', binds: [actor.user_id] }
}

let usageSeq = 0

function recordUsageSpec(
  actor: OpportunityActor,
  opts: {
    key: string
    quantity: number
    accountId?: string
    cardId?: string
    usageId?: string
  },
): CommandSpec {
  const accountId = opts.accountId ?? l.accounts.self
  const cardId = opts.cardId ?? f.cards.selfMain
  const usageId = opts.usageId ?? `ousg-engine-${++usageSeq}`
  const scope = holderScope(actor)
  return {
    command_type: 'recordOpportunityUsage',
    request_key: opts.key,
    payload_fields: ['account_id', 'cycle_id', 'card_id', 'used_on', 'quantity', 'amount_minor'],
    payload: {
      account_id: accountId,
      cycle_id: l.cycles.self,
      card_id: cardId,
      used_on: '2026-10-10',
      quantity: opts.quantity,
      amount_minor: 0,
    },
    assertions: [
      {
        name: 'account-in-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_accounts a
          JOIN card_holders h ON h.id = a.holder_id
          WHERE a.id = ? AND ${scope.sql})`,
        binds: [accountId, ...scope.binds],
        violation: () => new OpportunityError('FORBIDDEN_OR_NOT_FOUND', '无权访问该资源，或资源不存在', {
          resource: 'account',
        }),
      },
      {
        name: 'quota-headroom',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_cycles c
          WHERE c.id = ? AND (c.count_limit IS NULL
            OR c.opening_used_count + c.used_count + c.reserved_count + ? <= c.count_limit))`,
        binds: [l.cycles.self, opts.quantity],
        violation: () => quotaExceeded({ cycle_id: l.cycles.self }),
      },
    ],
    events: [
      {
        entity_kind: 'usage',
        entity_id: usageId,
        event_type: 'usage.recorded',
        account_id: accountId,
        cycle_id: l.cycles.self,
        deltas: {
          delta_opening_count: 0,
          delta_opening_minor: 0,
          delta_used_count: opts.quantity,
          delta_used_minor: 0,
          delta_reserved_count: 0,
          delta_reserved_minor: 0,
        },
        after_json: { usage_id: usageId, quantity: opts.quantity },
      },
    ],
    statements: [
      db
        .prepare(
          `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, created_by, updated_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          usageId,
          accountId,
          l.cycles.self,
          cardId,
          '2026-10-10',
          opts.quantity,
          actor.user_id,
          actor.user_id,
          NOW,
          NOW,
        ),
    ],
    result: { usage_id: usageId, quantity: opts.quantity },
  }
}

function updateNoteSpec(
  actor: OpportunityActor,
  opts: { key: string; expectedRevision: number; note: string },
): CommandSpec {
  const scope = holderScope(actor)
  return {
    command_type: 'correctOpportunityUsageNote',
    request_key: opts.key,
    payload_fields: ['usage_id', 'note'],
    payload: { usage_id: l.usages.self, note: opts.note },
    assertions: [
      {
        // The spec §7.1 example assertion: usage active, revision as expected,
        // and the account's holder still inside the actor's scope.
        name: 'usage-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_usages u
          JOIN opportunity_accounts a ON a.id = u.account_id
          JOIN card_holders h ON h.id = a.holder_id
          WHERE u.id = ? AND u.revision = ? AND u.status = 'active' AND ${scope.sql})`,
        binds: [l.usages.self, opts.expectedRevision, ...scope.binds],
        violation: () => revisionConflict({ usage_id: l.usages.self }),
      },
    ],
    events: [
      {
        entity_kind: 'usage',
        entity_id: l.usages.self,
        event_type: 'usage.note_corrected',
        account_id: l.accounts.self,
        cycle_id: l.cycles.self,
        deltas: {
          delta_opening_count: 0,
          delta_opening_minor: 0,
          delta_used_count: 0,
          delta_used_minor: 0,
          delta_reserved_count: 0,
          delta_reserved_minor: 0,
        },
        before_json: { note: null },
        after_json: { note: opts.note },
      },
    ],
    statements: [
      db
        .prepare(
          `UPDATE opportunity_usages
           SET note = ?, revision = revision + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'active'`,
        )
        .bind(opts.note, actor.user_id, NOW, l.usages.self, opts.expectedRevision),
    ],
    result: { usage_id: l.usages.self, revision: opts.expectedRevision + 1, note: opts.note },
  }
}

// ---------------------------------------------------------------------------
// canonical hashing
// ---------------------------------------------------------------------------

describe('hashCommandPayload', () => {
  it('只哈希白名单字段，忽略客户端额外塞入的余额等字段', async () => {
    const a = await hashCommandPayload(['quantity', 'amount_minor'], {
      quantity: 2,
      amount_minor: 500,
      balance_used_count: 99, // must not participate
    })
    const b = await hashCommandPayload(['quantity', 'amount_minor'], {
      quantity: 2,
      amount_minor: 500,
    })
    expect(a).toBe(b)
  })

  it('对象键顺序与字段声明顺序不影响哈希', async () => {
    const a = await hashCommandPayload(['payload'], { payload: { z: 1, a: [3, { b: 2, a: 1 }] } })
    const b = await hashCommandPayload(['payload'], { payload: { a: [3, { a: 1, b: 2 }], z: 1 } })
    expect(a).toBe(b)
  })

  it('不同取值产生不同哈希', async () => {
    const a = await hashCommandPayload(['quantity'], { quantity: 1 })
    const b = await hashCommandPayload(['quantity'], { quantity: 2 })
    expect(a).not.toBe(b)
  })

  it('canonicalJson 拒绝非有限数字并丢弃 undefined 值', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow()
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow()
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })
})

// ---------------------------------------------------------------------------
// runOpportunityCommand
// ---------------------------------------------------------------------------

describe('runOpportunityCommand', () => {
  it('相同 key 同输入第二次重放已提交结果，只写一组事件', async () => {
    const spec = recordUsageSpec(actorAdminA, { key: 'k-usage-000000001', quantity: 2 })
    const first = await runOpportunityCommand<{ usage_id: string; quantity: number }>(
      actorAdminA,
      spec,
      { now: NOW },
    )
    expect(first.replayed).toBe(false)
    expect(first.result).toEqual({ usage_id: (spec.result as { usage_id: string }).usage_id, quantity: 2 })

    const second = await runOpportunityCommand(actorAdminA, spec, { now: NOW })
    expect(second.replayed).toBe(true)
    expect(second.result).toEqual(first.result)

    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get(),
    ).toEqual({ n: 1 })
    expect(
      db.raw
        .prepare('SELECT used_count, revision FROM opportunity_cycles WHERE id = ?')
        .get(l.cycles.self),
    ).toEqual({ used_count: 2, revision: 2 })
    expect(
      db.raw
        .prepare('SELECT COUNT(*) AS n FROM opportunity_usages WHERE id = ?')
        .get(first.result.usage_id),
    ).toEqual({ n: 1 })
  })

  it('同 key 改参数报 IDEMPOTENCY_CONFLICT，且无任何副作用', async () => {
    await runOpportunityCommand(actorAdminA, recordUsageSpec(actorAdminA, { key: 'k-usage-000000002', quantity: 1 }), { now: NOW })
    await expect(
      runOpportunityCommand(actorAdminA, recordUsageSpec(actorAdminA, { key: 'k-usage-000000002', quantity: 3 }), { now: NOW }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: 1 })
    expect(
      db.raw
        .prepare('SELECT used_count FROM opportunity_cycles WHERE id = ?')
        .get(l.cycles.self),
    ).toEqual({ used_count: 1 })
  })

  it('第二条事件超额时 command、第一条事件与投影全部回滚', async () => {
    // count_limit = 6; the command pushes two events (+3 then +4) so the
    // second event crosses the limit AFTER the first one succeeded in-batch.
    const spec: CommandSpec = {
      command_type: 'recordOpportunityUsage',
      request_key: 'k-usage-000000003',
      payload_fields: ['account_id', 'cycle_id', 'quantities'],
      payload: { account_id: l.accounts.self, cycle_id: l.cycles.self, quantities: [3, 4] },
      assertions: [
        {
          name: 'quota-headroom-total',
          sql: `EXISTS (
            SELECT 1 FROM opportunity_cycles c
            WHERE c.id = ? AND c.opening_used_count + c.used_count + c.reserved_count + 3 <= c.count_limit)`,
          binds: [l.cycles.self],
          violation: () => quotaExceeded({ cycle_id: l.cycles.self }),
        },
      ],
      events: [3, 4].map((q, i) => ({
        entity_kind: 'usage' as const,
        entity_id: `ousg-burst-${i}`,
        event_type: 'usage.recorded',
        account_id: l.accounts.self,
        cycle_id: l.cycles.self,
        deltas: {
          delta_opening_count: 0,
          delta_opening_minor: 0,
          delta_used_count: q,
          delta_used_minor: 0,
          delta_reserved_count: 0,
          delta_reserved_minor: 0,
        },
      })),
      statements: [],
      result: { created: 2 },
    }

    await expect(runOpportunityCommand(actorAdminA, spec, { now: NOW })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    })

    // Full rollback: no command row, no events, projection untouched.
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_commands WHERE request_key = ?")
        .get('k-usage-000000003'),
    ).toEqual({ n: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: 0 })
    expect(
      db.raw
        .prepare('SELECT used_count, revision FROM opportunity_cycles WHERE id = ?')
        .get(l.cycles.self),
    ).toEqual({ used_count: 0, revision: 1 })
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('裸 UPDATE 影响 0 行不报错——revision 防护必须走批内断言', async () => {
    // Control: an UPDATE matching 0 rows is NOT an SQL error in a batch…
    const res = await db.batch([
      db
        .prepare('UPDATE opportunity_usages SET revision = revision + 1 WHERE id = ? AND revision = ?')
        .bind(l.usages.self, 999),
    ])
    expect(res[0].meta.changes).toBe(0)
    expect(
      db.raw.prepare('SELECT revision FROM opportunity_usages WHERE id = ?').get(l.usages.self),
    ).toEqual({ revision: 1 }) // …so the row silently stays untouched.

    // Engine path: the batch assertion turns stale revision into an error.
    await expect(
      runOpportunityCommand(
        actorAdminA,
        updateNoteSpec(actorAdminA, { key: 'k-note-000000001', expectedRevision: 999, note: 'x' }),
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(
      db.raw.prepare('SELECT revision, note FROM opportunity_usages WHERE id = ?').get(l.usages.self),
    ).toEqual({ revision: 1, note: null })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: 0 })
  })

  it('其他用户无法用他人 key 执行或重放他人命令', async () => {
    const spec = recordUsageSpec(actorAdminA, { key: 'k-usage-000000004', quantity: 1 })
    const committed = await runOpportunityCommand<{ usage_id: string }>(actorAdminA, spec, { now: NOW })
    const firstUsageId = committed.result.usage_id

    // Admin B replays A's key with the same payload — but B's command table
    // view has no such key, so this executes as B, whose scope assertion
    // rejects A's account. B never sees A's committed result.
    await expect(
      runOpportunityCommand(
        actorAdminB,
        recordUsageSpec(actorAdminB, {
          key: 'k-usage-000000004',
          quantity: 1,
          usageId: firstUsageId,
        }),
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' })

    // …and A's original command still replays normally for A.
    const again = await runOpportunityCommand(actorAdminA, spec, { now: NOW })
    expect(again.replayed).toBe(true)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: 1 })
  })

  it('request_key 长度边界：16–128 合法，之外拒绝', async () => {
    const make = (key: string) => recordUsageSpec(actorAdminA, { key, quantity: 1 })
    await expect(runOpportunityCommand(actorAdminA, make('k'.repeat(15)), { now: NOW })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(runOpportunityCommand(actorAdminA, make('k'.repeat(16)), { now: NOW })).resolves.toMatchObject({
      replayed: false,
    })
    await expect(runOpportunityCommand(actorAdminA, make('k'.repeat(128)), { now: NOW })).resolves.toMatchObject({
      replayed: false,
    })
    await expect(runOpportunityCommand(actorAdminA, make('k'.repeat(129)), { now: NOW })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })

  it('成功后 write_checks 无残留；失败回滚后 command 与 checks 均无残留', async () => {
    const spec = recordUsageSpec(actorAdminA, { key: 'k-checks-0000001', quantity: 1 })
    const ok = await runOpportunityCommand(actorAdminA, spec, { now: NOW })
    expect(ok.replayed).toBe(false)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_write_checks').get()).toEqual({ n: 0 })
    const committed = db.raw
      .prepare('SELECT result_json FROM opportunity_commands WHERE actor_user_id = ? AND request_key = ?')
      .get(f.users.adminA, 'k-checks-0000001') as { result_json: string }
    expect(JSON.parse(committed.result_json)).toEqual(ok.result) // committed with the command

    await expect(
      runOpportunityCommand(
        actorAdminA,
        updateNoteSpec(actorAdminA, { key: 'k-checks-0000002', expectedRevision: 999, note: 'y' }),
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_commands WHERE request_key = ?")
        .get('k-checks-0000002'),
    ).toEqual({ n: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_write_checks').get()).toEqual({ n: 0 })
  })
})

// ---------------------------------------------------------------------------
// reconcileOpportunityCycle
// ---------------------------------------------------------------------------

describe('reconcileOpportunityCycle', () => {
  it('投影与事件重放一致时 ok', async () => {
    await runOpportunityCommand(
      actorAdminA,
      recordUsageSpec(actorAdminA, { key: 'k-usage-000000006', quantity: 2 }),
      { now: NOW },
    )
    const r = await reconcileOpportunityCycle(actorAdminA, l.cycles.self)
    expect(r.ok).toBe(true)
    expect(r.diffs).toEqual([])
  })

  it('投影漂移时返回具体差异与相关命令，且不修复投影', async () => {
    await runOpportunityCommand(
      actorAdminA,
      recordUsageSpec(actorAdminA, { key: 'k-usage-000000007', quantity: 2 }),
      { now: NOW },
    )
    db.raw.prepare('UPDATE opportunity_cycles SET used_count = used_count + 3 WHERE id = ?').run(
      l.cycles.self,
    )

    const r = await reconcileOpportunityCycle(actorAdminA, l.cycles.self)
    expect(r.ok).toBe(false)
    expect(r.diffs).toEqual([{ dimension: 'used_count', projected: 5, replayed: 2 }])
    const onlyEvent = db.raw
      .prepare('SELECT command_id FROM opportunity_events LIMIT 1')
      .get() as { command_id: string }
    expect(r.commands).toEqual([onlyEvent.command_id])
    // Read-only: the drift is still there.
    expect(
      db.raw.prepare('SELECT used_count FROM opportunity_cycles WHERE id = ?').get(l.cycles.self),
    ).toEqual({ used_count: 5 })
  })

  it('无权用户不能对他人账户的周期对账', async () => {
    await expect(reconcileOpportunityCycle(actorAdminB, l.cycles.self)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    })
  })
})
