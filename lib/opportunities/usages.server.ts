// lib/opportunities/usages.server.ts — recording, correcting and voiding
// benefit usages (plan Task 9). Every mutation goes through the Task 8 command
// engine inside one db.batch():
//   record  — usage.recorded event (used +q/+a) + usage INSERT, guarded by
//             scope, card link, cycle state, usable window, no-future date and
//             quota headroom assertions
//   correct — expected_revision CAS. A same-cycle fix writes ONE delta event
//             (new−old); a cross-cycle move reverses the old cycle and charges
//             the new one in the SAME batch, so a target shortage rolls the
//             whole correction back (A08). Note-only corrections carry zero
//             six-dimension deltas.
//   void    — active→voided CAS; reverses used only on the usage's OWN cycle
//             and never re-adds quota to any other period (A09). Opening is
//             never touched (tech spec §7.2: voiding a legacy-assigned usage
//             disputes the usage fact, it does not reopen the opening).
// getUsageHistory is read-only: scoped, filtered, cursor-paginated by
// (used_on, id), each item carrying its audit events.

/// <reference types="@cloudflare/workers-types" />

import { getDb } from '../db/client'
import { isValidCivilDate, localDateInZone } from './dates'
import { OpportunityError, forbiddenOrNotFound, revisionConflict, quotaExceeded } from './errors'
import { assertAccountAccess, assertUsageAccess, holderScopePredicate } from './scope.server'
import { runOpportunityCommand, replayCommittedResult } from './writes.server'
import type { EventDraft, WriteAssertion } from './writes.server'
import { parseRules } from './catalog.server'
import type { OpportunityActor } from './types'

const NOTE_MAX = 500
const REASON_MAX = 500

const RECORD_PAYLOAD_FIELDS = [
  'account_id', 'cycle_id', 'card_id', 'used_on', 'quantity', 'amount_minor', 'note',
] as const
const CORRECT_PAYLOAD_FIELDS = [
  'usage_id', 'used_on', 'cycle_id', 'card_id', 'quantity', 'amount_minor', 'note',
  'reason', 'expected_revision',
] as const
const VOID_PAYLOAD_FIELDS = ['usage_id', 'reason', 'expected_revision'] as const

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface CycleBalance {
  cycle_id: string
  cycle_key: string
  opening_used_count: number
  opening_used_minor: number
  used_count: number
  used_minor: number
  reserved_count: number
  reserved_minor: number
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  revision: number
}

interface CycleState {
  id: string
  account_id: string
  cycle_key: string
  activation_state: 'active' | 'pending_claim' | 'voided'
  usable_start_on: string
  usable_end_before: string | null
  time_zone: string
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  opening_used_count: number
  opening_used_minor: number
  used_count: number
  used_minor: number
  reserved_count: number
  reserved_minor: number
  revision: number
  version_id: string
}

const CYCLE_STATE_SQL = `SELECT id, account_id, cycle_key, activation_state, usable_start_on, usable_end_before,
  time_zone, count_limit, amount_limit_minor, currency, opening_used_count, opening_used_minor,
  used_count, used_minor, reserved_count, reserved_minor, revision, version_id
  FROM opportunity_cycles WHERE id = ?`

async function loadCycle(cycleId: string, accountId: string): Promise<CycleState> {
  const cycle = await getDb().prepare(CYCLE_STATE_SQL).bind(cycleId).first<CycleState>()
  if (!cycle || cycle.account_id !== accountId) throw forbiddenOrNotFound('cycle')
  return cycle
}

function balanceAfter(cycle: CycleState, deltaCount: number, deltaMinor: number): CycleBalance {
  return {
    cycle_id: cycle.id,
    cycle_key: cycle.cycle_key,
    opening_used_count: cycle.opening_used_count,
    opening_used_minor: cycle.opening_used_minor,
    used_count: cycle.used_count + deltaCount,
    used_minor: cycle.used_minor + deltaMinor,
    reserved_count: cycle.reserved_count,
    reserved_minor: cycle.reserved_minor,
    count_limit: cycle.count_limit,
    amount_limit_minor: cycle.amount_limit_minor,
    currency: cycle.currency,
    // one projected event touches this cycle in a single-cycle command
    revision: cycle.revision + 1,
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (pre-read, for readable errors; the batch assertion is
// the concurrency-safe re-check)
// ---------------------------------------------------------------------------

function validateQuantityAmount(quantity: unknown, amountMinor: unknown): void {
  if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'quantity 必须是正整数', { field: 'quantity' })
  }
  if (!Number.isInteger(amountMinor) || (amountMinor as number) < 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'amount_minor 必须是非负整数', { field: 'amount_minor' })
  }
}

