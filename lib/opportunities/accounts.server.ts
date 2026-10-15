// lib/opportunities/accounts.server.ts — accounts, linked cards, cycle
// materialization and opening verification (plan Task 7). Every mutation goes
// through the Task 8 command engine: no direct INSERT/UPDATE path exists
// beside it. Scope keys are computed server-side (`card:<id>` / `holder:<id>`)
// and cycles are materialized on demand:
//   - the nominal window comes from getCycleWindow (dates.ts)
//   - the version a window can prove comes from catalog.pickCycleVersion
//   - usable_start is clipped to max(period_start, version_as_of, eligibility,
//     valid_from) so a mid-cycle first model never fabricates past eligibility

/// <reference types="@cloudflare/workers-types" />

import { getDb } from '../db/client'
import { getCycleWindow, isValidCivilDate, isValidRfc3339Utc, localDateInZone } from './dates'
import { OpportunityError, forbiddenOrNotFound } from './errors'
import { resolveOpportunityScope, assertAccountAccess } from './scope.server'
import { runOpportunityCommand } from './writes.server'
import type { EventDraft } from './writes.server'
import {
  getDefinition,
  listRuleVersions,
  pickCycleVersion,
  newestRuleVersion,
  parseRules,
} from './catalog.server'
import type { RuleSnapshotV1, OpportunityActor } from './types'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface AccountInfo {
  id: string
  definition_id: string
  holder_id: string
  scope_kind: 'card' | 'holder'
  scope_key: string
  revision: number
}

export interface CycleInfo {
  id: string
  cycle_key: string
  period_start_on: string
  period_end_before: string | null
  usable_start_on: string
  usable_end_before: string | null
  allocation_kind: 'regular' | 'grant'
  activation_state: 'active' | 'pending_claim' | 'voided'
  balance_verified: 0 | 1
  count_limit: number | null
  amount_limit_minor: number | null
}

const CYCLE_COLUMNS = `id, cycle_key, period_start_on, period_end_before, usable_start_on, usable_end_before,
  allocation_kind, activation_state, balance_verified, count_limit, amount_limit_minor`

