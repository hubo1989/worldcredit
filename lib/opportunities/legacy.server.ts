// lib/opportunities/legacy.server.ts — legacy attribution and source backfill
// (plan Task 10, tech spec §6.3/§11). Rules enforced here:
//   - legacy benefit_usages are GLOBAL rows with no provable holder: they are
//     never auto-claimed; even admins list them WITHOUT notes, and assignment
//     requires external evidence entered as an explicit reason
//   - one legacy source row maps exactly once (opportunity_legacy_links PK)
//   - included_in_opening reclassifies opening→used in the SAME batch, so a
//     cycle verified at 3 total stays at 3 after one of the three is attributed
//   - old delete buttons archive the wrapped definition instead of cascading

import { getDb } from '../db/client'
import type { OpportunityActor } from './types'
import { OpportunityError, forbiddenOrNotFound } from './errors'
import { holderScopePredicate } from './scope.server'
import { runOpportunityCommand, replayCommittedResult, type WriteAssertion } from './writes.server'
import { isValidCivilDate } from './dates'

// ---------------------------------------------------------------------------
// Unassigned legacy usages (admin read, no note leakage)
// ---------------------------------------------------------------------------

export interface UnassignedLegacyUsage {
  source_table: 'benefit_usages' | 'promo_usages'
  source_id: string
  used_at: string
  /** benefit/promo display title (catalog data, not user content). */
  title: string
  /** Present only when the row's card proves a holder inside the caller's scope. */
  note: string | null
  card_id: string | null
  holder_id: string | null
}

export interface UnassignedLegacyPage {
  items: UnassignedLegacyUsage[]
  next_cursor: string | null
}

const UNASSIGNED_LIMIT_DEFAULT = 30
const UNASSIGNED_LIMIT_MAX = 100

/**
 * Admin-only list of legacy usage rows with no opportunity_legacy_links entry.
 * benefit_usages carry no holder evidence at all, so their notes are stripped
 * for every admin; promo_usages notes appear only when the recorded card's
 * holder is inside the caller's scope. Members get a uniform denial.
 */
export async function getUnassignedLegacyUsages(
  actor: OpportunityActor,
  input: { holder_id?: string | null; cursor?: string | null; limit?: number | null } = {},
): Promise<UnassignedLegacyPage> {
  if (actor.role !== 'admin') throw forbiddenOrNotFound('legacy_usage')
  const limit = Math.min(
    Math.max(Number.isInteger(input.limit) ? (input.limit as number) : UNASSIGNED_LIMIT_DEFAULT, 1),
    UNASSIGNED_LIMIT_MAX,
  )
  const afterId = typeof input.cursor === 'string' && input.cursor.length > 0 ? input.cursor : null
  const scope = holderScopePredicate(actor)

  // benefit_usages: global rows; note never returned.
  const benefitRows = (
    await getDb()
      .prepare(
        `SELECT bu.id, bu.used_at, b.name AS title
         FROM benefit_usages bu
         JOIN benefits b ON b.id = bu.benefit_id
         WHERE NOT EXISTS (
           SELECT 1 FROM opportunity_legacy_links l
           WHERE l.source_table = 'benefit_usages' AND l.source_id = bu.id)
           AND (? IS NULL OR bu.id > ?)
         ORDER BY bu.id ASC LIMIT ?`,
      )
      .bind(afterId, afterId, limit)
      .all<{ id: string; used_at: string; title: string }>()
  ).results.map<UnassignedLegacyUsage>((r) => ({
    source_table: 'benefit_usages',
    source_id: r.id,
    used_at: r.used_at,
    title: r.title,
    note: null,
    card_id: null,
    holder_id: null,
  }))

  // promo_usages: only rows whose card still exists prove a holder; rows
  // outside the caller's scope are filtered out entirely (existence must not
  // leak), in-scope rows may include the note.
  const promoFilter = input.holder_id ? 'AND cc.holder_id = ?' : ''
  const promoRows = (
    await getDb()
      .prepare(
        `SELECT pu.id, pu.used_at, pu.note, p.title, pu.card_id, cc.holder_id
         FROM promo_usages pu
         JOIN promos p ON p.id = pu.promo_id
         JOIN credit_cards cc ON cc.id = pu.card_id
         JOIN card_holders h ON h.id = cc.holder_id
         WHERE NOT EXISTS (
           SELECT 1 FROM opportunity_legacy_links l
           WHERE l.source_table = 'promo_usages' AND l.source_id = pu.id)
           AND pu.id > ?
           AND ${scope.sql}
           ${promoFilter}
         ORDER BY pu.id ASC LIMIT ?`,
      )
      // Bind order follows SQL text: pagination, scope, holder filter, limit.
      .bind(afterId ?? '', ...scope.binds, ...(input.holder_id ? [input.holder_id] : []), limit)
      .all<{ id: string; used_at: string; note: string | null; title: string; card_id: string; holder_id: string }>()
  ).results.map<UnassignedLegacyUsage>((r) => ({
    source_table: 'promo_usages',
    source_id: r.id,
    used_at: r.used_at,
    title: r.title,
    note: r.note,
    card_id: r.card_id,
    holder_id: r.holder_id,
  }))

  const merged = [...benefitRows, ...promoRows].sort((a, b) =>
    a.source_table === b.source_table
      ? a.source_id.localeCompare(b.source_id)
      : a.source_table.localeCompare(b.source_table),
  )
  const page = merged.slice(0, limit)
  return {
    items: page,
    next_cursor: merged.length > limit ? page[page.length - 1].source_id : null,
  }
}