function validateNote(note: unknown): string | null {
  if (note === undefined || note === null) return null
  if (typeof note !== 'string' || note.length > NOTE_MAX) {
    throw new OpportunityError('VALIDATION_FAILED', `note 必须是不超过 ${NOTE_MAX} 字的文本`, { field: 'note' })
  }
  return note
}

function requireReason(reason: unknown): string {
  if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX) {
    throw new OpportunityError('VALIDATION_FAILED', `reason 必须是 1–${REASON_MAX} 字`, { field: 'reason' })
  }
  return reason
}

/**
 * Date/window/currency rules shared by record and correct:
 *   - no future usage dates (rule-local today is the upper bound)
 *   - the date must fall inside the target cycle's usable window, so an
 *     expired benefit cannot be "used today" but a past in-window date can be
 *     back-filled with evidence
 *   - monetary amounts need a currency: count-only cycles reject amount>0
 */
function assertUsableDateAndAmount(cycle: CycleState, usedOn: string, amountMinor: number, now: string): string {
  if (!isValidCivilDate(usedOn)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 used_on 不合法', { field: 'used_on' })
  }
  const today = localDateInZone(new Date(now), cycle.time_zone)
  if (usedOn > today) {
    throw new OpportunityError('VALIDATION_FAILED', '不能登记未来日期', {
      field: 'used_on',
      local_today: today,
      time_zone: cycle.time_zone,
    })
  }
  if (usedOn < cycle.usable_start_on) {
    throw new OpportunityError('VALIDATION_FAILED', 'used_on 早于该周期可用开始日', {
      field: 'used_on',
      usable_start_on: cycle.usable_start_on,
    })
  }
  if (cycle.usable_end_before !== null && usedOn >= cycle.usable_end_before) {
    throw new OpportunityError('VALIDATION_FAILED', 'used_on 已超出该周期使用范围', {
      field: 'used_on',
      usable_end_before: cycle.usable_end_before,
    })
  }
  if (amountMinor > 0 && cycle.currency === null) {
    throw new OpportunityError('VALIDATION_FAILED', '该权益按次数计量，不能登记金额', {
      field: 'amount_minor',
    })
  }
  return today
}

function assertAccountEligibility(
  account: { status: string; eligibility: string },
  requiresPersonalConfirmation: boolean,
): void {
  if (account.status !== 'active') {
    throw new OpportunityError('INVALID_TRANSITION', '该账户已归档，不能登记使用', {})
  }
  if (account.eligibility === 'ineligible') {
    throw new OpportunityError('INVALID_TRANSITION', '该账户资格已确认不可用，请先重新确认资格', {})
  }
  if (requiresPersonalConfirmation && account.eligibility === 'unknown') {
    throw new OpportunityError('NEEDS_CONFIRMATION', '该权益需要先确认个人资格后才能登记使用', {})
  }
}

function assertCycleWritable(cycle: CycleState): void {
  if (cycle.activation_state === 'pending_claim') {
    throw new OpportunityError('NEEDS_CONFIRMATION', '该周期尚未领取，先记录领取后才能使用', {
      cycle_id: cycle.id,
    })
  }
  if (cycle.activation_state === 'voided') {
    throw new OpportunityError('INVALID_TRANSITION', '该周期已作废', { cycle_id: cycle.id })
  }
}

async function cardLinkedToAccount(accountId: string, cardId: string): Promise<boolean> {
  const row = await getDb()
    .prepare(
      'SELECT 1 AS ok FROM opportunity_account_cards WHERE account_id = ? AND card_id = ? AND retired_at IS NULL',
    )
    .bind(accountId, cardId)
    .first<{ ok: number }>()
  return row !== null
}