function rowToCycleInfo(row: Record<string, unknown>): CycleInfo {
  return {
    id: row.id as string,
    cycle_key: row.cycle_key as string,
    period_start_on: row.period_start_on as string,
    period_end_before: (row.period_end_before as string | null) ?? null,
    usable_start_on: row.usable_start_on as string,
    usable_end_before: (row.usable_end_before as string | null) ?? null,
    allocation_kind: row.allocation_kind as CycleInfo['allocation_kind'],
    activation_state: row.activation_state as CycleInfo['activation_state'],
    balance_verified: (row.balance_verified as 0 | 1),
    count_limit: (row.count_limit as number | null) ?? null,
    amount_limit_minor: (row.amount_limit_minor as number | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Cycle planning (version resolution + usable clipping) — pure over inputs
// ---------------------------------------------------------------------------

export interface CyclePlan {
  cycleId: string
  cycle_key: string
  period_start_on: string
  period_end_before: string | null
  usable_start_on: string
  usable_end_before: string | null
  version_id: string
  version_as_of_on: string
  time_zone: string
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  activation_state: 'active' | 'pending_claim'
}

/**
 * Plans the regular cycle covering `localDate` for an account. Returns null
 * when no version proves the window (nothing materializes), when the rule's
 * valid range doesn't intersect the cycle, or for grant_only allocations
 * (grants get their own `grant:<fulfillment>` cycles at claim time).
 */
export function planCycle(
  rules: RuleSnapshotV1,
  versions: ReadonlyArray<{ id: string; effective_from: string; rules_json: string }>,
  localDate: string,
  anchor: { issued_on: string | null; activated_on: string | null },
  eligible_from_on: string | null,
): CyclePlan | null {
  if (rules.allocation === 'grant_only') return null
  const window = getCycleWindow(rules, localDate, anchor)
  const resolution = pickCycleVersion(versions, window.period_start_on, window.period_end_before)
  if (!resolution) return null

  const starts = [
    window.period_start_on,
    resolution.version_as_of_on,
    ...(eligible_from_on ? [eligible_from_on] : []),
    ...(resolution.rules.valid_from ? [resolution.rules.valid_from] : []),
  ]
  const usable_start_on = starts.reduce((a, b) => (a >= b ? a : b))

  const ends = [
    ...(window.period_end_before ? [window.period_end_before] : []),
    ...(resolution.rules.valid_until_before ? [resolution.rules.valid_until_before] : []),
  ]
  const usable_end_before = ends.length ? ends.reduce((a, b) => (a <= b ? a : b)) : null
  if (usable_end_before !== null && usable_start_on >= usable_end_before) return null

  return {
    cycleId: `ocyc_${crypto.randomUUID()}`,
    cycle_key: window.cycle_key,
    period_start_on: window.period_start_on,
    period_end_before: window.period_end_before,
    usable_start_on,
    usable_end_before,
    version_id: resolution.version_id,
    version_as_of_on: resolution.version_as_of_on,
    time_zone: resolution.rules.time_zone,
    count_limit: resolution.rules.count_limit,
    amount_limit_minor: resolution.rules.amount_limit_minor,
    currency: resolution.rules.currency,
    activation_state: resolution.rules.allocation === 'claim_gated' ? 'pending_claim' : 'active',
  }
}

function cycleInsertStatement(plan: CyclePlan, accountId: string, now: string): D1PreparedStatement {
  return getDb()
    .prepare(
      `INSERT INTO opportunity_cycles (
         id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
         activation_state, period_start_on, period_end_before, usable_start_on, usable_end_before,
         time_zone, count_limit, amount_limit_minor, currency, created_at)
       VALUES (?,?,?,?,?,'regular',?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      plan.cycleId,
      accountId,
      plan.version_id,
      plan.version_as_of_on,
      plan.cycle_key,
      plan.activation_state,
      plan.period_start_on,
      plan.period_end_before,
      plan.usable_start_on,
      plan.usable_end_before,
      plan.time_zone,
      plan.count_limit,
      plan.amount_limit_minor,
      plan.currency,
      now,
    )
}

function cycleCreatedEvent(accountId: string, plan: CyclePlan): EventDraft {
  return {
    entity_kind: 'cycle',
    entity_id: plan.cycleId,
    event_type: 'cycle.created',
    // same ordering constraint as account.created: no FK target yet
    account_id: null,
    cycle_id: null,
    deltas: {
      delta_opening_count: 0, delta_opening_minor: 0,
      delta_used_count: 0, delta_used_minor: 0,
      delta_reserved_count: 0, delta_reserved_minor: 0,
    },
    after_json: {
      cycle_key: plan.cycle_key,
      period_start_on: plan.period_start_on,
      period_end_before: plan.period_end_before,
      usable_start_on: plan.usable_start_on,
      usable_end_before: plan.usable_end_before,
    },
  }
}

// ---------------------------------------------------------------------------
// createOpportunityAccount
// ---------------------------------------------------------------------------

export interface CreateAccountInput {
  definition_id: string
  holder_id: string
  card_ids: string[]
  scope_kind: 'card' | 'holder'
  request_key: string
}

export interface CreateAccountResult {
  account: AccountInfo
  cycle: CycleInfo | null
  /** true when the account already existed (same definition + scope). */
  already_exists: boolean
}

export async function createOpportunityAccount(
  actor: OpportunityActor,
  input: CreateAccountInput,
  opts: { now?: string } = {},
): Promise<CreateAccountResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (!Array.isArray(input.card_ids) || input.card_ids.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'card_ids 不能为空')
  }
  if (input.scope_kind === 'card' && input.card_ids.length !== 1) {
    throw new OpportunityError('VALIDATION_FAILED', 'scope_kind=card 时只能绑定一张卡')
  }
  const cardIds = [...new Set(input.card_ids)]

  // Holder must be inside the actor's scope (server-side, both roles).
  const scope = await resolveOpportunityScope(actor)
  if (!scope.includes(input.holder_id)) throw forbiddenOrNotFound('holder')

  // Definition must exist, be active, and be visible to this holder.
  const definition = await getDefinition(input.definition_id)
  if (!definition || definition.status !== 'active') throw forbiddenOrNotFound('definition')
  if (definition.visibility === 'private' && definition.private_holder_id !== input.holder_id) {
    throw forbiddenOrNotFound('definition')
  }

  // Actual cards must belong to the holder and match the definition's products
  // (product membership is a definition-level fact — checked against the
  // newest published version regardless of cycle coverage).
  const versions = await listRuleVersions(input.definition_id)
  const newest = newestRuleVersion(versions)
  if (!newest) {
    throw new OpportunityError('VALIDATION_FAILED', '该定义尚无已发布规则版本')
  }
  const newestRules = parseRules(newest.rules_json)

  const placeholders = cardIds.map(() => '?').join(',')
  const { results: cardRows } = await db
    .prepare(`SELECT id, holder_id, card_product_id, issued_on, activated_on FROM credit_cards WHERE id IN (${placeholders})`)
    .bind(...cardIds)
    .all<{ id: string; holder_id: string; card_product_id: string; issued_on: string | null; activated_on: string | null }>()
  const cards = new Map(cardRows.map((r) => [r.id, r]))
  if (cards.size !== cardIds.length) {
    throw new OpportunityError('VALIDATION_FAILED', '部分卡不存在')
  }
  for (const card of cards.values()) {
    if (card.holder_id !== input.holder_id) {
      throw new OpportunityError('VALIDATION_FAILED', '卡与持卡人不匹配', { card_id: card.id })
    }
    if (!newestRules.card_product_ids.includes(card.card_product_id)) {
      throw new OpportunityError('VALIDATION_FAILED', '卡产品不在该定义的适用范围内', { card_id: card.id })
    }
  }

  // Server-computed scope key.
  const scopeKey =
    input.scope_kind === 'card' ? `card:${cardIds[0]}` : `holder:${input.holder_id}`

  // Idempotency: an existing account for (definition, scope) is returned as-is
  // when the holder matches; a different holder on the same scope is refused.
  const existing = await db
    .prepare('SELECT id, definition_id, holder_id, scope_kind, scope_key, revision FROM opportunity_accounts WHERE definition_id = ? AND scope_key = ?')
    .bind(input.definition_id, scopeKey)
    .first<AccountInfo>()
  if (existing) {
    if (existing.holder_id !== input.holder_id) {
      throw new OpportunityError('CONFLICT', '该定义与卡/持有人的账户已绑定到其他持卡人', {
        account_id: existing.id,
      })
    }
    const cycle = await materializeCycleForDate(actor, existing.id, planLocalDate(newestRules, now), `sys:cycle:${existing.id}:${now}`, { now })
    return { account: existing, cycle, already_exists: true }
  }

  // Cycle plan for the first materialization (may be null — grant-only, no
  // provable version, or valid range outside the window).
  const anchorCard = [...cards.values()].sort((a, b) => a.id.localeCompare(b.id)).find((c) => c.issued_on || c.activated_on)
  const anchor = { issued_on: anchorCard?.issued_on ?? null, activated_on: anchorCard?.activated_on ?? null }
  const plan = planCycle(newestRules, versions, planLocalDate(newestRules, now), anchor, null)

  const accountId = `oacc_${crypto.randomUUID()}`
  const events: EventDraft[] = [
    {
      entity_kind: 'account',
      entity_id: accountId,
      event_type: 'account.created',
      // account/cycle rows are inserted by statements after events (engine
      // order §7.1), so creation events carry no FK target — entity linkage
      // and audit retrieval go through (entity_kind, entity_id).
      account_id: null,
      cycle_id: null,
      deltas: {
        delta_opening_count: 0, delta_opening_minor: 0,
        delta_used_count: 0, delta_used_minor: 0,
        delta_reserved_count: 0, delta_reserved_minor: 0,
      },
      after_json: {
        definition_id: input.definition_id,
        holder_id: input.holder_id,
        scope_kind: input.scope_kind,
        scope_key: scopeKey,
        card_ids: cardIds,
      },
    },
  ]
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(accountId, input.definition_id, input.holder_id, input.scope_kind, scopeKey, actor.user_id, now),
    ...cardIds.map((cardId) =>
      db
        .prepare(
          `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
           VALUES (?,?,?,?)`,
        )
        .bind(accountId, input.definition_id, input.holder_id, cardId),
    ),
  ]
  if (plan) {
    statements.push(cycleInsertStatement(plan, accountId, now))
    events.push(cycleCreatedEvent(accountId, plan))
  }

  const accountInfo: AccountInfo = {
    id: accountId,
    definition_id: input.definition_id,
    holder_id: input.holder_id,
    scope_kind: input.scope_kind,
    scope_key: scopeKey,
    revision: 1,
  }
  const cycleInfo: CycleInfo | null = plan
    ? {
        id: plan.cycleId,
        cycle_key: plan.cycle_key,
        period_start_on: plan.period_start_on,
        period_end_before: plan.period_end_before,
        usable_start_on: plan.usable_start_on,
        usable_end_before: plan.usable_end_before,
        allocation_kind: 'regular',
        activation_state: plan.activation_state,
        balance_verified: 0,
        count_limit: plan.count_limit,
        amount_limit_minor: plan.amount_limit_minor,
      }
    : null

  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const scopePredicate =
    actor.role === 'admin' ? '(h.created_by = ? OR h.managed_by = ?)' : 'h.auth_user_id = ?'

  // Replay must return the committed account/cycle ids, not fresh random ones.
  return (
    await runOpportunityCommand<CreateAccountResult>(actor, {
    command_type: 'createOpportunityAccount',
    request_key: input.request_key,
    payload_fields: ['definition_id', 'holder_id', 'card_ids', 'scope_kind'],
    payload: {
      definition_id: input.definition_id,
      holder_id: input.holder_id,
      card_ids: cardIds,
      scope_kind: input.scope_kind,
    },
    assertions: [
      {
        // In-batch authorization + anti-double-create (concurrent safety net).
        name: 'holder-scope-and-scope-free',
        sql: `EXISTS (
          SELECT 1 FROM card_holders h WHERE h.id = ? AND ${scopePredicate})
          AND NOT EXISTS (
            SELECT 1 FROM opportunity_accounts a WHERE a.definition_id = ? AND a.scope_key = ?)`,
        binds: [input.holder_id, ...scopeBinds, input.definition_id, scopeKey],
        violation: () =>
          new OpportunityError('CONFLICT', '该账户已存在', { definition_id: input.definition_id, scope_key: scopeKey }),
      },
    ],
    events,
    statements,
    result: { account: accountInfo, cycle: cycleInfo, already_exists: false },
    }, { now })
  ).result
}

/** The account's rule-local "today" used for cycle planning. */
function planLocalDate(rules: RuleSnapshotV1, nowIso: string): string {
  return localDateInZone(new Date(nowIso), rules.time_zone)
}

// ---------------------------------------------------------------------------
// materializeCycleForDate — idempotent on-demand cycle creation
// ---------------------------------------------------------------------------

export async function materializeCycleForDate(
  actor: OpportunityActor,
  accountId: string,
  localDate: string,
  requestKey: string,
  opts: { now?: string } = {},
): Promise<CycleInfo | null> {
  if (!isValidCivilDate(localDate)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 localDate 不合法', { field: 'localDate' })
  }
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertAccountAccess(accountId, actor)

  const account = await db
    .prepare('SELECT id, definition_id, holder_id, eligible_from_on FROM opportunity_accounts WHERE id = ?')
    .bind(accountId)
    .first<{ id: string; definition_id: string; holder_id: string; eligible_from_on: string | null }>()
  if (!account) throw forbiddenOrNotFound('account')

  const versions = await listRuleVersions(account.definition_id)
  const newest = newestRuleVersion(versions)
  if (!newest) return null
  const rules = parseRules(newest.rules_json)

  // Find the nominal cycle covering localDate, then reuse its existing row.
  const anchor = await accountAnchor(accountId)
  const probe = getCycleWindow(rules, localDate, anchor)
  const existing = await db
    .prepare(`SELECT ${CYCLE_COLUMNS} FROM opportunity_cycles WHERE account_id = ? AND cycle_key = ?`)
    .bind(accountId, probe.cycle_key)
    .first<Record<string, unknown>>()
  if (existing) return rowToCycleInfo(existing)

  const plan = planCycle(rules, versions, localDate, anchor, account.eligible_from_on)
  if (!plan) return null

  await runOpportunityCommand(actor, {
    command_type: 'materializeOpportunityCycle',
    request_key: requestKey,
    payload_fields: ['account_id', 'cycle_key'],
    payload: { account_id: accountId, cycle_key: plan.cycle_key },
    assertions: [
      {
        name: 'cycle-absent',
        sql: `NOT EXISTS (
          SELECT 1 FROM opportunity_cycles c WHERE c.account_id = ? AND c.cycle_key = ?)`,
        binds: [accountId, plan.cycle_key],
        violation: () =>
          new OpportunityError('CONFLICT', '该周期已存在', { account_id: accountId, cycle_key: plan.cycle_key }),
      },
    ],
    events: [cycleCreatedEvent(accountId, plan)],
    statements: [cycleInsertStatement(plan, accountId, now)],
    result: { cycle_id: plan.cycleId },
  }, { now })

  // Re-read the committed row: on a same-key replay the freshly generated
  // plan.cycleId never persisted, and the row is the truth either way.
  const committed = await db
    .prepare(`SELECT ${CYCLE_COLUMNS} FROM opportunity_cycles WHERE account_id = ? AND cycle_key = ?`)
    .bind(accountId, plan.cycle_key)
    .first<Record<string, unknown>>()
  if (!committed) {
    throw new OpportunityError('DATABASE_UNAVAILABLE', '周期创建状态异常，请重试')
  }
  return rowToCycleInfo(committed)
}

/** Anniversary anchors from the account's linked cards (earliest known date). */
async function accountAnchor(accountId: string): Promise<{ issued_on: string | null; activated_on: string | null }> {
  const { results } = await getDb()
    .prepare(
      `SELECT cc.issued_on, cc.activated_on
       FROM opportunity_account_cards ac
       JOIN credit_cards cc ON cc.id = ac.card_id
       WHERE ac.account_id = ? AND ac.retired_at IS NULL
       ORDER BY cc.issued_on ASC, cc.activated_on ASC`,
    )
    .bind(accountId)
    .all<{ issued_on: string | null; activated_on: string | null }>()
  return {
    issued_on: results.find((r) => r.issued_on)?.issued_on ?? null,
    activated_on: results.find((r) => r.activated_on)?.activated_on ?? null,
  }
}

// ---------------------------------------------------------------------------
// confirmOpportunityEligibility
// ---------------------------------------------------------------------------

export interface ConfirmEligibilityInput {
  account_id: string
  eligibility: 'unknown' | 'confirmed' | 'ineligible'
  eligible_from_on: string | null
  note: string | null
  expected_revision: number
  request_key: string
}

export async function confirmOpportunityEligibility(
  actor: OpportunityActor,
  input: ConfirmEligibilityInput,
  opts: { now?: string } = {},
): Promise<{ account_id: string; revision: number }> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertAccountAccess(input.account_id, actor)

  const account = await db
    .prepare('SELECT id, definition_id, revision FROM opportunity_accounts WHERE id = ?')
    .bind(input.account_id)
    .first<{ id: string; definition_id: string; revision: number }>()
  if (!account) throw forbiddenOrNotFound('account')

  let eligibleFrom = input.eligible_from_on
  if (input.eligibility === 'confirmed') {
    if (eligibleFrom !== null && !isValidCivilDate(eligibleFrom)) {
      throw new OpportunityError('VALIDATION_FAILED', '参数 eligible_from_on 不合法', { field: 'eligible_from_on' })
    }
    if (eligibleFrom === null) {
      // Unknown personal start defaults to the confirmation's local day,
      // never created_at (which is not the bank's approval date).
      const versions = await listRuleVersions(account.definition_id)
      const newest = newestRuleVersion(versions)
      if (!newest) throw new OpportunityError('VALIDATION_FAILED', '该定义尚无已发布规则版本')
      eligibleFrom = localDateInZone(new Date(now), parseRules(newest.rules_json).time_zone)
    }
  } else {
    eligibleFrom = null
  }

  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const scopePredicate =
    actor.role === 'admin' ? '(h.created_by = ? OR h.managed_by = ?)' : 'h.auth_user_id = ?'

  const result = { account_id: account.id, revision: input.expected_revision + 1 }
  const outcome = await runOpportunityCommand<{ account_id: string; revision: number }>(actor, {
    command_type: 'confirmOpportunityEligibility',
    request_key: input.request_key,
    payload_fields: ['account_id', 'eligibility', 'eligible_from_on'],
    payload: { account_id: input.account_id, eligibility: input.eligibility, eligible_from_on: eligibleFrom },
    assertions: [
      {
        name: 'account-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_accounts a
          JOIN card_holders h ON h.id = a.holder_id
          WHERE a.id = ? AND a.revision = ? AND a.status = 'active' AND ${scopePredicate})`,
        binds: [input.account_id, input.expected_revision, ...scopeBinds],
        violation: () =>
          new OpportunityError('REVISION_CONFLICT', '数据已被其他操作修改，请刷新后重试', {
            account_id: input.account_id,
          }),
      },
    ],
    events: [
      {
        entity_kind: 'account',
        entity_id: account.id,
        event_type: 'account.eligibility_confirmed',
        account_id: account.id,
        cycle_id: null,
        deltas: {
          delta_opening_count: 0, delta_opening_minor: 0,
          delta_used_count: 0, delta_used_minor: 0,
          delta_reserved_count: 0, delta_reserved_minor: 0,
        },
        before_json: null,
        after_json: { eligibility: input.eligibility, eligible_from_on: eligibleFrom },
        reason: input.note ?? null,
      },
    ],
    statements: [
      db
        .prepare(
          `UPDATE opportunity_accounts
           SET eligibility = ?, eligibility_note = ?, eligibility_confirmed_by = ?,
               eligibility_confirmed_at = ?, eligible_from_on = ?, revision = revision + 1
           WHERE id = ? AND revision = ? AND status = 'active'`,
        )
        .bind(
          input.eligibility,
          input.note,
          actor.user_id,
          now,
          eligibleFrom,
          input.account_id,
          input.expected_revision,
        ),
    ],
    result,
  }, { now })

  // Replay returns the committed result.
  return outcome.result
}

