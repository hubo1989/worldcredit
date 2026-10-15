// lib/opportunities/writes.server.ts — the idempotent atomic command engine
// (tech spec §7). Every ledger mutation — usages, opening verification,
// corrections, voids, and later tasks/fulfillments — goes through
// runOpportunityCommand so that:
//
//   1. INSERT opportunity_commands
//   2. INSERT opportunity_write_checks — each precondition becomes a row whose
//      `ok` CHECK turns “not satisfied” into a hard SQL error, so an UPDATE
//      matching 0 rows or a concurrent revision bump can never pass silently
//   3. INSERT opportunity_events — the AFTER-INSERT trigger projects the six
//      dimensions onto the cycle, whose own CHECKs refuse over-quota/negative
//      totals by aborting the whole batch
//   4. caller statements — mutable rows (usages, fulfillments, …)
//   5. the temporary write_checks rows are deleted
//
// all inside ONE db.batch() — D1 runs a batch as a transaction and rolls back
// everything on the first failure, so a failed command leaves no half-work.
// Retries with the same request_key + payload replay the committed result;
// a different payload under the same key is an IDEMPOTENCY_CONFLICT.

/// <reference types="@cloudflare/workers-types" />

import { getDb } from '../db/client'
import type { OpportunityActor, OpportunityEventDeltas, OpportunityEventEntityKind } from './types'
import { ZERO_EVENT_DELTAS } from './types'
import {
  OpportunityError,
  quotaExceeded,
  idempotencyConflict,
} from './errors'
import { assertAccountAccess } from './scope.server'
import { hashCommandPayload } from './hash'

// ---------------------------------------------------------------------------
// Command specification
// ---------------------------------------------------------------------------

/** One immutable ledger event. Deltas are integers in minor units. */
export interface EventDraft {
  entity_kind: OpportunityEventEntityKind
  entity_id: string
  event_type: string
  account_id: string | null
  cycle_id: string | null
  deltas: OpportunityEventDeltas
  before_json?: unknown
  after_json?: unknown
  reason?: string | null
}

/**
 * A batch-internal precondition. `sql` must be a single boolean expression
 * over the database's CURRENT committed state (parameterized via `binds`);
 * the engine wraps it into a write_checks row whose CHECK(ok=1) aborts the
 * batch when it evaluates false. `violation` re-reads the (now rolled-back)
 * state to classify the failure into an actionable error.
 */
export interface WriteAssertion {
  name: string
  sql: string
  binds: unknown[]
  violation: () => OpportunityError | Promise<OpportunityError>
}

export interface CommandSpec {
  command_type: string
  /** 16–128 chars, unique per actor. */
  request_key: string
  /** Whitelist of payload fields covered by the request hash, in any order. */
  payload_fields: readonly string[]
  payload: Record<string, unknown>
  assertions: readonly WriteAssertion[]
  events: readonly EventDraft[]
  /** Mutable-row statements executed after events, inside the same batch. */
  statements: readonly D1PreparedStatement[]
  /** Canonical success result, committed with the command for replays. */
  result: object
}

export interface CommandOutcome<R extends object> {
  /** true when a previously committed command with this key was replayed. */
  replayed: boolean
  result: R
}

export interface RunOptions {
  /** RFC3339 timestamp for command/event rows. Defaults to now. */
  now?: string
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function validateSpec(spec: CommandSpec): void {
  if (
    typeof spec.request_key !== 'string' ||
    spec.request_key.length < 16 ||
    spec.request_key.length > 128
  ) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 request_key 不合法（长度 16–128）', {
      field: 'request_key',
    })
  }
  if (typeof spec.command_type !== 'string' || spec.command_type.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 command_type 不合法', {
      field: 'command_type',
    })
  }
  for (const event of spec.events) {
    for (const [field, value] of Object.entries(event.deltas)) {
      if (!Number.isInteger(value)) {
        throw new OpportunityError('VALIDATION_FAILED', `事件 ${event.event_type} 的 ${field} 必须是整数`, {
          field,
        })
      }
    }
    // Table CHECK: a cycle-scoped event must name its account.
    if (event.cycle_id !== null && event.account_id === null) {
      throw new OpportunityError('VALIDATION_FAILED', `事件 ${event.event_type} 关联周期时必须提供 account_id`, {
        event_type: event.event_type,
      })
    }
  }
}