/** In-batch authorization + state + window + quota guard over CURRENT db state. */
function targetCycleAssertions(actor: OpportunityActor, params: {
  accountId: string
  cycleId: string
  cardId: string
  usedOn: string
  /** Quota demand on the target cycle (already a delta for same-cycle fixes). */
  addCount: number
  addMinor: number
}): WriteAssertion[] {
  const scope = holderScopePredicate(actor)
  return [
    {
      name: 'usage-scope',
      sql: `EXISTS (
        SELECT 1 FROM opportunity_accounts a
        JOIN card_holders h ON h.id = a.holder_id
        WHERE a.id = ? AND a.status = 'active' AND a.eligibility != 'ineligible' AND ${scope.sql})`,
      binds: [params.accountId, ...scope.binds],
      violation: () => forbiddenOrNotFound('account'),
    },
    {
      name: 'card-linked',
      sql: `EXISTS (
        SELECT 1 FROM opportunity_account_cards ac
        WHERE ac.account_id = ? AND ac.card_id = ? AND ac.retired_at IS NULL)`,
      binds: [params.accountId, params.cardId],
      violation: () =>
        new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户或已解绑', { card_id: params.cardId }),
    },
    {
      name: 'cycle-active-and-window',
      sql: `EXISTS (
        SELECT 1 FROM opportunity_cycles c
        WHERE c.id = ? AND c.account_id = ? AND c.activation_state = 'active'
          AND c.usable_start_on <= ? AND (c.usable_end_before IS NULL OR ? < c.usable_end_before))`,
      binds: [params.cycleId, params.accountId, params.usedOn, params.usedOn],
      violation: () =>
        new OpportunityError('VALIDATION_FAILED', '该日期不在目标周期的可用范围内', {
          cycle_id: params.cycleId,
          used_on: params.usedOn,
        }),
    },
    {
      name: 'quota-headroom',
      sql: `EXISTS (
        SELECT 1 FROM opportunity_cycles c
        WHERE c.id = ? AND (c.count_limit IS NULL
          OR c.opening_used_count + c.used_count + c.reserved_count + ? <= c.count_limit)
          AND (c.amount_limit_minor IS NULL
          OR c.opening_used_minor + c.used_minor + c.reserved_minor + ? <= c.amount_limit_minor))`,
      binds: [params.cycleId, params.addCount, params.addMinor],
      violation: () => quotaExceeded({ cycle_id: params.cycleId }),
    },
  ]
}

// ---------------------------------------------------------------------------
// recordOpportunityUsage
// ---------------------------------------------------------------------------

export interface RecordUsageInput {
  account_id: string
  cycle_id: string
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  note: string | null
  request_key: string
}

export interface RecordUsageResult {
  usage_id: string
  status: 'active'
  revision: number
  cycle_id: string
  balance: CycleBalance
}