// ---------------------------------------------------------------------------
// assignLegacyUsage — one source row → one account/cycle/card, once
// ---------------------------------------------------------------------------

export interface AssignLegacyUsageInput {
  source_table: 'benefit_usages' | 'promo_usages'
  source_id: string
  account_id: string
  card_id: string
  /** Defaults to the cycle covering the source used_at date. */
  cycle_id?: string | null
  /** True: the row is part of the verified opening total → opening−q / used+q. */
  included_in_opening: boolean
  reason: string
  request_key: string
}

export interface AssignLegacyUsageResult {
  usage_id: string
  cycle_id: string
  reclassified: boolean
}

const ASSIGN_PAYLOAD_FIELDS = [
  'source_table', 'source_id', 'account_id', 'card_id', 'cycle_id',
  'included_in_opening', 'reason',
] as const

interface LegacySourceRow {
  used_at: string
  id: string
}

async function loadLegacySource(
  sourceTable: 'benefit_usages' | 'promo_usages',
  sourceId: string,
): Promise<LegacySourceRow | null> {
  const column = sourceTable === 'benefit_usages' ? 'benefit_id' : 'promo_id'
  return (
    await getDb()
      .prepare(`SELECT id, used_at FROM ${sourceTable} WHERE id = ? AND ${column} IS NOT NULL`)
      .bind(sourceId)
      .first<LegacySourceRow>()
  )
}

/**
 * Maps ONE legacy usage row into the ledger with external evidence. The
 * command, the (re)classification event, the usage row and the legacy link all
 * commit in one batch; a mapped source can never be mapped again, and a
 * same-key retry replays the committed result.
 */