function eventStatement(
  db: D1Database,
  event: EventDraft,
  commandId: string,
  now: string,
): D1PreparedStatement {
  const d = { ...ZERO_EVENT_DELTAS, ...event.deltas }
  return db
    .prepare(
      `INSERT INTO opportunity_events (
         id, command_id, entity_kind, entity_id, event_type, account_id, cycle_id,
         delta_opening_count, delta_opening_minor,
         delta_used_count, delta_used_minor,
         delta_reserved_count, delta_reserved_minor,
         before_json, after_json, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      `evt_${crypto.randomUUID()}`,
      commandId,
      event.entity_kind,
      event.entity_id,
      event.event_type,
      event.account_id,
      event.cycle_id,
      d.delta_opening_count,
      d.delta_opening_minor,
      d.delta_used_count,
      d.delta_used_minor,
      d.delta_reserved_count,
      d.delta_reserved_minor,
      event.before_json === undefined ? null : JSON.stringify(event.before_json),
      event.after_json === undefined ? null : JSON.stringify(event.after_json),
      event.reason ?? null,
      now,
    )
}

interface CommittedCommandRow {
  id: string
  request_hash: string
  result_json: string | null
}

async function readCommittedCommand(
  actorUserId: string,
  requestKey: string,
): Promise<CommittedCommandRow | null> {
  return getDb()
    .prepare(
      'SELECT id, request_hash, result_json FROM opportunity_commands WHERE actor_user_id = ? AND request_key = ?',
    )
    .bind(actorUserId, requestKey)
    .first<CommittedCommandRow>()
}

/**
 * Same-key replay probe for service functions to run BEFORE their own
 * mutable-state pre-read validations: once a command with this (actor, key)
 * has committed, its stored result is the answer regardless of any state
 * change since. A committed key with a different payload is an immediate
 * IDEMPOTENCY_CONFLICT; no committed row returns null (execute normally).
 */
export async function replayCommittedResult<R extends object>(
  actor: OpportunityActor,
  requestKey: string,
  payloadFields: readonly string[],
  payload: Record<string, unknown>,
): Promise<R | null> {
  const requestHash = await hashCommandPayload(payloadFields, payload)
  const committed = await readCommittedCommand(actor.user_id, requestKey)
  if (!committed) return null
  if (committed.request_hash !== requestHash) throw idempotencyConflict(requestKey)
  if (committed.result_json === null) {
    throw new OpportunityError('DATABASE_UNAVAILABLE', '已提交命令缺少结果，请稍后重试')
  }
  return JSON.parse(committed.result_json) as R
}

/**
 * Executes one ledger command atomically and idempotently. A same-key retry
 * with identical payload returns the committed result untouched; any batch
 * failure leaves zero rows behind and throws a classified OpportunityError.
 */
export async function runOpportunityCommand<R extends object>(
  actor: OpportunityActor,
  spec: CommandSpec,
  opts: RunOptions = {},
): Promise<CommandOutcome<R>> {
  validateSpec(spec)
  const db = getDb()
  const now = opts.now ?? new Date().toISOString()
  const requestHash = await hashCommandPayload(spec.payload_fields, spec.payload)

  const committed = await readCommittedCommand(actor.user_id, spec.request_key)
  if (committed) {
    if (committed.request_hash !== requestHash) throw idempotencyConflict(spec.request_key)
    // A committed row always carries its result: the batch that inserted the
    // command also wrote result_json, and a failed batch is rolled back whole.
    if (committed.result_json === null) {
      throw new OpportunityError('DATABASE_UNAVAILABLE', '已提交命令缺少结果，请稍后重试')
    }
    return { replayed: true, result: JSON.parse(committed.result_json) as R }
  }

  const commandId = `cmd_${crypto.randomUUID()}`
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO opportunity_commands (id, actor_user_id, request_key, request_hash, command_type, result_json, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        commandId,
        actor.user_id,
        spec.request_key,
        requestHash,
        spec.command_type,
        JSON.stringify(spec.result),
        now,
      ),
    // One write_checks row per command (command_id is its PRIMARY KEY): all
    // preconditions AND together into the single CHECK-guarded row.
    ...(spec.assertions.length
      ? [
          db
            .prepare(
              `INSERT INTO opportunity_write_checks (command_id, ok) SELECT ?, CASE WHEN ${spec.assertions
                .map((a) => `(${a.sql})`)
                .join(' AND ')} THEN 1 ELSE 0 END`,
            )
            .bind(commandId, ...spec.assertions.flatMap((a) => a.binds)),
        ]
      : []),
    ...spec.events.map((e) => eventStatement(db, e, commandId, now)),
    ...spec.statements,
    db.prepare('DELETE FROM opportunity_write_checks WHERE command_id = ?').bind(commandId),
  ]

  try {
    await db.batch(statements)
    return { replayed: false, result: spec.result as R }
  } catch (err) {
    const outcome = await interpretBatchFailure<R>(actor, spec, requestHash, err)
    if (outcome instanceof OpportunityError) throw outcome
    return outcome
  }
}

/**
 * Turns a raw batch error into either a replay outcome (a concurrent request
 * committed this exact command first) or a classified OpportunityError.
 * Never swallows the failure: unknown errors surface as DATABASE_UNAVAILABLE
 * without leaking internal SQL text.
 */
async function interpretBatchFailure<R extends object>(
  actor: OpportunityActor,
  spec: CommandSpec,
  requestHash: string,
  err: unknown,
): Promise<CommandOutcome<R> | OpportunityError> {
  const message = err instanceof Error ? err.message : String(err)

  // Another request committed the same (actor, request_key) between our read
  // and the batch: identical payload means a successful retry, not a conflict.
  if (message.includes('UNIQUE constraint failed') && message.includes('opportunity_commands')) {
    const committed = await readCommittedCommand(actor.user_id, spec.request_key)
    if (committed && committed.request_hash === requestHash && committed.result_json !== null) {
      return { replayed: true, result: JSON.parse(committed.result_json) as R }
    }
    if (committed) throw idempotencyConflict(spec.request_key)
    return new OpportunityError('DATABASE_UNAVAILABLE', '命令提交状态异常，请重试')
  }

  if (message.includes('CHECK constraint failed')) {
    // Re-evaluate the assertions against the rolled-back state: the first
    // unsatisfied one names the actionable error.
    const db = getDb()
    for (const assertion of spec.assertions) {
      const row = await db
        .prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS ok`)
        .bind(...assertion.binds)
        .first<{ ok: number }>()
      if (!row || row.ok !== 1) return await assertion.violation()
    }
    // All preconditions hold, so this is a projection CHECK: the six-dimension
    // totals crossed count_limit/amount_limit or went negative mid-batch.
    return quotaExceeded({ command_type: spec.command_type })
  }

  if (message.includes('FOREIGN KEY constraint failed')) {
    return new OpportunityError('VALIDATION_FAILED', '关联对象不存在或关系不匹配', {
      command_type: spec.command_type,
    })
  }

  return new OpportunityError('DATABASE_UNAVAILABLE', '数据库暂时不可用，请使用同一请求键重试')
}

