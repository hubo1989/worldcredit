// lib/opportunities/fulfillments.server.ts — claims and reward receipts
// (plan Task 19, spec §8.2). Uniqueness comes from source_key
// (claim:<account>:<cycle> / reward:<task_cycle>:<reward_key>); quota grants
// create a bounded GRANT cycle (never a regular one) in the SAME batch as the
// fulfillment row; non-quota rewards record task_result rows with no account
// or quota at all. Booking flows arrive in Task 20.

import { getDb } from '../db/client'
import type { OpportunityActor } from './types'
import { OpportunityError, forbiddenOrNotFound, revisionConflict } from './errors'
import { assertAccountAccess, holderScopePredicate } from './scope.server'
import { runOpportunityCommand, replayCommittedResult, EventDraft } from './writes.server'
import { listRuleVersions, newestRuleVersion, parseRules } from './catalog.server'
import { isValidCivilDate } from './dates'

// ---------------------------------------------------------------------------
// recordOpportunityClaim — activate a pending batch, add no quota
// ---------------------------------------------------------------------------

export interface RecordClaimInput {
  account_id: string
  cycle_id: string
  card_id: string
  claimed_on: string
  note?: string | null
  request_key: string
}

export interface RecordClaimResult {
  fulfillment_id: string
  cycle_id: string
  cycle_activation_state: 'active'
}

const CLAIM_PAYLOAD_FIELDS = ['account_id', 'cycle_id', 'card_id', 'claimed_on', 'note'] as const

const ZERO_DELTAS = {
  delta_opening_count: 0, delta_opening_minor: 0,
  delta_used_count: 0, delta_used_minor: 0,
  delta_reserved_count: 0, delta_reserved_minor: 0,
}

