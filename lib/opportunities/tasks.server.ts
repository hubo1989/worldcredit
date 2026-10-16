// lib/opportunities/tasks.server.ts — manual task persistence (plan Task 18,
// spec §8.1/§9): template saves keep current-cycle snapshots untouched,
// progress is an ABSOLUTE whole-snapshot replace audited through the command
// engine (zero quota deltas, before/after preserved), satisfaction and reward
// delivery are computed separately, and every read/write re-authorizes the
// task's holder in SQL.

import { getDb } from '../db/client'
import type { OpportunityActor } from './types'
import { OpportunityError, forbiddenOrNotFound, revisionConflict } from './errors'
import { holderScopePredicate } from './scope.server'
import { runOpportunityCommand, replayCommittedResult } from './writes.server'
import {
  evaluateTask,
  parseTaskConditions,
  rewardWindow,
  validateCardIdSet,
  validateTaskConditions,
  type ManualProgress,
  type TaskConditionsV1,
} from './tasks'
import { localDateInZone } from './dates'

// ---------------------------------------------------------------------------
// Reward plan validation (reward_json)
// ---------------------------------------------------------------------------

export type TaskRewardPlan =
  | {
      kind: 'quota'
      title: string
      reward_key: string
      count: number | null
      amount_minor: number | null
      currency: string | null
    }
  | {
      kind: 'non_quota'
      title: string
      reward_key: string
      description: string | null
    }

export interface RewardWindowSpec {
  from_day: number
  until_day: number | null
}

export interface RewardPlanBundle {
  reward: TaskRewardPlan
  window: RewardWindowSpec
}

function validateRewardPlan(input: unknown): TaskRewardPlan {
  if (typeof input !== 'object' || input === null) {
    throw new OpportunityError('VALIDATION_FAILED', '奖励方案不合法', { field: 'reward' })
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.reward_key !== 'string' || raw.reward_key.length === 0 || raw.reward_key.length > 64) {
    throw new OpportunityError('VALIDATION_FAILED', 'reward_key 必须是 1–64 字', { field: 'reward_key' })
  }
  if (typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 80) {
    throw new OpportunityError('VALIDATION_FAILED', '奖励标题必须是 1–80 字', { field: 'title' })
  }
  if (raw.kind === 'quota') {
    if (raw.count !== null && raw.count !== undefined && (!Number.isInteger(raw.count) || (raw.count as number) < 0)) {
      throw new OpportunityError('VALIDATION_FAILED', '奖励次数必须是非负整数或 null', { field: 'count' })
    }
    if (
      raw.amount_minor !== null &&
      raw.amount_minor !== undefined &&
      (!Number.isInteger(raw.amount_minor) || (raw.amount_minor as number) < 0)
    ) {
      throw new OpportunityError('VALIDATION_FAILED', '奖励金额必须是非负整数（最小货币单位）', { field: 'amount_minor' })
    }
    if (raw.count == null && raw.amount_minor == null) {
      throw new OpportunityError('VALIDATION_FAILED', 'quota 奖励必须给出次数或金额', { field: 'count' })
    }
    return {
      kind: 'quota',
      title: raw.title,
      reward_key: raw.reward_key,
      count: (raw.count ?? null) as number | null,
      amount_minor: (raw.amount_minor ?? null) as number | null,
      currency: (raw.currency ?? null) as string | null,
    }
  }
  if (raw.kind === 'non_quota') {
    return {
      kind: 'non_quota',
      title: raw.title,
      reward_key: raw.reward_key,
      description: (raw.description ?? null) as string | null,
    }
  }
  throw new OpportunityError('VALIDATION_FAILED', 'reward.kind 必须是 quota 或 non_quota', { field: 'kind' })
}

function validateWindowSpec(input: unknown): RewardWindowSpec {
  if (typeof input !== 'object' || input === null) {
    throw new OpportunityError('VALIDATION_FAILED', '发放窗口不合法', { field: 'window' })
  }
  const raw = input as Record<string, unknown>
  const from = raw.from_day
  const until = raw.until_day ?? null
  for (const day of [from, until]) {
    if (day !== null && (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 31)) {
      throw new OpportunityError('VALIDATION_FAILED', '发放窗口日必须是 1–31', { field: 'window' })
    }
  }
  if (until !== null && (until as number) < (from as number)) {
    throw new OpportunityError('VALIDATION_FAILED', '窗口结束日不能早于开始日', { field: 'window' })
  }
  return { from_day: from as number, until_day: until as number }
}