// ---------------------------------------------------------------------------
// confirmOpeningBalance (tech spec §7.2)
// ---------------------------------------------------------------------------

export interface ConfirmOpeningInput {
  cycle_id: string
  /** Total consumed up to as_of_on as entered in the verification form —
   *  including already-recorded usages, which the server subtracts. */
  opening_used_count: number
  opening_used_minor: number
  as_of_on: string
  reason: string | null
  expected_revision: number
  request_key: string
}

export interface ConfirmOpeningResult {
  cycle_id: string
  revision: number
  balance_verified: 0 | 1
  /** The extra opening the user could not enumerate row by row. */
  extra_opening_count: number
  extra_opening_minor: number
}

/** Unassigned legacy rows on this definition's products up to a date. */
async function countUnassignedLegacyUsages(
  cardProductIds: readonly string[],
  asOfOn: string,
): Promise<number> {
  const db = getDb()
  const products = [...new Set(cardProductIds)]
  if (products.length === 0) return 0
  const placeholders = products.map(() => '?').join(',')
  const benefitRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM benefit_usages bu
       JOIN benefits b ON b.id = bu.benefit_id
       WHERE b.card_product_id IN (${placeholders}) AND bu.used_at <= ?
         AND NOT EXISTS (SELECT 1 FROM opportunity_legacy_links l
                         WHERE l.source_table = 'benefit_usages' AND l.source_id = bu.id)`,
    )
    .bind(...products, asOfOn)
    .first<{ n: number }>()
  const promoRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM promo_usages pu
       JOIN promos p ON p.id = pu.promo_id
       WHERE p.card_product_id IN (${placeholders}) AND pu.used_at <= ?
         AND NOT EXISTS (SELECT 1 FROM opportunity_legacy_links l
                         WHERE l.source_table = 'promo_usages' AND l.source_id = pu.id)`,
    )
    .bind(...products, asOfOn)
    .first<{ n: number }>()
  return (benefitRow?.n ?? 0) + (promoRow?.n ?? 0)
}