// ---------------------------------------------------------------------------
// Reconciliation (tech spec §7.3)
// ---------------------------------------------------------------------------

const RECONCILE_DIMENSIONS = [
  { dimension: 'opening_used_count', delta: 'delta_opening_count' },
  { dimension: 'opening_used_minor', delta: 'delta_opening_minor' },
  { dimension: 'used_count', delta: 'delta_used_count' },
  { dimension: 'used_minor', delta: 'delta_used_minor' },
  { dimension: 'reserved_count', delta: 'delta_reserved_count' },
  { dimension: 'reserved_minor', delta: 'delta_reserved_minor' },
] as const

export interface CycleDimensionDiff {
  dimension: string
  projected: number
  replayed: number
}

export interface CycleReconciliation {
  cycle_id: string
  ok: boolean
  diffs: CycleDimensionDiff[]
  /** Distinct commands whose events touched the cycle (only when drifting). */
  commands: string[]
}

/**
 * Read-only: replays the cycle's events and compares the six-dimension
 * totals against the cycle projection. Reports exact diffs and the commands
 * involved; never repairs the projection or swallows errors.
 */
export async function reconcileOpportunityCycle(
  actor: OpportunityActor,
  cycleId: string,
): Promise<CycleReconciliation> {
  const db = getDb()
  const cycle = await db
    .prepare('SELECT id, account_id FROM opportunity_cycles WHERE id = ?')
    .bind(cycleId)
    .first<{ id: string; account_id: string }>()
  if (!cycle) throw new OpportunityError('FORBIDDEN_OR_NOT_FOUND', '无权访问该资源，或资源不存在', { resource: 'cycle' })
  await assertAccountAccess(cycle.account_id, actor)

  const selectColumns = RECONCILE_DIMENSIONS.map((d) => d.dimension).join(', ')
  const projectedRow = await db
    .prepare(`SELECT ${selectColumns} FROM opportunity_cycles WHERE id = ?`)
    .bind(cycleId)
    .first<Record<string, number>>()
  const sumColumns = RECONCILE_DIMENSIONS.map((d) => `COALESCE(SUM(${d.delta}), 0) AS ${d.dimension}`).join(', ')
  const replayedRow = await db
    .prepare(`SELECT ${sumColumns} FROM opportunity_events WHERE cycle_id = ?`)
    .bind(cycleId)
    .first<Record<string, number>>()

  const diffs = RECONCILE_DIMENSIONS.filter(
    (d) => projectedRow?.[d.dimension] !== replayedRow?.[d.dimension],
  ).map((d) => ({
    dimension: d.dimension,
    projected: projectedRow?.[d.dimension] ?? 0,
    replayed: replayedRow?.[d.dimension] ?? 0,
  }))

  const commands = diffs.length
    ? (
        await db
          .prepare('SELECT DISTINCT command_id FROM opportunity_events WHERE cycle_id = ? ORDER BY command_id')
          .bind(cycleId)
          .all<{ command_id: string }>()
      ).results.map((r) => r.command_id)
    : []

  return { cycle_id: cycleId, ok: diffs.length === 0, diffs, commands }
}