export async function recordOpportunityClaim(
  actor: OpportunityActor,
  input: RecordClaimInput,
  opts: { now?: string } = {},
): Promise<RecordClaimResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (!isValidCivilDate(input.claimed_on)) {
    throw new OpportunityError('VALIDATION_FAILED', 'claimed_on 不是合法日期', { field: 'claimed_on' })
  }
  const note =
    input.note === undefined || input.note === null
      ? null
      : typeof input.note === 'string' && input.note.length <= 200
        ? input.note
        : (() => {
            throw new OpportunityError('VALIDATION_FAILED', 'note 最长 200 字', { field: 'note' })
          })()

  const payload = { account_id: input.account_id, cycle_id: input.cycle_id, card_id: input.card_id, claimed_on: input.claimed_on, note }
  const sourceKey = `claim:${input.account_id}:${input.cycle_id}`
  const replayed = await replayCommittedResult<RecordClaimResult>(actor, input.request_key, CLAIM_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const account = await assertAccountAccess(input.account_id, actor)
  const cycle = await db
    .prepare(
      `SELECT id, account_id, activation_state, revision FROM opportunity_cycles WHERE id = ?`,
    )
    .bind(input.cycle_id)
    .first<{ id: string; account_id: string; activation_state: string; revision: number }>()
  if (!cycle || cycle.account_id !== input.account_id) throw forbiddenOrNotFound('cycle')

  const linked = await db
    .prepare(
      'SELECT 1 AS ok FROM opportunity_account_cards WHERE account_id = ? AND card_id = ? AND retired_at IS NULL',
    )
    .bind(input.account_id, input.card_id)
    .first<{ ok: number }>()
  if (!linked) throw new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户', { card_id: input.card_id })

  const alreadyClaimed = await db
    .prepare("SELECT 1 AS ok FROM opportunity_fulfillments WHERE source_key = ? AND status != 'cancelled'")
    .bind(sourceKey)
    .first<{ ok: number }>()
  if (alreadyClaimed) {
    throw new OpportunityError('INVALID_TRANSITION', '该批次已记录领取', { source_key: sourceKey })
  }
  if (cycle.activation_state === 'active') {
    throw new OpportunityError('INVALID_TRANSITION', '该批次已激活，无需再次领取', { cycle_id: cycle.id })
  }
  if (cycle.activation_state === 'voided') {
    throw new OpportunityError('INVALID_TRANSITION', '该批次已作废', { cycle_id: cycle.id })
  }

  const fulfillmentId = `ofl_${crypto.randomUUID()}`
  const result: RecordClaimResult = {
    fulfillment_id: fulfillmentId,
    cycle_id: cycle.id,
    cycle_activation_state: 'active',
  }
  const scope = holderScopePredicate(actor)

  return (
    await runOpportunityCommand<RecordClaimResult>(
      actor,
      {
        command_type: 'recordOpportunityClaim',
        request_key: input.request_key,
        payload_fields: CLAIM_PAYLOAD_FIELDS,
        payload,
        assertions: [
          {
            name: 'claim-scope',
            sql: `EXISTS (SELECT 1 FROM opportunity_accounts a JOIN card_holders h ON h.id = a.holder_id
                   WHERE a.id = ? AND a.status = 'active' AND ${scope.sql})`,
            binds: [input.account_id, ...scope.binds],
            violation: () => forbiddenOrNotFound('account'),
          },
          {
            name: 'claim-cycle-pending',
            sql: `EXISTS (SELECT 1 FROM opportunity_cycles c WHERE c.id = ? AND c.account_id = ? AND c.activation_state = 'pending_claim')
              AND NOT EXISTS (SELECT 1 FROM opportunity_fulfillments f
                              WHERE f.source_key = ? AND f.status != 'cancelled')`,
            binds: [input.cycle_id, input.account_id, sourceKey],
            violation: () =>
              new OpportunityError('INVALID_TRANSITION', '批次状态已变化或已领取，请刷新后重试', {
                cycle_id: input.cycle_id,
              }),
          },
          {
            name: 'claim-card-linked',
            sql: 'EXISTS (SELECT 1 FROM opportunity_account_cards ac WHERE ac.account_id = ? AND ac.card_id = ? AND ac.retired_at IS NULL)',
            binds: [input.account_id, input.card_id],
            violation: () => new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户', { card_id: input.card_id }),
          },
        ],
        events: [
          {
            entity_kind: 'fulfillment',
            entity_id: fulfillmentId,
            event_type: 'claim.recorded',
            account_id: input.account_id,
            cycle_id: input.cycle_id,
            deltas: ZERO_DELTAS, // 领取不增加任何配额（§8.2）
            after_json: { claimed_on: input.claimed_on, card_id: input.card_id },
            reason: note,
          },
        ],
        statements: [
          db
            .prepare(
              `INSERT INTO opportunity_fulfillments
                 (id, holder_id, kind, account_id, cycle_id, source_key, card_id, status,
                  quantity, amount_minor, recorded_on, note, created_by, updated_by, created_at, updated_at)
               VALUES (?,?,'claim',?,?,?,?,'recorded',1,0,?,?,?,?,?,?)`,
            )
            .bind(
              fulfillmentId, account.holder_id, input.account_id, input.cycle_id, sourceKey,
              input.card_id, input.claimed_on, note, actor.user_id, actor.user_id, now, now,
            ),
          db
            .prepare(
              `UPDATE opportunity_cycles SET activation_state = 'active', revision = revision + 1 WHERE id = ? AND activation_state = 'pending_claim'`,
            )
            .bind(input.cycle_id),
        ],
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// recordTaskRewardReceived — quota grant vs non-quota task_result
// ---------------------------------------------------------------------------

export interface RecordRewardInput {
  task_cycle_id: string
  reward_key: string
  received_on: string
  /** Account that holds the granted quota (required for reward_kind=quota). */
  account_id?: string | null
  /** Overrides the plan window start (defaults to the plan's from-day). */
  usable_start_on?: string | null
  usable_end_before?: string | null
  note?: string | null
  request_key: string
}

export interface RecordRewardResult {
  fulfillment_id: string
  reward_kind: 'quota' | 'non_quota'
  /** Grant cycle for quota rewards; null for non-quota task results. */
  grant_cycle_id: string | null
}

const REWARD_PAYLOAD_FIELDS = [
  'task_cycle_id', 'reward_key', 'received_on', 'account_id',
  'usable_start_on', 'usable_end_before', 'note',
] as const

interface TaskCycleWorld {
  id: string
  task_id: string
  holder_id: string
  reward_snapshot_json: string
  expected_from_on: string | null
  expected_until_before: string | null
  revision: number
}

export async function recordTaskRewardReceived(
  actor: OpportunityActor,
  input: RecordRewardInput,
  opts: { now?: string } = {},
): Promise<RecordRewardResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (!isValidCivilDate(input.received_on)) {
    throw new OpportunityError('VALIDATION_FAILED', 'received_on 不是合法日期', { field: 'received_on' })
  }
  if (typeof input.reward_key !== 'string' || input.reward_key.length === 0 || input.reward_key.length > 64) {
    throw new OpportunityError('VALIDATION_FAILED', 'reward_key 必须是 1–64 字', { field: 'reward_key' })
  }
  const note = input.note ?? null

  const payload = {
    task_cycle_id: input.task_cycle_id,
    reward_key: input.reward_key,
    received_on: input.received_on,
    account_id: input.account_id ?? null,
    usable_start_on: input.usable_start_on ?? null,
    usable_end_before: input.usable_end_before ?? null,
    note,
  }
  const sourceKey = `reward:${input.task_cycle_id}:${input.reward_key}`
  const replayed = await replayCommittedResult<RecordRewardResult>(actor, input.request_key, REWARD_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  // Task cycle + holder scope.
  const scope = holderScopePredicate(actor)
  const taskCycle = await db
    .prepare(
      `SELECT tc.id, tc.task_id, t.holder_id, tc.reward_snapshot_json,
              tc.expected_from_on, tc.expected_until_before, tc.revision
       FROM opportunity_task_cycles tc
       JOIN opportunity_tasks t ON t.id = tc.task_id
       JOIN card_holders h ON h.id = t.holder_id
       WHERE tc.id = ? AND ${scope.sql}`,
    )
    .bind(input.task_cycle_id, ...scope.binds)
    .first<TaskCycleWorld>()
  if (!taskCycle) throw forbiddenOrNotFound('task_cycle')

  const plan = JSON.parse(taskCycle.reward_snapshot_json) as {
    kind: 'quota' | 'non_quota'
    title: string
    count?: number | null
    amount_minor?: number | null
    currency?: string | null
    description?: string | null
    window?: { from_day: number; until_day: number | null }
  }

  const alreadyReceived = await db
    .prepare("SELECT 1 AS ok FROM opportunity_fulfillments WHERE source_key = ? AND status != 'cancelled'")
    .bind(sourceKey)
    .first<{ ok: number }>()
  if (alreadyReceived) {
    throw new OpportunityError('INVALID_TRANSITION', '该奖励已记录到账', { source_key: sourceKey })
  }

  const fulfillmentId = `ofl_${crypto.randomUUID()}`
  const statements = []
  const events: EventDraft[] = []

  if (plan.kind === 'quota') {
    // Quota reward: needs an account in the task holder's world, and creates
    // a bounded GRANT cycle (never a regular one) in the same batch.
    if (!input.account_id) {
      throw new OpportunityError('VALIDATION_FAILED', 'quota 奖励必须指定账户', { field: 'account_id' })
    }
    const account = await db
      .prepare(
        `SELECT a.id, a.holder_id, a.definition_id, a.status FROM opportunity_accounts a
         WHERE a.id = ? AND a.holder_id = ?`,
      )
      .bind(input.account_id, taskCycle.holder_id)
      .first<{ id: string; holder_id: string; definition_id: string; status: string }>()
    if (!account || account.status !== 'active') {
      throw new OpportunityError('VALIDATION_FAILED', '奖励账户不存在或不属于该任务的持卡人', {
        account_id: input.account_id,
      })
    }

    const versions = await listRuleVersions(account.definition_id)
    const newest = newestRuleVersion(versions)
    if (!newest) {
      throw new OpportunityError('NEEDS_CONFIRMATION', '账户定义缺少规则版本，无法建立奖励配额', {})
    }
    const rules = parseRules(newest.rules_json)

    // The plan window may open BEFORE the receipt date — quota is never
    // usable before it actually arrives, so clip the start to the receipt.
    const planStart = taskCycle.expected_from_on ?? input.received_on
    const explicitStart = input.usable_start_on ?? null
    if (explicitStart !== null && explicitStart < input.received_on) {
      throw new OpportunityError('VALIDATION_FAILED', '显式有效期不能早于到账日', { field: 'usable_start_on' })
    }
    const usableStart = explicitStart ?? (planStart > input.received_on ? planStart : input.received_on)
    const usableEnd =
      input.usable_end_before ?? taskCycle.expected_until_before ?? null
    if (!isValidCivilDate(usableStart)) {
      throw new OpportunityError('VALIDATION_FAILED', '奖励有效期开始不合法', { field: 'usable_start_on' })
    }
    if (usableEnd !== null && usableEnd <= usableStart) {
      throw new OpportunityError('VALIDATION_FAILED', '奖励有效期结束必须晚于开始', { field: 'usable_end_before' })
    }

    const grantCycleId = `ocyc_${crypto.randomUUID()}`
    const cycleKey = `grant:${input.task_cycle_id}:${input.reward_key}`
    // The grant cycle must exist before the grant.recorded event references
    // it → preStatements (engine runs them between checks and events).
    const grantCycleInsert = db
      .prepare(
        `INSERT INTO opportunity_cycles
             (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
              activation_state, period_start_on, period_end_before, usable_start_on, usable_end_before,
              time_zone, count_limit, amount_limit_minor, currency, created_at)
           VALUES (?,?,?,?,?,'grant','active',?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          grantCycleId, account.id, newest.id, usableStart, cycleKey,
          usableStart, usableEnd, usableStart, usableEnd,
          rules.time_zone,
          plan.count ?? null,
          plan.amount_minor ?? null,
          plan.amount_minor != null ? (plan.currency ?? rules.currency ?? 'CNY') : null,
          now,
        )
    statements.push(
      db
        .prepare(
          `INSERT INTO opportunity_fulfillments
             (id, holder_id, kind, account_id, cycle_id, task_cycle_id, reward_key, source_key,
              status, quantity, amount_minor, recorded_on, note, created_by, updated_by, created_at, updated_at)
           VALUES (?,?,'grant',?,?,?,?,?, 'recorded', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          fulfillmentId, taskCycle.holder_id, account.id, grantCycleId, input.task_cycle_id,
          input.reward_key, sourceKey,
          plan.count ?? 1, plan.amount_minor ?? 0, input.received_on, note,
          actor.user_id, actor.user_id, now, now,
        ),
    )
    events.push({
      entity_kind: 'fulfillment',
      entity_id: fulfillmentId,
      event_type: 'grant.recorded',
      account_id: account.id,
      cycle_id: grantCycleId,
      deltas: ZERO_DELTAS, // 到账建立有界配额上限；消耗仍经 usage 事件
      after_json: {
        grant_cycle_id: grantCycleId,
        count_limit: plan.count ?? null,
        amount_limit_minor: plan.amount_minor ?? null,
        received_on: input.received_on,
      },
      reason: note ?? '任务奖励到账',
    })

    const result: RecordRewardResult = {
      fulfillment_id: fulfillmentId,
      reward_kind: 'quota',
      grant_cycle_id: grantCycleId,
    }
    return (
      await runOpportunityCommand<RecordRewardResult>(
        actor,
        {
          command_type: 'recordTaskRewardReceived.quota',
          request_key: input.request_key,
          payload_fields: REWARD_PAYLOAD_FIELDS,
          payload,
          preStatements: [grantCycleInsert],
          assertions: [
            {
              name: 'reward-scope',
              sql: `EXISTS (SELECT 1 FROM opportunity_task_cycles tc
                     JOIN opportunity_tasks t ON t.id = tc.task_id
                     JOIN card_holders h ON h.id = t.holder_id
                     WHERE tc.id = ? AND ${scope.sql})`,
              binds: [input.task_cycle_id, ...scope.binds],
              violation: () => forbiddenOrNotFound('task_cycle'),
            },
            {
              name: 'reward-unique',
              sql: `NOT EXISTS (SELECT 1 FROM opportunity_fulfillments f
                      WHERE f.source_key = ? AND f.status != 'cancelled')`,
              binds: [sourceKey],
              violation: () =>
                new OpportunityError('INVALID_TRANSITION', '该奖励已记录到账', { source_key: sourceKey }),
            },
            {
              name: 'reward-account-holder',
              sql: `EXISTS (SELECT 1 FROM opportunity_accounts a
                      WHERE a.id = ? AND a.holder_id = ? AND a.status = 'active')`,
              binds: [input.account_id, taskCycle.holder_id],
              violation: () =>
                new OpportunityError('VALIDATION_FAILED', '奖励账户不属于该任务的持卡人', {
                  account_id: input.account_id,
                }),
            },
          ],
          events,
          statements,
          result,
        },
        { now },
      )
    ).result
  }

  // Non-quota reward: a task_result row only — no account, no quota, no cycle.
  statements.push(
    db
      .prepare(
        `INSERT INTO opportunity_fulfillments
           (id, holder_id, kind, task_cycle_id, reward_key, source_key, status,
            quantity, amount_minor, recorded_on, entry_json, note, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,'task_result',?,?,?, 'recorded', 1, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fulfillmentId, taskCycle.holder_id, input.task_cycle_id, input.reward_key, sourceKey,
        input.received_on, JSON.stringify({ title: plan.title, description: plan.description ?? null }),
        note, actor.user_id, actor.user_id, now, now,
      ),
  )
  events.push({
    entity_kind: 'fulfillment',
    entity_id: fulfillmentId,
    event_type: 'task_result.recorded',
    account_id: null,
    cycle_id: null,
    deltas: ZERO_DELTAS,
    after_json: { title: plan.title, received_on: input.received_on },
    reason: note ?? '任务奖励结果记录（非配额）',
  })

  const result: RecordRewardResult = {
    fulfillment_id: fulfillmentId,
    reward_kind: 'non_quota',
    grant_cycle_id: null,
  }
  return (
    await runOpportunityCommand<RecordRewardResult>(
      actor,
      {
        command_type: 'recordTaskRewardReceived.non_quota',
        request_key: input.request_key,
        payload_fields: REWARD_PAYLOAD_FIELDS,
        payload,
        assertions: [
          {
            name: 'reward-scope',
            sql: `EXISTS (SELECT 1 FROM opportunity_task_cycles tc
                   JOIN opportunity_tasks t ON t.id = tc.task_id
                   JOIN card_holders h ON h.id = t.holder_id
                   WHERE tc.id = ? AND ${scope.sql})`,
            binds: [input.task_cycle_id, ...scope.binds],
            violation: () => forbiddenOrNotFound('task_cycle'),
          },
          {
            name: 'reward-unique',
            sql: `NOT EXISTS (SELECT 1 FROM opportunity_fulfillments f
                    WHERE f.source_key = ? AND f.status != 'cancelled')`,
            binds: [sourceKey],
            violation: () =>
              new OpportunityError('INVALID_TRANSITION', '该奖励已记录到账', { source_key: sourceKey }),
          },
        ],
        events,
        statements,
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// voidOpportunityClaim — cancellation with dependency conflict
// ---------------------------------------------------------------------------

export interface VoidClaimResult {
  fulfillment_id: string
  status: 'cancelled'
}

export async function voidOpportunityClaim(
  actor: OpportunityActor,
  input: { fulfillment_id: string; reason: string; expected_revision: number; request_key: string },
  opts: { now?: string } = {},
): Promise<VoidClaimResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 500) {
    throw new OpportunityError('VALIDATION_FAILED', 'reason 必须是 1–500 字', { field: 'reason' })
  }

  const payload = {
    fulfillment_id: input.fulfillment_id,
    reason: input.reason.trim(),
    expected_revision: input.expected_revision,
  }
  const replayed = await replayCommittedResult<VoidClaimResult>(
    actor, input.request_key, ['fulfillment_id', 'reason', 'expected_revision'], payload)
  if (replayed) return replayed

  const scope = holderScopePredicate(actor)
  const row = await db
    .prepare(
      `SELECT f.id, f.kind, f.account_id, f.cycle_id, f.status, f.revision,
              c.used_count, c.reserved_count, c.used_minor, c.reserved_minor
       FROM opportunity_fulfillments f
       JOIN card_holders h ON h.id = f.holder_id
       LEFT JOIN opportunity_cycles c ON c.id = f.cycle_id
       WHERE f.id = ? AND f.kind = 'claim' AND ${scope.sql}`,
    )
    .bind(input.fulfillment_id, ...scope.binds)
    .first<{
      id: string; kind: string; account_id: string; cycle_id: string; status: string
      revision: number; used_count: number | null; reserved_count: number | null
      used_minor: number | null; reserved_minor: number | null
    }>()
  if (!row) throw forbiddenOrNotFound('fulfillment')
  if (row.status !== 'recorded') {
    throw new OpportunityError('INVALID_TRANSITION', '该领取不在可撤销状态', { status: row.status })
  }
  if ((row.used_count ?? 0) > 0 || (row.reserved_count ?? 0) > 0 || (row.used_minor ?? 0) > 0 || (row.reserved_minor ?? 0) > 0) {
    // 已有使用/预约依赖：整体纠正走 Task 20 的履约纠正，不提供单点撤销
    throw new OpportunityError('CONFLICT', '该批次已有使用或预约，不能直接撤销领取；请使用履约纠正', {
      fulfillment_id: row.id,
    })
  }
  if (input.expected_revision !== row.revision) {
    throw revisionConflict({ expected_revision: input.expected_revision, actual_revision: row.revision })
  }

  const result: VoidClaimResult = { fulfillment_id: row.id, status: 'cancelled' }
  return (
    await runOpportunityCommand<VoidClaimResult>(
      actor,
      {
        command_type: 'voidOpportunityClaim',
        request_key: input.request_key,
        payload_fields: ['fulfillment_id', 'reason', 'expected_revision'],
        payload,
        assertions: [
          {
            name: 'void-claim-clean',
            sql: `EXISTS (SELECT 1 FROM opportunity_fulfillments f WHERE f.id = ? AND f.status = 'recorded' AND f.revision = ?)
              AND NOT EXISTS (SELECT 1 FROM opportunity_cycles c WHERE c.id = ?
                              AND (c.used_count > 0 OR c.reserved_count > 0 OR c.used_minor > 0 OR c.reserved_minor > 0))`,
            binds: [row.id, row.revision, row.cycle_id],
            violation: () =>
              new OpportunityError('CONFLICT', '该批次已有使用或预约，不能直接撤销领取', {
                fulfillment_id: row.id,
              }),
          },
        ],
        events: [
          {
            entity_kind: 'fulfillment',
            entity_id: row.id,
            event_type: 'claim.voided',
            account_id: row.account_id,
            cycle_id: row.cycle_id,
            deltas: ZERO_DELTAS,
            reason: payload.reason,
          },
        ],
        statements: [
          db
            .prepare(
              `UPDATE opportunity_fulfillments
               SET status = 'cancelled', revision = revision + 1, updated_by = ?, updated_at = ?
               WHERE id = ? AND revision = ?`,
            )
            .bind(actor.user_id, now, row.id, row.revision),
          db
            .prepare(
              `UPDATE opportunity_cycles SET activation_state = 'voided', revision = revision + 1
               WHERE id = ? AND (used_count = 0 AND reserved_count = 0 AND used_minor = 0 AND reserved_minor = 0)`,
            )
            .bind(row.cycle_id),
        ],
        result,
      },
      { now },
    )
  ).result
}