export async function confirmOpeningBalance(
  actor: OpportunityActor,
  input: ConfirmOpeningInput,
  opts: { now?: string } = {},
): Promise<ConfirmOpeningResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  const cycle = await db
    .prepare(
      `SELECT id, account_id, revision, opening_used_count, opening_used_minor,
              reserved_count, reserved_minor, balance_verified
       FROM opportunity_cycles WHERE id = ?`,
    )
    .bind(input.cycle_id)
    .first<{
      id: string; account_id: string; revision: number
      opening_used_count: number; opening_used_minor: number
      reserved_count: number; reserved_minor: number; balance_verified: 0 | 1
    }>()
  if (!cycle) throw forbiddenOrNotFound('cycle')
  await assertAccountAccess(cycle.account_id, actor)

  if (!isValidCivilDate(input.as_of_on)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 as_of_on 不合法', { field: 'as_of_on' })
  }
  if (!Number.isInteger(input.opening_used_count) || input.opening_used_count < 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'opening_used_count 必须是非负整数')
  }
  if (!Number.isInteger(input.opening_used_minor) || input.opening_used_minor < 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'opening_used_minor 必须是非负整数')
  }

  // Already explicitly recorded inside the window — the form total includes
  // them, so subtract instead of double counting.
  const recorded = await db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS c, COALESCE(SUM(amount_minor), 0) AS m
       FROM opportunity_usages
       WHERE cycle_id = ? AND status = 'active' AND used_on <= ?`,
    )
    .bind(input.cycle_id, input.as_of_on)
    .first<{ c: number; m: number }>()

  const extraCount = input.opening_used_count - (recorded?.c ?? 0) - cycle.opening_used_count
  const extraMinor = input.opening_used_minor - (recorded?.m ?? 0) - cycle.opening_used_minor
  if (extraCount < 0 || extraMinor < 0) {
    throw new OpportunityError(
      'VALIDATION_FAILED',
      '核对总额小于已录入耗用，请先纠正冲突记录',
      { recorded_count: recorded?.c ?? 0, recorded_minor: recorded?.m ?? 0 },
    )
  }

  // Unassigned legacy history keeps the cycle unverified even after the entry.
  const account = await db
    .prepare('SELECT definition_id FROM opportunity_accounts WHERE id = ?')
    .bind(cycle.account_id)
    .first<{ definition_id: string }>()
  const versions = account ? await listRuleVersions(account.definition_id) : []
  const newest = newestRuleVersion(versions)
  const unassigned = newest
    ? await countUnassignedLegacyUsages(parseRules(newest.rules_json).card_product_ids, input.as_of_on)
    : 0
  const balanceVerified: 0 | 1 = unassigned > 0 ? 0 : 1

  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const scopePredicate =
    actor.role === 'admin' ? '(h.created_by = ? OR h.managed_by = ?)' : 'h.auth_user_id = ?'

  const result: ConfirmOpeningResult = {
    cycle_id: cycle.id,
    revision: input.expected_revision + 1,
    balance_verified: balanceVerified,
    extra_opening_count: extraCount,
    extra_opening_minor: extraMinor,
  }
  const outcome = await runOpportunityCommand<ConfirmOpeningResult>(actor, {
    command_type: 'confirmOpeningBalance',
    request_key: input.request_key,
    payload_fields: ['cycle_id', 'opening_used_count', 'opening_used_minor', 'as_of_on'],
    payload: {
      cycle_id: input.cycle_id,
      opening_used_count: input.opening_used_count,
      opening_used_minor: input.opening_used_minor,
      as_of_on: input.as_of_on,
    },
    assertions: [
      {
        name: 'cycle-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_cycles c
          JOIN opportunity_accounts a ON a.id = c.account_id
          JOIN card_holders h ON h.id = a.holder_id
          WHERE c.id = ? AND c.revision = ? AND ${scopePredicate})`,
        binds: [input.cycle_id, input.expected_revision, ...scopeBinds],
        violation: () =>
          new OpportunityError('REVISION_CONFLICT', '数据已被其他操作修改，请刷新后重试', {
            cycle_id: input.cycle_id,
          }),
      },
    ],
    events: [
      {
        entity_kind: 'cycle',
        entity_id: cycle.id,
        event_type: 'cycle.opening_verified',
        account_id: cycle.account_id,
        cycle_id: cycle.id,
        deltas: {
          delta_opening_count: extraCount,
          delta_opening_minor: extraMinor,
          delta_used_count: 0, delta_used_minor: 0,
          delta_reserved_count: 0, delta_reserved_minor: 0,
        },
        after_json: {
          opening_used_count: input.opening_used_count,
          opening_used_minor: input.opening_used_minor,
          as_of_on: input.as_of_on,
          balance_verified: balanceVerified,
        },
        reason: input.reason ?? null,
      },
    ],
    statements: [
      // opening_used_* are projected by the event trigger above; this UPDATE
      // only stamps the verification metadata. The revision predicate lives
      // in the batch assertion (the trigger already bumped the column).
      db
        .prepare(
          `UPDATE opportunity_cycles
           SET balance_verified = ?, verified_by = ?, verified_at = ?, opening_as_of_on = ?
           WHERE id = ?`,
        )
        .bind(balanceVerified, actor.user_id, now, input.as_of_on, input.cycle_id),
    ],
    result,
  }, { now })

  // Replay returns the committed result.
  return outcome.result
}