export async function recordOpportunityUsage(
  actor: OpportunityActor,
  input: RecordUsageInput,
  opts: { now?: string } = {},
): Promise<RecordUsageResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertAccountAccess(input.account_id, actor)

  validateQuantityAmount(input.quantity, input.amount_minor)
  const note = validateNote(input.note)

  const payload = {
    account_id: input.account_id,
    cycle_id: input.cycle_id,
    card_id: input.card_id,
    used_on: input.used_on,
    quantity: input.quantity,
    amount_minor: input.amount_minor,
    note,
  }
  // A committed same-key command answers before any mutable-state pre-read
  // can reject the retry (account archived / cycle voided in the meantime).
  const replayed = await replayCommittedResult<RecordUsageResult>(
    actor, input.request_key, RECORD_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const account = await db
    .prepare('SELECT id, status, eligibility, definition_id FROM opportunity_accounts WHERE id = ?')
    .bind(input.account_id)
    .first<{ id: string; status: string; eligibility: string; definition_id: string }>()
  if (!account) throw forbiddenOrNotFound('account')

  const cycle = await loadCycle(input.cycle_id, input.account_id)
  const version = await db
    .prepare('SELECT rules_json FROM opportunity_rule_versions WHERE id = ?')
    .bind(cycle.version_id)
    .first<{ rules_json: string }>()
  if (!version) throw new OpportunityError('DATABASE_UNAVAILABLE', '规则版本缺失，请重试')
  const rules = parseRules(version.rules_json)

  assertAccountEligibility(account, rules.requires_personal_confirmation)
  assertCycleWritable(cycle)
  assertUsableDateAndAmount(cycle, input.used_on, input.amount_minor, now)
  if (!(await cardLinkedToAccount(input.account_id, input.card_id))) {
    throw new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户或已解绑', { card_id: input.card_id })
  }

  const usageId = `ousg_${crypto.randomUUID()}`
  const result: RecordUsageResult = {
    usage_id: usageId,
    status: 'active',
    revision: 1,
    cycle_id: cycle.id,
    balance: balanceAfter(cycle, input.quantity, input.amount_minor),
  }

  // The engine's outcome is authoritative: a same-key replay returns the
  // COMMITTED result (with the original usage_id), never the locally built one.
  return (
    await runOpportunityCommand<RecordUsageResult>(
      actor,
      {
        command_type: 'recordOpportunityUsage',
        request_key: input.request_key,
        payload_fields: RECORD_PAYLOAD_FIELDS,
        payload,
        assertions: targetCycleAssertions(actor, {
          accountId: input.account_id,
          cycleId: cycle.id,
          cardId: input.card_id,
          usedOn: input.used_on,
          addCount: input.quantity,
          addMinor: input.amount_minor,
        }),
        events: [
          {
            entity_kind: 'usage',
            entity_id: usageId,
            event_type: 'usage.recorded',
            account_id: input.account_id,
            cycle_id: cycle.id,
            deltas: {
              delta_opening_count: 0,
              delta_opening_minor: 0,
              delta_used_count: input.quantity,
              delta_used_minor: input.amount_minor,
              delta_reserved_count: 0,
              delta_reserved_minor: 0,
            },
            after_json: {
              usage_id: usageId,
              card_id: input.card_id,
              used_on: input.used_on,
              quantity: input.quantity,
              amount_minor: input.amount_minor,
            },
            reason: note,
          },
        ],
        statements: [
          db
            .prepare(
              `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, note, created_by, updated_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              usageId,
              input.account_id,
              cycle.id,
              input.card_id,
              input.used_on,
              input.quantity,
              input.amount_minor,
              note,
              actor.user_id,
              actor.user_id,
              now,
              now,
            ),
        ],
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// correctOpportunityUsage
// ---------------------------------------------------------------------------

export interface CorrectUsageInput {
  usage_id: string
  used_on?: string
  /** Moving the usage to a different cycle of the same account. */
  cycle_id?: string
  card_id?: string
  quantity?: number
  amount_minor?: number
  note?: string | null
  reason: string
  expected_revision: number
  request_key: string
}

export interface CorrectUsageResult {
  usage_id: string
  revision: number
  cycle_id: string
  balance: CycleBalance
}

interface UsageRow {
  id: string
  account_id: string
  cycle_id: string
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  note: string | null
  status: 'active' | 'voided'
  revision: number
}

const USAGE_SQL = `SELECT id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, note, status, revision
  FROM opportunity_usages WHERE id = ?`

export async function correctOpportunityUsage(
  actor: OpportunityActor,
  input: CorrectUsageInput,
  opts: { now?: string } = {},
): Promise<CorrectUsageResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertUsageAccess(input.usage_id, actor)

  const reason = requireReason(input.reason)
  if (!Number.isInteger(input.expected_revision) || input.expected_revision < 1) {
    throw new OpportunityError('VALIDATION_FAILED', 'expected_revision 必须是正整数', {
      field: 'expected_revision',
    })
  }

  // Raw caller fields (not resolved values) so a retry of the same logical
  // command hashes identically regardless of intermediate state changes.
  const payload = {
    usage_id: input.usage_id,
    used_on: input.used_on ?? null,
    cycle_id: input.cycle_id ?? null,
    card_id: input.card_id ?? null,
    quantity: input.quantity ?? null,
    amount_minor: input.amount_minor ?? null,
    note: input.note ?? null,
    reason,
    expected_revision: input.expected_revision,
  }
  const replayed = await replayCommittedResult<CorrectUsageResult>(
    actor, input.request_key, CORRECT_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const usage = await db.prepare(USAGE_SQL).bind(input.usage_id).first<UsageRow>()
  if (!usage) throw forbiddenOrNotFound('usage')

  const targetCycleId = input.cycle_id ?? usage.cycle_id
  const targetCycle = await loadCycle(targetCycleId, usage.account_id)
  const sourceCycle = targetCycleId === usage.cycle_id ? targetCycle : await loadCycle(usage.cycle_id, usage.account_id)
  const crossCycle = targetCycleId !== usage.cycle_id

  const newQuantity = input.quantity ?? usage.quantity
  const newAmount = input.amount_minor ?? usage.amount_minor
  const newUsedOn = input.used_on ?? usage.used_on
  const newCardId = input.card_id ?? usage.card_id
  const newNote = input.note !== undefined ? validateNote(input.note) : usage.note

  validateQuantityAmount(newQuantity, newAmount)

  const account = await db
    .prepare('SELECT id, status, eligibility FROM opportunity_accounts WHERE id = ?')
    .bind(usage.account_id)
    .first<{ id: string; status: string; eligibility: string }>()
  if (!account) throw forbiddenOrNotFound('account')
  const version = await db
    .prepare('SELECT rules_json FROM opportunity_rule_versions WHERE id = ?')
    .bind(targetCycle.version_id)
    .first<{ rules_json: string }>()
  if (!version) throw new OpportunityError('DATABASE_UNAVAILABLE', '规则版本缺失，请重试')
  const rules = parseRules(version.rules_json)

  // Corrections target the recorded fact; a voided usage is disputed via its
  // own void audit, not re-corrected into existence. The pre-command status
  // lives in the batch assertion violation below so same-key replays of an
  // already-committed correction still return their result.
  assertAccountEligibility(account, rules.requires_personal_confirmation)
  assertCycleWritable(targetCycle)
  if (crossCycle) assertCycleWritable(sourceCycle)
  assertUsableDateAndAmount(targetCycle, newUsedOn, newAmount, now)
  if (!(await cardLinkedToAccount(usage.account_id, newCardId))) {
    throw new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户或已解绑', { card_id: newCardId })
  }

  const usageScope = holderScopePredicate(actor)
  const beforeFact = {
    cycle_id: usage.cycle_id,
    card_id: usage.card_id,
    used_on: usage.used_on,
    quantity: usage.quantity,
    amount_minor: usage.amount_minor,
    note: usage.note,
  }
  const afterFact = {
    cycle_id: targetCycleId,
    card_id: newCardId,
    used_on: newUsedOn,
    quantity: newQuantity,
    amount_minor: newAmount,
    note: newNote,
  }

  // Cross-cycle: reverse the source cycle (used −old) AND charge the target
  // (+new) in this same batch — a target shortage aborts both (A08).
  // Same-cycle: ONE delta event carrying new−old (zero when only the note
  // changes).
  const events: EventDraft[] = crossCycle
    ? [
        {
          entity_kind: 'usage' as const,
          entity_id: usage.id,
          event_type: 'usage.corrected.reversal',
          account_id: usage.account_id,
          cycle_id: sourceCycle.id,
          deltas: {
            delta_opening_count: 0,
            delta_opening_minor: 0,
            delta_used_count: -usage.quantity,
            delta_used_minor: -usage.amount_minor,
            delta_reserved_count: 0,
            delta_reserved_minor: 0,
          },
          before_json: beforeFact,
          after_json: null,
          reason,
        },
        {
          entity_kind: 'usage' as const,
          entity_id: usage.id,
          event_type: 'usage.corrected.apply',
          account_id: usage.account_id,
          cycle_id: targetCycle.id,
          deltas: {
            delta_opening_count: 0,
            delta_opening_minor: 0,
            delta_used_count: newQuantity,
            delta_used_minor: newAmount,
            delta_reserved_count: 0,
            delta_reserved_minor: 0,
          },
          before_json: null,
          after_json: afterFact,
          reason,
        },
      ]
    : [
        {
          entity_kind: 'usage' as const,
          entity_id: usage.id,
          event_type: 'usage.corrected',
          account_id: usage.account_id,
          cycle_id: targetCycle.id,
          deltas: {
            delta_opening_count: 0,
            delta_opening_minor: 0,
            delta_used_count: newQuantity - usage.quantity,
            delta_used_minor: newAmount - usage.amount_minor,
            delta_reserved_count: 0,
            delta_reserved_minor: 0,
          },
          before_json: beforeFact,
          after_json: afterFact,
          reason,
        },
      ]

  const result: CorrectUsageResult = {
    usage_id: usage.id,
    revision: input.expected_revision + 1,
    cycle_id: targetCycleId,
    balance: crossCycle
      ? balanceAfter(targetCycle, newQuantity, newAmount)
      : balanceAfter(targetCycle, newQuantity - usage.quantity, newAmount - usage.amount_minor),
  }

  // Replay returns the committed result (see recordOpportunityUsage).
  const outcome = await runOpportunityCommand<CorrectUsageResult>(actor, {
    command_type: 'correctOpportunityUsage',
    request_key: input.request_key,
    payload_fields: CORRECT_PAYLOAD_FIELDS,
    payload,
    assertions: [
      // tech spec §7.1 example assertion: active usage, expected revision,
      // holder still in scope — all re-proven inside the batch.
      {
        name: 'usage-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_usages u
          JOIN opportunity_accounts a ON a.id = u.account_id
          JOIN card_holders h ON h.id = a.holder_id
          WHERE u.id = ? AND u.revision = ? AND u.status = 'active' AND ${usageScope.sql})`,
        binds: [input.usage_id, input.expected_revision, ...usageScope.binds],
        violation: async () => {
          const row = await db
            .prepare('SELECT status FROM opportunity_usages WHERE id = ?')
            .bind(input.usage_id)
            .first<{ status: string }>()
          if (row?.status === 'voided') {
            return new OpportunityError('INVALID_TRANSITION', '已撤销的使用不能更正；如需恢复请重新登记', {
              usage_id: input.usage_id,
            })
          }
          return revisionConflict({ usage_id: input.usage_id })
        },
      },
      ...targetCycleAssertions(actor, {
        accountId: usage.account_id,
        cycleId: targetCycleId,
        cardId: newCardId,
        usedOn: newUsedOn,
        // same-cycle corrections consume only the delta; a cross-cycle move
        // must fit the new quantity entirely into the target cycle
        addCount: crossCycle ? newQuantity : newQuantity - usage.quantity,
        addMinor: crossCycle ? newAmount : newAmount - usage.amount_minor,
      }),
    ],
    events,
    statements: [
      db
        .prepare(
          `UPDATE opportunity_usages
           SET cycle_id = ?, card_id = ?, used_on = ?, quantity = ?, amount_minor = ?, note = ?,
               revision = revision + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'active'`,
        )
        .bind(
          targetCycleId,
          newCardId,
          newUsedOn,
          newQuantity,
          newAmount,
          newNote,
          actor.user_id,
          now,
          input.usage_id,
          input.expected_revision,
        ),
    ],
    result,
  }, { now })

  return outcome.result
}

// ---------------------------------------------------------------------------
// voidOpportunityUsage
// ---------------------------------------------------------------------------

export interface VoidUsageInput {
  usage_id: string
  reason: string
  expected_revision: number
  request_key: string
}

export interface VoidUsageResult {
  usage_id: string
  status: 'voided'
  revision: number
  cycle_id: string
  balance: CycleBalance
}

export async function voidOpportunityUsage(
  actor: OpportunityActor,
  input: VoidUsageInput,
  opts: { now?: string } = {},
): Promise<VoidUsageResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertUsageAccess(input.usage_id, actor)

  const reason = requireReason(input.reason)
  if (!Number.isInteger(input.expected_revision) || input.expected_revision < 1) {
    throw new OpportunityError('VALIDATION_FAILED', 'expected_revision 必须是正整数', {
      field: 'expected_revision',
    })
  }

  const payload = {
    usage_id: input.usage_id,
    reason,
    expected_revision: input.expected_revision,
  }
  const replayed = await replayCommittedResult<VoidUsageResult>(
    actor, input.request_key, VOID_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  const usage = await db.prepare(USAGE_SQL).bind(input.usage_id).first<UsageRow>()
  if (!usage) throw forbiddenOrNotFound('usage')

  // The reversal lands on the usage's OWN cycle only — voiding a closed
  // period's usage never adds headroom to the current one (A09).
  const cycle = await loadCycle(usage.cycle_id, usage.account_id)
  const usageScope = holderScopePredicate(actor)

  const result: VoidUsageResult = {
    usage_id: usage.id,
    status: 'voided',
    revision: input.expected_revision + 1,
    cycle_id: cycle.id,
    balance: balanceAfter(cycle, -usage.quantity, -usage.amount_minor),
  }

  // Replay returns the committed result (see recordOpportunityUsage).
  const outcome = await runOpportunityCommand<VoidUsageResult>(actor, {
    command_type: 'voidOpportunityUsage',
    request_key: input.request_key,
    payload_fields: VOID_PAYLOAD_FIELDS,
    payload,
    assertions: [
      {
        name: 'usage-active-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_usages u
          JOIN opportunity_accounts a ON a.id = u.account_id
          JOIN card_holders h ON h.id = a.holder_id
          WHERE u.id = ? AND u.revision = ? AND u.status = 'active' AND ${usageScope.sql})`,
        binds: [input.usage_id, input.expected_revision, ...usageScope.binds],
        violation: async () => {
          // A second void under a different key: the fact was already
          // disputed once — not a revision race, say what happened.
          const row = await db
            .prepare('SELECT status FROM opportunity_usages WHERE id = ?')
            .bind(input.usage_id)
            .first<{ status: string }>()
          if (row?.status === 'voided') {
            return new OpportunityError('INVALID_TRANSITION', '该使用已撤销，不能重复撤销', {
              usage_id: input.usage_id,
            })
          }
          return revisionConflict({ usage_id: input.usage_id })
        },
      },
    ],
    events: [
      {
        entity_kind: 'usage',
        entity_id: usage.id,
        event_type: 'usage.voided',
        account_id: usage.account_id,
        cycle_id: cycle.id,
        deltas: {
          delta_opening_count: 0,
          delta_opening_minor: 0,
          delta_used_count: -usage.quantity,
          delta_used_minor: -usage.amount_minor,
          delta_reserved_count: 0,
          delta_reserved_minor: 0,
        },
        before_json: {
          cycle_id: usage.cycle_id,
          card_id: usage.card_id,
          used_on: usage.used_on,
          quantity: usage.quantity,
          amount_minor: usage.amount_minor,
        },
        reason,
      },
    ],
    statements: [
      db
        .prepare(
          `UPDATE opportunity_usages
           SET status = 'voided', revision = revision + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'active'`,
        )
        .bind(actor.user_id, now, input.usage_id, input.expected_revision),
    ],
    result,
  }, { now })

  return outcome.result
}

// ---------------------------------------------------------------------------
// getUsageHistory — read-only, scoped, cursor-paginated
// ---------------------------------------------------------------------------

export interface UsageHistoryInput {
  account_id: string
  /** Inclusive lower bound on used_on. */
  from_on?: string
  /** Exclusive upper bound on used_on. */
  to_before?: string
  status?: 'active' | 'voided'
  cursor?: string | null
  limit?: number
}

export interface UsageHistoryEvent {
  id: string
  event_type: string
  delta_used_count: number
  delta_used_minor: number
  reason: string | null
  created_at: string
}

export interface UsageHistoryItem {
  id: string
  cycle_id: string
  cycle_key: string
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  note: string | null
  status: 'active' | 'voided'
  revision: number
  updated_at: string
  events: UsageHistoryEvent[]
}

export interface UsageHistoryPage {
  items: UsageHistoryItem[]
  next_cursor: string | null
}

const HISTORY_DEFAULT_LIMIT = 30
const HISTORY_MAX_LIMIT = 100

interface HistoryCursor {
  /** Filter fingerprint; a changed filter restarts from the first page. */
  k: string
  u: string
  i: string
}

function historyFilterKey(i: UsageHistoryInput): string {
  return [i.status ?? '', i.from_on ?? '', i.to_before ?? ''].join('|')
}

function encodeHistoryCursor(c: HistoryCursor): string {
  return btoa(JSON.stringify(c))
}

function decodeHistoryCursor(raw: string | null | undefined, filterKey: string): HistoryCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(atob(raw)) as HistoryCursor
    // Changed filters cannot inherit a position from another filter's cursor.
    if (typeof parsed.k !== 'string' || parsed.k !== filterKey) return null
    if (typeof parsed.u !== 'string' || typeof parsed.i !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function getUsageHistory(
  actor: OpportunityActor,
  input: UsageHistoryInput,
): Promise<UsageHistoryPage> {
  const db = getDb()
  await assertAccountAccess(input.account_id, actor)

  if (input.from_on !== undefined && !isValidCivilDate(input.from_on)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 from_on 不合法', { field: 'from_on' })
  }
  if (input.to_before !== undefined && !isValidCivilDate(input.to_before)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 to_before 不合法', { field: 'to_before' })
  }
  if (input.status !== undefined && input.status !== 'active' && input.status !== 'voided') {
    throw new OpportunityError('VALIDATION_FAILED', '参数 status 只能是 active 或 voided', { field: 'status' })
  }
  const limit = input.limit ?? HISTORY_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
    throw new OpportunityError('VALIDATION_FAILED', `limit 必须是 1–${HISTORY_MAX_LIMIT}`, { field: 'limit' })
  }

  const filterKey = historyFilterKey(input)
  const cursor = decodeHistoryCursor(input.cursor, filterKey)

  const where: string[] = ['u.account_id = ?']
  const binds: unknown[] = [input.account_id]
  if (input.status) {
    where.push('u.status = ?')
    binds.push(input.status)
  }
  if (input.from_on !== undefined) {
    where.push('u.used_on >= ?')
    binds.push(input.from_on)
  }
  if (input.to_before !== undefined) {
    where.push('u.used_on < ?')
    binds.push(input.to_before)
  }
  if (cursor) {
    // newest-first pagination over the (account_id, used_on, id) index
    where.push('(u.used_on < ? OR (u.used_on = ? AND u.id < ?))')
    binds.push(cursor.u, cursor.u, cursor.i)
  }

  const { results } = await db
    .prepare(
      `SELECT u.id, u.cycle_id, u.card_id, u.used_on, u.quantity, u.amount_minor, u.note,
              u.status, u.revision, u.updated_at, c.cycle_key
       FROM opportunity_usages u
       JOIN opportunity_cycles c ON c.id = u.cycle_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.used_on DESC, u.id DESC
       LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<Omit<UsageHistoryItem, 'events'>>()

  const page = results.slice(0, limit)
  const items = await attachAuditEvents(page)

  return {
    items,
    next_cursor:
      results.length > limit
        ? encodeHistoryCursor({ k: filterKey, u: page[page.length - 1].used_on, i: page[page.length - 1].id })
        : null,
  }
}

async function attachAuditEvents(
  usages: ReadonlyArray<Omit<UsageHistoryItem, 'events'>>,
): Promise<UsageHistoryItem[]> {
  if (usages.length === 0) return []
  const db = getDb()
  const placeholders = usages.map(() => '?').join(',')
  const { results } = await db
    .prepare(
      `SELECT id, entity_id, event_type, delta_used_count, delta_used_minor, reason, created_at
       FROM opportunity_events
       WHERE entity_kind = 'usage' AND entity_id IN (${placeholders})
       ORDER BY rowid`,
    )
    .bind(...usages.map((u) => u.id))
    .all<UsageHistoryEvent & { entity_id: string }>()
  const byUsage = new Map<string, UsageHistoryEvent[]>()
  for (const { entity_id, ...event } of results) {
    const list = byUsage.get(entity_id) ?? []
    list.push(event)
    byUsage.set(entity_id, list)
  }
  return usages.map((u) => ({ ...u, events: byUsage.get(u.id) ?? [] }))
}