// ---------------------------------------------------------------------------
// saveOpportunityTask — create or update the TEMPLATE (future cycles only)
// ---------------------------------------------------------------------------

export interface SaveTaskInput {
  task_id?: string | null
  holder_id: string
  task_type: 'annual_fee' | 'welcome' | 'monthly_spend' | 'custom'
  title: string
  card_ids: string[]
  rules: TaskConditionsV1
  reward: TaskRewardPlan
  window: RewardWindowSpec
  request_key: string
  expected_revision?: number | null
}

export interface SaveTaskResult {
  task_id: string
  revision: number
  /** true when an existing task's template was updated (current cycles keep their snapshots). */
  updated: boolean
}

const SAVE_PAYLOAD_FIELDS = [
  'task_id', 'holder_id', 'task_type', 'title', 'card_ids', 'rules', 'reward', 'window', 'expected_revision',
] as const

export async function saveOpportunityTask(
  actor: OpportunityActor,
  input: SaveTaskInput,
  opts: { now?: string } = {},
): Promise<SaveTaskResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  const rules = validateTaskConditions(input.rules)
  const reward = validateRewardPlan(input.reward)
  const windowSpec = validateWindowSpec(input.window)
  const cardIds = validateCardIdSet(input.card_ids)
  if (typeof input.title !== 'string' || input.title.length === 0 || input.title.length > 80) {
    throw new OpportunityError('VALIDATION_FAILED', '任务标题必须是 1–80 字', { field: 'title' })
  }
  if (rules.currency !== 'CNY' && reward.kind === 'quota' && reward.currency && reward.currency !== rules.currency) {
    throw new OpportunityError('VALIDATION_FAILED', '奖励币种必须与任务币种一致', { field: 'currency' })
  }

  // Holder must be in scope; every card must belong to that holder (SQL, not JSON).
  const scope = holderScopePredicate(actor)
  const holder = await db
    .prepare(`SELECT id FROM card_holders h WHERE h.id = ? AND ${scope.sql}`)
    .bind(input.holder_id, ...scope.binds)
    .first<{ id: string }>()
  if (!holder) throw forbiddenOrNotFound('holder')
  const cardPh = cardIds.map(() => '?').join(',')
  const { results: ownedCards } = await db
    .prepare(`SELECT id FROM credit_cards WHERE holder_id = ? AND id IN (${cardPh})`)
    .bind(input.holder_id, ...cardIds)
    .all<{ id: string }>()
  if (ownedCards.length !== cardIds.length) {
    throw new OpportunityError('VALIDATION_FAILED', '存在不属于该持卡人的卡', { field: 'card_ids' })
  }

  const payload = {
    task_id: input.task_id ?? null,
    holder_id: input.holder_id,
    task_type: input.task_type,
    title: input.title,
    card_ids: cardIds,
    rules,
    reward,
    window: windowSpec,
    expected_revision: input.expected_revision ?? null,
  }
  const replayed = await replayCommittedResult<SaveTaskResult>(actor, input.request_key, SAVE_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const rulesJson = JSON.stringify(rules)
  const rewardJson = JSON.stringify({ ...reward, window: windowSpec })

  if (input.task_id) {
    // Template update: current cycles keep their own snapshots (§8.1) — only
    // future cycles read the new template. The window spec rides along.
    const existing = await db
      .prepare('SELECT id, revision, holder_id, status FROM opportunity_tasks WHERE id = ?')
      .bind(input.task_id)
      .first<{ id: string; revision: number; holder_id: string; status: string }>()
    if (!existing) throw forbiddenOrNotFound('task')
    const owned = await db
      .prepare(`SELECT 1 AS ok FROM card_holders h WHERE h.id = ? AND ${scope.sql}`)
      .bind(existing.holder_id, ...scope.binds)
      .first<{ ok: number }>()
    if (!owned) throw forbiddenOrNotFound('task')
    if (existing.status !== 'active') {
      throw new OpportunityError('INVALID_TRANSITION', '任务已归档，不能编辑模板', { task_id: existing.id })
    }
    if (
      input.expected_revision !== undefined &&
      input.expected_revision !== null &&
      input.expected_revision !== existing.revision
    ) {
      throw revisionConflict({ expected_revision: input.expected_revision, actual_revision: existing.revision })
    }
    const updateResult: SaveTaskResult = {
      task_id: input.task_id,
      revision: existing.revision + 1,
      updated: true,
    }
    return (
      await runOpportunityCommand<SaveTaskResult>(
        actor,
        {
          command_type: 'saveOpportunityTask.update',
          request_key: input.request_key,
          payload_fields: SAVE_PAYLOAD_FIELDS,
          payload,
          assertions: [
            {
              name: 'task-update-revision',
              sql: 'EXISTS (SELECT 1 FROM opportunity_tasks t WHERE t.id = ? AND t.status = ? AND t.revision = ?)',
              binds: [input.task_id, 'active', existing.revision],
              violation: () => revisionConflict({ task_id: input.task_id }),
            },
          ],
          events: [
            {
              entity_kind: 'task',
              entity_id: input.task_id,
              event_type: 'task.template_updated',
              account_id: null,
              cycle_id: null,
              deltas: {
                delta_opening_count: 0, delta_opening_minor: 0,
                delta_used_count: 0, delta_used_minor: 0,
                delta_reserved_count: 0, delta_reserved_minor: 0,
              },
              before_json: { revision: existing.revision },
              after_json: { revision: existing.revision + 1, note: '模板更新只作用于新周期' },
            },
          ],
          statements: [
            db
              .prepare(
                `UPDATE opportunity_tasks
                 SET task_type = ?, title = ?, card_ids_json = ?, rules_json = ?, reward_json = ?,
                     revision = revision + 1, updated_at = ?
                 WHERE id = ? AND revision = ?`,
              )
              .bind(input.task_type, input.title, JSON.stringify(cardIds), rulesJson, rewardJson, now, input.task_id, existing.revision),
          ],
          result: updateResult,
        },
        { now },
      )
    ).result
  }

  const taskId = `task_${crypto.randomUUID()}`
  const result: SaveTaskResult = { task_id: taskId, revision: 1, updated: false }
  return (
    await runOpportunityCommand<SaveTaskResult>(
      actor,
      {
        command_type: 'saveOpportunityTask',
        request_key: input.request_key,
        payload_fields: SAVE_PAYLOAD_FIELDS,
        payload,
        assertions: [],
        events: [
          {
            entity_kind: 'task',
            entity_id: taskId,
            event_type: 'task.created',
            account_id: null,
            cycle_id: null,
            deltas: {
              delta_opening_count: 0, delta_opening_minor: 0,
              delta_used_count: 0, delta_used_minor: 0,
              delta_reserved_count: 0, delta_reserved_minor: 0,
            },
            after_json: { holder_id: input.holder_id, title: input.title, card_ids: cardIds },
          },
        ],
        statements: [
          db
            .prepare(
              `INSERT INTO opportunity_tasks (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(taskId, input.holder_id, input.task_type, input.title, JSON.stringify(cardIds), rulesJson, rewardJson, actor.user_id, now, now),
        ],
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// Cycle materialization + progress writes
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string
  holder_id: string
  task_type: string
  title: string
  card_ids_json: string
  rules_json: string
  reward_json: string
  status: string
  revision: number
}

interface TaskCycleRow {
  id: string
  task_id: string
  cycle_key: string
  rules_snapshot_json: string
  reward_snapshot_json: string
  period_start_on: string
  period_end_before: string
  deadline_at: string
  expected_from_on: string | null
  expected_until_before: string | null
  progress_json: string
  as_of_on: string | null
  revision: number
}

async function loadScopedTask(actor: OpportunityActor, taskId: string): Promise<TaskRow> {
  const scope = holderScopePredicate(actor)
  const row = await getDb()
    .prepare(
      `SELECT t.* FROM opportunity_tasks t
       JOIN card_holders h ON h.id = t.holder_id
       WHERE t.id = ? AND ${scope.sql}`,
    )
    .bind(taskId, ...scope.binds)
    .first<TaskRow>()
  if (!row) throw forbiddenOrNotFound('task')
  return row
}

/**
 * Finds-or-creates the task cycle covering `todayOn`. Creation snapshots the
 * CURRENT template (later template edits never rewrite it) and derives the
 * deadline and reward window from the snapshot.
 */
async function ensureTaskCycle(
  actor: OpportunityActor,
  task: TaskRow,
  todayOn: string,
  now: string,
): Promise<TaskCycleRow> {
  const db = getDb()
  const rewardBundle = JSON.parse(task.reward_json) as { window?: RewardWindowSpec }
  const windowSpec = validateWindowSpec(rewardBundle.window ?? { from_day: 1, until_day: null })
  // Monthly periods anchored at calendar months (simple, deterministic);
  // custom tasks use the same monthly cadence until richer specs arrive.
  const periodStart = `${todayOn.slice(0, 7)}-01`
  const [y, m] = periodStart.split('-').map(Number)
  const nextMonth = new Date(Date.UTC(y, m, 1))
  const periodEnd = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
  const cycleKey = `monthly:${periodStart}`

  const existing = await db
    .prepare('SELECT * FROM opportunity_task_cycles WHERE task_id = ? AND cycle_key = ?')
    .bind(task.id, cycleKey)
    .first<TaskCycleRow>()
  if (existing) return existing

  const win = rewardWindow(periodEnd, windowSpec.from_day, windowSpec.until_day)
  await db
    .prepare(
      `INSERT INTO opportunity_task_cycles
         (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json, period_start_on,
          period_end_before, deadline_at, expected_from_on, expected_until_before, progress_json, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, '{}', ?)
       ON CONFLICT(task_id, cycle_key) DO NOTHING`,
    )
    .bind(
      `tc_${crypto.randomUUID()}`, task.id, cycleKey, task.rules_json, task.reward_json,
      periodStart, periodEnd, `${periodEnd}T00:00:00Z`, win.expected_from_on, win.expected_until_before, now,
    )
    .run()
  const created = await db
    .prepare('SELECT * FROM opportunity_task_cycles WHERE task_id = ? AND cycle_key = ?')
    .bind(task.id, cycleKey)
    .first<TaskCycleRow>()
  if (!created) throw new OpportunityError('DATABASE_UNAVAILABLE', '任务周期创建失败，请重试')
  return created
}

const PROGRESS_PAYLOAD_FIELDS = ['task_cycle_id', 'progress', 'reason', 'expected_revision'] as const

export interface UpdateProgressInput {
  task_cycle_id: string
  progress: ManualProgress
  reason: string
  expected_revision: number
  request_key: string
}

export interface UpdateProgressResult {
  task_cycle_id: string
  revision: number
  satisfied: boolean
  groups: ReturnType<typeof evaluateTask>['groups']
}

/**
 * Replaces the whole progress snapshot atomically: the command engine records
 * a zero-delta task event with before/after JSON (absolute snapshot semantics,
 * §8.1 — no incremental add API exists), and the revision CAS rejects stale
 * writers. Progress can go DOWN (e.g. a refund) — that is audited, not
 * blocked.
 */
export async function updateManualTaskProgress(
  actor: OpportunityActor,
  input: UpdateProgressInput,
  opts: { now?: string } = {},
): Promise<UpdateProgressResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 500) {
    throw new OpportunityError('VALIDATION_FAILED', 'reason 必须是 1–500 字', { field: 'reason' })
  }

  const payload = {
    task_cycle_id: input.task_cycle_id,
    progress: input.progress,
    reason: input.reason.trim(),
    expected_revision: input.expected_revision,
  }
  const replayed = await replayCommittedResult<UpdateProgressResult>(
    actor, input.request_key, PROGRESS_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const cycle = await db
    .prepare('SELECT * FROM opportunity_task_cycles WHERE id = ?')
    .bind(input.task_cycle_id)
    .first<TaskCycleRow>()
  if (!cycle) throw forbiddenOrNotFound('task_cycle')
  const task = await loadScopedTask(actor, cycle.task_id)
  const rules = parseTaskConditions(cycle.rules_snapshot_json)

  const evaluation = evaluateTask(rules, input.progress)

  const result: UpdateProgressResult = {
    task_cycle_id: cycle.id,
    revision: cycle.revision + 1,
    satisfied: evaluation.satisfied,
    groups: evaluation.groups,
  }

  const scope = holderScopePredicate(actor)
  return (
    await runOpportunityCommand<UpdateProgressResult>(
      actor,
      {
        command_type: 'updateManualTaskProgress',
        request_key: input.request_key,
        payload_fields: PROGRESS_PAYLOAD_FIELDS,
        payload,
        assertions: [
          {
            name: 'task-scope',
            sql: `EXISTS (
              SELECT 1 FROM opportunity_tasks t JOIN card_holders h ON h.id = t.holder_id
              WHERE t.id = ? AND t.status = 'active' AND ${scope.sql})`,
            binds: [task.id, ...scope.binds],
            violation: () => forbiddenOrNotFound('task'),
          },
          {
            name: 'cycle-revision',
            sql: 'EXISTS (SELECT 1 FROM opportunity_task_cycles c WHERE c.id = ? AND c.revision = ?)',
            binds: [cycle.id, input.expected_revision],
            violation: () =>
              revisionConflict({ task_cycle_id: cycle.id, expected_revision: input.expected_revision }),
          },
        ],
        events: [
          {
            entity_kind: 'task',
            entity_id: cycle.id,
            event_type: 'task.progress_replaced',
            account_id: null,
            cycle_id: null,
            deltas: {
              delta_opening_count: 0, delta_opening_minor: 0,
              delta_used_count: 0, delta_used_minor: 0,
              delta_reserved_count: 0, delta_reserved_minor: 0,
            },
            before_json: { progress: JSON.parse(cycle.progress_json), as_of_on: cycle.as_of_on },
            after_json: { progress: input.progress },
            reason: payload.reason,
          },
        ],
        statements: [
          db
            .prepare(
              `UPDATE opportunity_task_cycles
               SET progress_json = ?, as_of_on = ?, revision = revision + 1, updated_by = ?, updated_at = ?
               WHERE id = ? AND revision = ?`,
            )
            .bind(
              JSON.stringify(input.progress), input.progress.as_of_on, actor.user_id, now,
              cycle.id, input.expected_revision,
            ),
        ],
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// getOpportunityTasks — cycles + gaps + separated reward status
// ---------------------------------------------------------------------------

export interface TaskView {
  task_id: string
  title: string
  task_type: string
  status: string
  holder_id: string
  holder_name: string
  card_ids: string[]
  revision: number
  cycle: {
    id: string
    cycle_key: string
    period_start_on: string
    period_end_before: string
    deadline_at: string
    expected_from_on: string | null
    expected_until_before: string | null
    as_of_on: string | null
    revision: number
    satisfied: boolean
    groups: ReturnType<typeof evaluateTask>['groups']
  } | null
  /** 满足（达标）与奖励到账是两个独立事实；到账记录由 P2 履约表承载。 */
  reward_recorded: boolean
}

export async function getOpportunityTasks(
  actor: OpportunityActor,
  input: { holder_id?: string | null; card_id?: string | null; status?: string | null } = {},
  opts: { now?: string } = {},
): Promise<TaskView[]> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  const scope = holderScopePredicate(actor)
  const conditions = [scope.sql]
  const binds: unknown[] = [...scope.binds]
  if (input.holder_id) {
    conditions.push('t.holder_id = ?')
    binds.push(input.holder_id)
  }
  if (input.status) {
    conditions.push('t.status = ?')
    binds.push(input.status)
  }
  if (input.card_id) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(t.card_ids_json) je WHERE je.value = ?)')
    binds.push(input.card_id)
  }

  const { results: tasks } = await db
    .prepare(
      `SELECT t.*, h.name AS holder_name FROM opportunity_tasks t
       JOIN card_holders h ON h.id = t.holder_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC`,
    )
    .bind(...binds)
    .all<TaskRow & { holder_name: string }>()

  const views: TaskView[] = []
  for (const task of tasks) {
    const todayOn = localDateInZone(new Date(now), 'Asia/Shanghai')
    const cycle = await ensureTaskCycle(actor, task, todayOn, now)
    const rules = parseTaskConditions(cycle.rules_snapshot_json)
    let progress: ManualProgress = { as_of_on: todayOn, metric_values: {}, note: null }
    if (cycle.progress_json && cycle.progress_json !== '{}') {
      progress = JSON.parse(cycle.progress_json) as ManualProgress
    }
    const evaluation = evaluateTask(rules, progress)
    // Reward delivery is a separate fact from satisfaction (§8.1); P1 of the
    // task flow reports it once fulfillments land (Task 19).
    views.push({
      task_id: task.id,
      title: task.title,
      task_type: task.task_type,
      status: task.status,
      holder_id: task.holder_id,
      holder_name: task.holder_name,
      card_ids: JSON.parse(task.card_ids_json) as string[],
      revision: task.revision,
      cycle: {
        id: cycle.id,
        cycle_key: cycle.cycle_key,
        period_start_on: cycle.period_start_on,
        period_end_before: cycle.period_end_before,
        deadline_at: cycle.deadline_at,
        expected_from_on: cycle.expected_from_on,
        expected_until_before: cycle.expected_until_before,
        as_of_on: cycle.as_of_on,
        revision: cycle.revision,
        satisfied: evaluation.satisfied,
        groups: evaluation.groups,
      },
      reward_recorded: false,
    })
  }
  return views
}