// ---------------------------------------------------------------------------
// assignLegacyUsage — opening→used reclassification (tech spec §7.2)
// ---------------------------------------------------------------------------

export interface AssignLegacyInput {
  source_table: 'benefit_usages' | 'promo_usages'
  source_id: string
  account_id: string
  cycle_id: string
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  /** true when this row's usage was already counted in the verified opening. */
  included_in_opening: boolean
  reason: string
  request_key: string
}

export interface AssignLegacyResult {
  usage_id: string
  included_in_opening: boolean
  opening_after: { count: number; minor: number }
  used_after: { count: number; minor: number }
}

export async function assignLegacyUsage(
  actor: OpportunityActor,
  input: AssignLegacyInput,
  opts: { now?: string } = {},
): Promise<AssignLegacyResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  await assertAccountAccess(input.account_id, actor)

  if (!isValidCivilDate(input.used_on)) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 used_on 不合法', { field: 'used_on' })
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'quantity 必须是正整数')
  }
  if (!Number.isInteger(input.amount_minor) || input.amount_minor < 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'amount_minor 必须是非负整数')
  }
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', '归属必须填写原因')
  }

  const cycle = await db
    .prepare(
      'SELECT id, account_id, revision, opening_used_count, opening_used_minor, used_count, used_minor, count_limit, amount_limit_minor FROM opportunity_cycles WHERE id = ?',
    )
    .bind(input.cycle_id)
    .first<{
      id: string; account_id: string; revision: number
      opening_used_count: number; opening_used_minor: number
      used_count: number; used_minor: number
      count_limit: number | null; amount_limit_minor: number | null
    }>()
  if (!cycle || cycle.account_id !== input.account_id) {
    throw forbiddenOrNotFound('cycle')
  }

  const usageId = `ousg_${crypto.randomUUID()}`

  // included → reclassify: opening−q/a AND used+q/a in ONE event, totals unchanged.
  // not included → plain used+q/a with a quota headroom assertion.
  const deltas = input.included_in_opening
    ? {
        delta_opening_count: -input.quantity,
        delta_opening_minor: -input.amount_minor,
        delta_used_count: input.quantity,
        delta_used_minor: input.amount_minor,
        delta_reserved_count: 0,
        delta_reserved_minor: 0,
      }
    : {
        delta_opening_count: 0, delta_opening_minor: 0,
        delta_used_count: input.quantity,
        delta_used_minor: input.amount_minor,
        delta_reserved_count: 0, delta_reserved_minor: 0,
      }

  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const scopePredicate =
    actor.role === 'admin' ? '(h.created_by = ? OR h.managed_by = ?)' : 'h.auth_user_id = ?'

  const assertions = [
    {
      name: 'scope-and-card-link-and-source-free',
      sql: `EXISTS (
          SELECT 1 FROM opportunity_accounts a
          JOIN card_holders h ON h.id = a.holder_id
          JOIN opportunity_account_cards ac ON ac.account_id = a.id AND ac.card_id = ? AND ac.retired_at IS NULL
          WHERE a.id = ? AND ${scopePredicate})
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_legacy_links l
          WHERE l.source_table = ? AND l.source_id = ?)`,
      binds: [
        input.card_id, input.account_id, ...scopeBinds,
        input.source_table, input.source_id,
      ],
      violation: () =>
        new OpportunityError(
          'VALIDATION_FAILED',
          '该旧记录已归属，或卡与账户不匹配',
          { source_table: input.source_table, source_id: input.source_id },
        ),
    },
    ...(input.included_in_opening
      ? [
          {
            name: 'opening-covers-reclassification',
            sql: `EXISTS (
              SELECT 1 FROM opportunity_cycles c
              WHERE c.id = ? AND c.opening_used_count >= ? AND c.opening_used_minor >= ?)`,
            binds: [input.cycle_id, input.quantity, input.amount_minor],
            violation: () =>
              new OpportunityError(
                'VALIDATION_FAILED',
                '期初余额不足以覆盖该记录，请先核对期初',
                { cycle_id: input.cycle_id },
              ),
          },
        ]
      : [
          {
            name: 'quota-headroom',
            sql: `EXISTS (
              SELECT 1 FROM opportunity_cycles c
              WHERE c.id = ? AND (c.count_limit IS NULL
                OR c.opening_used_count + c.used_count + c.reserved_count + ? <= c.count_limit)
                AND (c.amount_limit_minor IS NULL
                OR c.opening_used_minor + c.used_minor + c.reserved_minor + ? <= c.amount_limit_minor))`,
            binds: [input.cycle_id, input.quantity, input.amount_minor],
            violation: () =>
              new OpportunityError('QUOTA_EXCEEDED', '本期额度不足，无法完成该操作', {
                cycle_id: input.cycle_id,
              }),
          },
        ]),
  ]

  const result: AssignLegacyResult = {
    usage_id: usageId,
    included_in_opening: input.included_in_opening,
    opening_after: {
      count: cycle.opening_used_count + (input.included_in_opening ? -input.quantity : 0),
      minor: cycle.opening_used_minor + (input.included_in_opening ? -input.amount_minor : 0),
    },
    used_after: {
      count: cycle.used_count + input.quantity,
      minor: cycle.used_minor + input.amount_minor,
    },
  }

  const outcome = await runOpportunityCommand<AssignLegacyResult>(actor, {
    command_type: 'assignLegacyUsage',
    request_key: input.request_key,
    payload_fields: ['source_table', 'source_id', 'account_id', 'cycle_id', 'card_id', 'used_on', 'quantity', 'amount_minor', 'included_in_opening'],
    payload: {
      source_table: input.source_table, source_id: input.source_id,
      account_id: input.account_id, cycle_id: input.cycle_id, card_id: input.card_id,
      used_on: input.used_on, quantity: input.quantity, amount_minor: input.amount_minor,
      included_in_opening: input.included_in_opening,
    },
    assertions,
    events: [
      {
        entity_kind: 'legacy',
        entity_id: `${input.source_table}:${input.source_id}`,
        event_type: input.included_in_opening ? 'legacy.reclassified_from_opening' : 'legacy.assigned',
        account_id: input.account_id,
        cycle_id: input.cycle_id,
        deltas,
        after_json: {
          usage_id: usageId,
          included_in_opening: input.included_in_opening,
          quantity: input.quantity,
          amount_minor: input.amount_minor,
        },
        reason: input.reason,
      },
    ],
    statements: [
      db
        .prepare(
          `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, note, created_by, updated_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          usageId, input.account_id, input.cycle_id, input.card_id, input.used_on,
          input.quantity, input.amount_minor, input.reason, actor.user_id, actor.user_id, now, now,
        ),
      db
        .prepare(
          `INSERT INTO opportunity_legacy_links (source_table, source_id, target_usage_id, included_in_opening, offset_opening_count, offset_opening_minor, assigned_by, reason, assigned_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          input.source_table, input.source_id, usageId,
          input.included_in_opening ? 1 : 0,
          input.included_in_opening ? input.quantity : 0,
          input.included_in_opening ? input.amount_minor : 0,
          actor.user_id, input.reason, now,
        ),
    ],
    result,
  }, { now })

  // Replay returns the committed result.
  return outcome.result
}