export async function assignLegacyUsage(
  actor: OpportunityActor,
  input: AssignLegacyUsageInput,
  opts: { now?: string } = {},
): Promise<AssignLegacyUsageResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (input.source_table !== 'benefit_usages' && input.source_table !== 'promo_usages') {
    throw new OpportunityError('VALIDATION_FAILED', 'source_table 不合法', {
      field: 'source_table',
    })
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 500) {
    throw new OpportunityError('VALIDATION_FAILED', '归属必须填写依据（1–500 字）', {
      field: 'reason',
    })
  }

  const payload = {
    source_table: input.source_table,
    source_id: input.source_id,
    account_id: input.account_id,
    card_id: input.card_id,
    cycle_id: input.cycle_id ?? null,
    included_in_opening: input.included_in_opening === true,
    reason: input.reason.trim(),
  }
  const replayed = await replayCommittedResult<AssignLegacyUsageResult>(
    actor, input.request_key, ASSIGN_PAYLOAD_FIELDS, payload)
  if (replayed) return replayed

  // Scope first — a foreign account must look identical to a missing one.
  const scope = holderScopePredicate(actor)
  const account = await db
    .prepare(
      `SELECT a.id, a.holder_id, a.definition_id, a.status
       FROM opportunity_accounts a JOIN card_holders h ON h.id = a.holder_id
       WHERE a.id = ? AND ${scope.sql}`,
    )
    .bind(input.account_id, ...scope.binds)
    .first<{ id: string; holder_id: string; definition_id: string; status: string }>()
  if (!account || account.status !== 'active') throw forbiddenOrNotFound('account')

  const source = await loadLegacySource(input.source_table, input.source_id)
  if (!source) throw new OpportunityError('VALIDATION_FAILED', '来源记录不存在', {
    source_table: input.source_table,
    source_id: input.source_id,
  })
  if (!isValidCivilDate(source.used_at)) {
    throw new OpportunityError('VALIDATION_FAILED', '来源记录日期不合法，请人工核对后处理', {
      used_at: source.used_at,
    })
  }

  const alreadyMapped = await db
    .prepare('SELECT 1 AS ok FROM opportunity_legacy_links WHERE source_table = ? AND source_id = ?')
    .bind(input.source_table, input.source_id)
    .first<{ ok: number }>()
  if (alreadyMapped) {
    throw new OpportunityError('INVALID_TRANSITION', '该来源记录已归属，不能重复归属', {
      source_table: input.source_table,
      source_id: input.source_id,
    })
  }

  // Target cycle: explicit, or the one covering the source date.
  let cycleId = input.cycle_id ?? null
  if (!cycleId) {
    const row = await db
      .prepare(
        `SELECT id FROM opportunity_cycles
         WHERE account_id = ? AND ? >= usable_start_on
           AND (usable_end_before IS NULL OR ? < usable_end_before)
         ORDER BY usable_start_on DESC LIMIT 1`,
      )
      .bind(input.account_id, source.used_at, source.used_at)
      .first<{ id: string }>()
    if (!row) {
      throw new OpportunityError('NEEDS_CONFIRMATION', '来源日期不在任何可用周期内，请先补建周期或指定目标周期', {
        used_at: source.used_at,
      })
    }
    cycleId = row.id
  }

  const cycle = await db
    .prepare(
      `SELECT id, account_id, activation_state, balance_verified, opening_used_count, used_count, revision
       FROM opportunity_cycles WHERE id = ?`,
    )
    .bind(cycleId)
    .first<{
      id: string; account_id: string; activation_state: string; balance_verified: number
      opening_used_count: number; used_count: number; revision: number
    }>()
  if (!cycle || cycle.account_id !== input.account_id) throw forbiddenOrNotFound('cycle')
  if (cycle.activation_state !== 'active') {
    throw new OpportunityError('INVALID_TRANSITION', '目标周期不可写入', { cycle_id: cycle.id })
  }

  const linked = await db
    .prepare(
      'SELECT 1 AS ok FROM opportunity_account_cards WHERE account_id = ? AND card_id = ? AND retired_at IS NULL',
    )
    .bind(input.account_id, input.card_id)
    .first<{ ok: number }>()
  if (!linked) {
    throw new OpportunityError('VALIDATION_FAILED', '卡未绑定到该账户或已解绑', { card_id: input.card_id })
  }

  if (payload.included_in_opening) {
    if (cycle.balance_verified !== 1) {
      throw new OpportunityError('NEEDS_CONFIRMATION', '该周期尚未完成期初核对，请先核对再归属（或选择不包含在期初内）', {
        cycle_id: cycle.id,
      })
    }
    if (cycle.opening_used_count < 1) {
      throw new OpportunityError('QUOTA_EXCEEDED', '期初核对余量不足，无法转分类；请重新核对期初总额', {
        opening_used_count: cycle.opening_used_count,
      })
    }
  }

  const usageId = `ousg_${crypto.randomUUID()}`
  const result: AssignLegacyUsageResult = {
    usage_id: usageId,
    cycle_id: cycle.id,
    reclassified: payload.included_in_opening,
  }

  const assertions: WriteAssertion[] = [
    {
      name: 'legacy-scope-active',
      sql: `EXISTS (
        SELECT 1 FROM opportunity_accounts a JOIN card_holders h ON h.id = a.holder_id
        WHERE a.id = ? AND a.status = 'active' AND ${scope.sql})`,
      binds: [input.account_id, ...scope.binds],
      violation: () => forbiddenOrNotFound('account'),
    },
    {
      name: 'legacy-source-unmapped',
      sql: `EXISTS (SELECT 1 FROM ${input.source_table} s WHERE s.id = ?)
        AND NOT EXISTS (SELECT 1 FROM opportunity_legacy_links l
          WHERE l.source_table = ? AND l.source_id = ?)`,
      binds: [input.source_id, input.source_table, input.source_id],
      violation: () =>
        new OpportunityError('INVALID_TRANSITION', '该来源记录不存在或已归属', {
          source_table: input.source_table,
          source_id: input.source_id,
        }),
    },
    {
      name: 'legacy-cycle-card',
      sql: `EXISTS (SELECT 1 FROM opportunity_cycles c
          WHERE c.id = ? AND c.account_id = ? AND c.activation_state = 'active')
        AND EXISTS (SELECT 1 FROM opportunity_account_cards ac
          WHERE ac.account_id = ? AND ac.card_id = ? AND ac.retired_at IS NULL)`,
      binds: [cycle.id, input.account_id, input.account_id, input.card_id],
      violation: () =>
        new OpportunityError('INVALID_TRANSITION', '目标周期或卡绑定状态已变化，请刷新后重试', {
          cycle_id: cycle.id,
        }),
    },
    {
      name: 'legacy-opening-reclassify',
      sql: payload.included_in_opening
        ? `EXISTS (SELECT 1 FROM opportunity_cycles c
             WHERE c.id = ? AND c.balance_verified = 1 AND c.opening_used_count >= 1)`
        : `EXISTS (SELECT 1 FROM opportunity_cycles c WHERE c.id = ?)`,
      binds: [cycle.id],
      violation: () =>
        new OpportunityError('QUOTA_EXCEEDED', '期初核对余量不足或未核对，无法转分类', {
          cycle_id: cycle.id,
        }),
    },
  ]

  return (
    await runOpportunityCommand<AssignLegacyUsageResult>(
      actor,
      {
        command_type: 'assignLegacyUsage',
        request_key: input.request_key,
        payload_fields: ASSIGN_PAYLOAD_FIELDS,
        payload,
        assertions,
        events: [
          {
            entity_kind: 'legacy',
            entity_id: `${input.source_table}:${input.source_id}`,
            event_type: payload.included_in_opening
              ? 'legacy.assigned_reclassified'
              : 'legacy.assigned',
            account_id: input.account_id,
            cycle_id: cycle.id,
            deltas: payload.included_in_opening
              ? {
                  delta_opening_count: -1,
                  delta_opening_minor: 0,
                  delta_used_count: 1,
                  delta_used_minor: 0,
                  delta_reserved_count: 0,
                  delta_reserved_minor: 0,
                }
              : {
                  delta_opening_count: 0,
                  delta_opening_minor: 0,
                  delta_used_count: 1,
                  delta_used_minor: 0,
                  delta_reserved_count: 0,
                  delta_reserved_minor: 0,
                },
            before_json: {
              source_table: input.source_table,
              source_id: input.source_id,
              used_at: source.used_at,
              opening_used_count: cycle.opening_used_count,
              used_count: cycle.used_count,
            },
            after_json: { usage_id: usageId, card_id: input.card_id },
            reason: payload.reason,
          },
        ],
        statements: [
          db
            .prepare(
              `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, note, created_by, updated_by, created_at, updated_at)
               VALUES (?,?,?,?,?,1,0,?,?,?,?,?)`,
            )
            .bind(
              usageId, input.account_id, cycle.id, input.card_id, source.used_at,
              `legacy:${input.source_table}:${input.source_id}`, actor.user_id, actor.user_id, now, now,
            ),
          db
            .prepare(
              `INSERT INTO opportunity_legacy_links (source_table, source_id, target_usage_id, included_in_opening, offset_opening_count, offset_opening_minor, assigned_by, reason, assigned_at)
               VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              input.source_table, input.source_id, usageId,
              payload.included_in_opening ? 1 : 0,
              payload.included_in_opening ? 1 : 0,
              0,
              actor.user_id, payload.reason, now,
            ),
        ],
        result,
      },
      { now },
    )
  ).result
}

// ---------------------------------------------------------------------------
// deleteBenefit / deletePromo → archive adapters
// ---------------------------------------------------------------------------

/**
 * Archives the definition wrapping a legacy benefit/promo id. The legacy row
 * itself is NEVER deleted: benefit_usages cascade on delete, and the wrapped
 * catalog is the provenance of every migrated definition. Idempotent.
 */
export async function archiveLegacyDefinition(
  legacyId: string,
  kind: 'benefit' | 'promo',
): Promise<void> {
  const column = kind === 'benefit' ? 'legacy_benefit_id' : 'legacy_promo_id'
  const { results } = await getDb()
    .prepare(
      `UPDATE opportunity_definitions SET status = 'archived', revision = revision + 1
       WHERE ${column} = ? AND status = 'active' RETURNING id`,
    )
    .bind(legacyId)
    .all<{ id: string }>()
  // No wrapped definition (catalog not yet migrated): nothing to archive —
  // callers keep the legacy row untouched either way.
  void results
}