// ---------------------------------------------------------------------------
// updateOpportunityCycleWorkflow (per-cycle absolute windows)
// ---------------------------------------------------------------------------

export interface AbsoluteWindow {
  starts_at: string | null
  ends_at: string | null
}

export interface UpdateWorkflowInput {
  cycle_id: string
  claim_window: AbsoluteWindow | null
  booking_window: { opens_at: string | null; closes_at: string | null } | null
  reason: string | null
  expected_revision: number
  request_key: string
}

export async function updateOpportunityCycleWorkflow(
  actor: OpportunityActor,
  input: UpdateWorkflowInput,
  opts: { now?: string } = {},
): Promise<{ cycle_id: string; revision: number }> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()
  const cycle = await db
    .prepare('SELECT id, account_id, version_id, workflow_json FROM opportunity_cycles WHERE id = ?')
    .bind(input.cycle_id)
    .first<{ id: string; account_id: string; version_id: string; workflow_json: string }>()
  if (!cycle) throw forbiddenOrNotFound('cycle')
  await assertAccountAccess(cycle.account_id, actor)

  // Only per_cycle rules accept batch-specific absolute windows; fixed rules
  // keep the rule snapshot's windows (never copied onto each month).
  const version = await db
    .prepare('SELECT rules_json FROM opportunity_rule_versions WHERE id = ?')
    .bind(cycle.version_id)
    .first<{ rules_json: string }>()
  const rules = version ? parseRules(version.rules_json) : null
  if (!rules || rules.workflow_time_basis !== 'per_cycle') {
    throw new OpportunityError('VALIDATION_FAILED', '该规则使用固定时间窗口，不能按批次录入')
  }

  const validateWindow = (
    w: AbsoluteWindow | { opens_at: string | null; closes_at: string | null } | null,
    label: string,
    startKey: string,
    endKey: string,
  ) => {
    if (!w) return
    for (const [key, value] of Object.entries(w as Record<string, string | null>)) {
      if (value != null && !isValidRfc3339Utc(value)) {
        throw new OpportunityError('VALIDATION_FAILED', `参数 ${label}.${key} 必须是 RFC3339 UTC 时间`, {
          field: `${label}.${key}`,
        })
      }
    }
    const record = w as Record<string, string | null>
    const start = record[startKey]
    const end = record[endKey]
    if (start && end && start >= end) {
      throw new OpportunityError('VALIDATION_FAILED', `${label}.${startKey} 必须早于 ${label}.${endKey}`)
    }
  }
  validateWindow(input.claim_window, 'claim_window', 'starts_at', 'ends_at')
  validateWindow(input.booking_window, 'booking_window', 'opens_at', 'closes_at')

  const workflow: Record<string, unknown> = JSON.parse(cycle.workflow_json || '{}')
  if (input.claim_window) workflow.claim_window = input.claim_window
  if (input.booking_window) workflow.booking_window = input.booking_window

  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const scopePredicate =
    actor.role === 'admin' ? '(h.created_by = ? OR h.managed_by = ?)' : 'h.auth_user_id = ?'

  const result = { cycle_id: cycle.id, revision: input.expected_revision + 1 }
  const outcome = await runOpportunityCommand<{ cycle_id: string; revision: number }>(actor, {
    command_type: 'updateOpportunityCycleWorkflow',
    request_key: input.request_key,
    payload_fields: ['cycle_id', 'claim_window', 'booking_window'],
    payload: {
      cycle_id: input.cycle_id,
      claim_window: input.claim_window,
      booking_window: input.booking_window,
    },
    assertions: [
      {
        name: 'cycle-revision-and-scope',
        sql: `EXISTS (
          SELECT 1 FROM opportunity_cycles c
          JOIN opportunity_accounts a ON a.id = c.account_id
          JOIN card_holders h ON h.id = a.holder_id
          WHERE c.id = ? AND c.revision = ? AND ${scopePredicate})`,
        binds: [input.cycle_id, input.expected_revision, ...scopeBinds],
        violation: () =>
          new OpportunityError('REVISION_CONFLICT', '数据已被其他操作修改，请刷新后重试', {
            cycle_id: input.cycle_id,
          }),
      },
    ],
    events: [
      {
        entity_kind: 'cycle',
        entity_id: cycle.id,
        event_type: 'cycle.workflow_updated',
        account_id: cycle.account_id,
        cycle_id: cycle.id,
        deltas: {
          delta_opening_count: 0, delta_opening_minor: 0,
          delta_used_count: 0, delta_used_minor: 0,
          delta_reserved_count: 0, delta_reserved_minor: 0,
        },
        before_json: JSON.parse(cycle.workflow_json || '{}'),
        after_json: workflow,
        reason: input.reason ?? null,
      },
    ],
    statements: [
      // revision is bumped by the event trigger; only workflow_json is data.
      db
        .prepare('UPDATE opportunity_cycles SET workflow_json = ? WHERE id = ?')
        .bind(JSON.stringify(workflow), input.cycle_id),
    ],
    result,
  }, { now })

  // Replay returns the committed result.
  return outcome.result
}
