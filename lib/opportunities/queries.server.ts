// lib/opportunities/queries.server.ts — the unified read side (plan Task 11,
// spec §12): ONE batched query shape feeds the opportunity list, the benefit
// ledger, card details and the dashboard count. Availability is computed by
// the pure state machine in availability.ts — pages never re-derive it.

import { getDb } from '../db/client'
import type { OpportunityActor, RuleSnapshotV1 } from './types'
import { OpportunityError, forbiddenOrNotFound } from './errors'
import { holderScopePredicate, resolveOpportunityScope } from './scope.server'
import {
  computeAvailability,
  isoWeekdayOf,
  AVAILABILITY_SORT_RANK,
  type AvailabilityAction,
  type OpportunityAvailabilityStatus,
} from './availability'
import { parseRules } from './catalog.server'
import { localDateInZone } from './dates'

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface OpportunityDto {
  account_id: string
  definition_id: string
  kind: 'benefit' | 'promo' | 'private_reward'
  title: string
  category: string
  bank_id: string | null
  card_ids: string[]
  holder_id: string
  holder_name: string
  scope_kind: 'card' | 'holder'
  revision: number
  // availability (computed for the account's own rule timezone “today”)
  status: OpportunityAvailabilityStatus
  action: AvailabilityAction
  reason: string
  usable_today: boolean
  needs_review: boolean
  days_left: number | null
  deadline_on: string | null
  // current cycle snapshot (null when none covers today)
  cycle_id: string | null
  cycle_key: string | null
  period_start_on: string | null
  period_end_before: string | null
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  used_count: number | null
  reserved_count: number | null
  opening_used_count: number | null
  remaining_count: number | null
  remaining_minor: number | null
  unit_label: string
  entry: { website_url: string | null; app_name: string | null; app_path: string | null }
  followed: boolean
  today_on: string
}

export interface OpportunityPageFilters {
  holder_id?: string | null
  card_id?: string | null
  bank_id?: string | null
  category?: string | null
  kind?: string | null
  status?: string | null
  q?: string | null
  cursor?: string | null
  limit?: number | null
}

export interface OpportunityPage {
  items: OpportunityDto[]
  next_cursor: string | null
  counts: Record<string, number>
}

// ---------------------------------------------------------------------------
// Filter validation
// ---------------------------------------------------------------------------

const STATUSES: readonly OpportunityAvailabilityStatus[] = [
  'available_today', 'expiring_soon', 'claimable', 'exhausted',
  'needs_confirmation', 'not_started', 'expired',
]
const KINDS = ['benefit', 'promo', 'private_reward'] as const
const PAGE_LIMIT_DEFAULT = 30
const PAGE_LIMIT_MAX = 100
const Q_MAX = 64

function validateFilters(filters: OpportunityPageFilters): Required<Omit<OpportunityPageFilters, 'holder_id' | 'card_id' | 'bank_id' | 'category'>> & {
  holder_id: string | null; card_id: string | null; bank_id: string | null; category: string | null
} {
  const status = filters.status ?? null
  if (status !== null && !STATUSES.includes(status as OpportunityAvailabilityStatus)) {
    throw new OpportunityError('VALIDATION_FAILED', 'status 筛选值不合法', { field: 'status' })
  }
  const kind = filters.kind ?? null
  if (kind !== null && !(KINDS as readonly string[]).includes(kind)) {
    throw new OpportunityError('VALIDATION_FAILED', 'kind 筛选值不合法', { field: 'kind' })
  }
  const q = filters.q ?? null
  if (q !== null && (q.length > Q_MAX)) {
    throw new OpportunityError('VALIDATION_FAILED', `关键词最长 ${Q_MAX} 字`, { field: 'q' })
  }
  const limit = filters.limit ?? null
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX)) {
    throw new OpportunityError('VALIDATION_FAILED', `limit 必须是 1–${PAGE_LIMIT_MAX}`, { field: 'limit' })
  }
  return {
    holder_id: filters.holder_id ?? null,
    card_id: filters.card_id ?? null,
    bank_id: filters.bank_id ?? null,
    category: filters.category ?? null,
    kind,
    status,
    q,
    cursor: filters.cursor ?? null,
    limit: limit ?? PAGE_LIMIT_DEFAULT,
  }
}

// ---------------------------------------------------------------------------
// Batched world load — fixed query count, no per-row fetches (spec §12)
// ---------------------------------------------------------------------------

interface AccountWorldRow {
  id: string
  definition_id: string
  holder_id: string
  scope_kind: 'card' | 'holder'
  eligibility: 'unknown' | 'confirmed' | 'ineligible'
  eligible_from_on: string | null
  account_status: 'active' | 'archived'
  revision: number
  holder_name: string
  kind: 'benefit' | 'promo' | 'private_reward'
  definition_status: 'active' | 'archived'
  terminated_at: string | null
  rules_json: string | null
}

interface CycleWorldRow {
  id: string
  account_id: string
  cycle_key: string
  allocation_kind: 'regular' | 'grant'
  activation_state: 'active' | 'pending_claim' | 'voided'
  period_start_on: string
  period_end_before: string | null
  usable_start_on: string
  usable_end_before: string | null
  time_zone: string
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  opening_used_count: number
  used_count: number
  reserved_count: number
  opening_used_minor: number
  used_minor: number
  reserved_minor: number
  balance_verified: number
}

async function loadWorld(
  actor: OpportunityActor,
  f: ReturnType<typeof validateFilters>,
  nowIso: string,
): Promise<{ rows: AccountWorldRow[]; cardsByAccount: Map<string, string[]>; cyclesByAccount: Map<string, CycleWorldRow>; followed: Set<string> }> {
  const db = getDb()
  const scope = holderScopePredicate(actor)

  // 1. accounts + definition + newest rule version in one join.
  const conditions = [scope.sql]
  const binds: unknown[] = [...scope.binds]
  if (f.holder_id !== null) {
    conditions.push('a.holder_id = ?')
    binds.push(f.holder_id)
  }
  if (f.kind !== null) {
    conditions.push('d.kind = ?')
    binds.push(f.kind)
  }
  if (f.bank_id !== null) {
    conditions.push("json_extract(v.rules_json, '$.bank_id') = ?")
    binds.push(f.bank_id)
  }
  if (f.category !== null) {
    conditions.push("json_extract(v.rules_json, '$.category') = ?")
    binds.push(f.category)
  }
  if (f.q !== null && f.q.length > 0) {
    conditions.push("json_extract(v.rules_json, '$.title') LIKE ? COLLATE NOCASE")
    binds.push(`%${f.q}%`)
  }
  // `v` is each definition's NEWEST published version (joined on max version);
  // filters read json fields from it.
  const { results: rows } = await db
    .prepare(
      `SELECT a.id, a.definition_id, a.holder_id, a.scope_kind, a.eligibility,
              a.eligible_from_on, a.status AS account_status, a.revision,
              h.name AS holder_name,
              d.kind, d.status AS definition_status, d.terminated_at,
              v.rules_json
       FROM opportunity_accounts a
       JOIN card_holders h ON h.id = a.holder_id
       JOIN opportunity_definitions d ON d.id = a.definition_id
       LEFT JOIN opportunity_rule_versions v
         ON v.definition_id = d.id
        AND v.version = (SELECT MAX(v3.version) FROM opportunity_rule_versions v3
                          WHERE v3.definition_id = d.id)
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.id`,
    )
    .bind(...binds)
    .all<AccountWorldRow>()

  if (rows.length === 0) {
    return { rows, cardsByAccount: new Map(), cyclesByAccount: new Map(), followed: new Set() }
  }
  const accountIds = rows.map((r) => r.id)
  const ph = accountIds.map(() => '?').join(',')

  // 2. active linked cards (card filter applies here — one shared account
  // surfaces once regardless of how many cards link it).
  const cardConditions = ['ac.retired_at IS NULL']
  const cardBinds: unknown[] = [...accountIds]
  if (f.card_id !== null) {
    cardConditions.push('ac.card_id = ?')
    cardBinds.push(f.card_id)
  }
  const { results: cardRows } = await db
    .prepare(
      `SELECT ac.account_id, ac.card_id
       FROM opportunity_account_cards ac
       JOIN credit_cards cc ON cc.id = ac.card_id
       WHERE ac.account_id IN (${ph}) AND ${cardConditions.join(' AND ')}
       ORDER BY ac.card_id`,
    )
    .bind(...cardBinds)
    .all<{ account_id: string; card_id: string }>()
  const cardsByAccount = new Map<string, string[]>()
  const activeCardsResult = await db
    .prepare(
      `SELECT cc.id FROM credit_cards cc
       JOIN card_holders h ON h.id = cc.holder_id
       WHERE cc.status = 'active' AND cc.card_type = 'credit' AND ${scope.sql}`,
    )
    .bind(...scope.binds)
    .all<{ id: string }>()
  const activeCardIds = new Set(activeCardsResult.results.map((r) => r.id))
  for (const row of cardRows) {
    // has_active_linked_card requires an ACTIVE CREDIT card (§6.3: frozen,
    // cancelled and loan cards never count).
    if (activeCardIds.has(row.card_id)) {
      const list = cardsByAccount.get(row.account_id) ?? []
      list.push(row.card_id)
      cardsByAccount.set(row.account_id, list)
    }
  }

  // 3. cycles covering the next horizon (today's cycle needs dates around
  // each account's own timezone-today; fetch a wide window and match in JS).
  const { results: cycleRows } = await db
    .prepare(
      `SELECT id, account_id, cycle_key, allocation_kind, activation_state,
              period_start_on, period_end_before, usable_start_on, usable_end_before,
              time_zone, count_limit, amount_limit_minor, currency,
              opening_used_count, used_count, reserved_count,
              opening_used_minor, used_minor, reserved_minor, balance_verified
       FROM opportunity_cycles
       WHERE account_id IN (${ph})
         AND usable_start_on <= date(?, '+2 day')
         AND (usable_end_before IS NULL OR usable_end_before > date(?, '-2 day'))`,
    )
    .bind(...accountIds, nowIso, nowIso)
    .all<CycleWorldRow>()
  const cyclesByAccount = new Map<string, CycleWorldRow>()
  for (const cycle of cycleRows) {
    const existing = cyclesByAccount.get(cycle.account_id)
    // Ties break inside compareCycles: regular over grant, later period first.
    if (!existing || compareCycles(cycle, existing) < 0) {
      cyclesByAccount.set(cycle.account_id, cycle)
    }
  }

  // 4. personal follow states for this user only.
  const { results: stateRows } = await db
    .prepare(
      `SELECT account_id FROM opportunity_user_states
       WHERE user_id = ? AND account_id IN (${ph}) AND followed = 1`,
    )
    .bind(actor.user_id, ...accountIds)
    .all<{ account_id: string }>()

  return {
    rows,
    cardsByAccount,
    cyclesByAccount,
    followed: new Set(stateRows.map((r) => r.account_id)),
  }
}

function cycleCovers(cycle: CycleWorldRow, todayOn: string): boolean {
  return (
    cycle.usable_start_on <= todayOn &&
    (cycle.usable_end_before === null || todayOn < cycle.usable_end_before)
  )
}

// ---------------------------------------------------------------------------
// DTO assembly
// ---------------------------------------------------------------------------

function toDto(
  row: AccountWorldRow,
  rules: RuleSnapshotV1,
  cards: string[],
  cycle: CycleWorldRow | null,
  followed: boolean,
  nowIso: string,
): OpportunityDto {
  // “Today” in the rule's own timezone — a Shanghai rule and a New York rule
  // evaluate on their local dates (§4.2).
  const todayOn = localDateInZone(new Date(nowIso), rules.time_zone)
  const availability = computeAvailability({
    today_on: todayOn,
    weekday: isoWeekdayOf(todayOn),
    rules,
    definition_status: row.definition_status,
    terminated_at: row.terminated_at,
    account_status: row.account_status,
    eligibility: row.eligibility,
    eligible_from_on: row.eligible_from_on,
    has_active_linked_card: cards.length > 0,
    cycle: cycle
      ? {
          activation_state: cycle.activation_state,
          usable_start_on: cycle.usable_start_on,
          usable_end_before: cycle.usable_end_before,
          count_limit: cycle.count_limit,
          amount_limit_minor: cycle.amount_limit_minor,
          opening_used_count: cycle.opening_used_count,
          used_count: cycle.used_count,
          reserved_count: cycle.reserved_count,
          opening_used_minor: cycle.opening_used_minor,
          used_minor: cycle.used_minor,
          reserved_minor: cycle.reserved_minor,
        }
      : null,
    balance_verified: cycle ? cycle.balance_verified === 1 : false,
  })
  return {
    account_id: row.id,
    definition_id: row.definition_id,
    kind: row.kind,
    title: rules.title,
    category: rules.category,
    bank_id: rules.bank_id,
    card_ids: cards,
    holder_id: row.holder_id,
    holder_name: row.holder_name,
    scope_kind: row.scope_kind,
    revision: row.revision,
    status: availability.status,
    action: availability.action,
    reason: availability.reason,
    usable_today: availability.usable_today,
    needs_review: availability.needs_review,
    days_left: availability.days_left,
    deadline_on: cycle?.usable_end_before ?? rules.valid_until_before ?? null,
    cycle_id: cycle?.id ?? null,
    cycle_key: cycle?.cycle_key ?? null,
    period_start_on: cycle?.period_start_on ?? null,
    period_end_before: cycle?.period_end_before ?? null,
    count_limit: cycle?.count_limit ?? null,
    amount_limit_minor: cycle?.amount_limit_minor ?? null,
    currency: cycle?.currency ?? null,
    used_count: cycle?.used_count ?? null,
    reserved_count: cycle?.reserved_count ?? null,
    opening_used_count: cycle?.opening_used_count ?? null,
    remaining_count: availability.remaining_count,
    remaining_minor: availability.remaining_minor,
    unit_label: rules.unit_label,
    entry: rules.entry,
    followed,
    today_on: todayOn,
  }
}

interface AssembledWorld {
  dtos: OpportunityDto[]
  scopeHolderIds: string[]
}

async function assemble(
  actor: OpportunityActor,
  filters: OpportunityPageFilters,
  nowIso: string,
): Promise<AssembledWorld> {
  const f = validateFilters(filters)
  const scopeHolderIds = await resolveOpportunityScope(actor)
  // A holder filter outside the actor's scope yields an empty page, not a leak.
  if (f.holder_id !== null && !scopeHolderIds.includes(f.holder_id)) {
    return { dtos: [], scopeHolderIds }
  }
  const world = await loadWorld(actor, f, nowIso)
  const dtos: OpportunityDto[] = []
  for (const row of world.rows) {
    if (row.rules_json === null) continue // definition without a version: needs_confirmation UI later
    let rules: RuleSnapshotV1
    try {
      rules = parseRules(row.rules_json)
    } catch {
      continue // corrupt snapshot stays out of the list; reconciliation flags it
    }
    const cards = world.cardsByAccount.get(row.id) ?? []
    const todayOn = localDateInZone(new Date(nowIso), rules.time_zone)
    const cycle = world.cyclesByAccount.get(row.id) ?? null
    const covering = cycle && cycleCovers(cycle, todayOn) ? cycle : null
    dtos.push(toDto(row, rules, cards, covering, world.followed.has(row.id), nowIso))
  }
  return { dtos, scopeHolderIds }
}

function sortDtos(dtos: OpportunityDto[]): OpportunityDto[] {
  return [...dtos].sort((a, b) => {
    const rank = AVAILABILITY_SORT_RANK[a.status] - AVAILABILITY_SORT_RANK[b.status]
    if (rank !== 0) return rank
    // Same rank: earliest deadline first (null = no deadline → last), then
    // title, then account id — stable, no value scoring (§6.2).
    const dl = (x: OpportunityDto) => (x.days_left === null ? Number.MAX_SAFE_INTEGER : x.days_left)
    if (dl(a) !== dl(b)) return dl(a) - dl(b)
    if (a.title !== b.title) return a.title.localeCompare(b.title, 'zh-Hans-CN')
    return a.account_id.localeCompare(b.account_id)
  })
}

// ---------------------------------------------------------------------------
// Cursor — opaque, bound to the active filters (spec §9.1)
// ---------------------------------------------------------------------------

interface CursorPayload {
  offset: number
  filters: string
}

function filtersFingerprint(f: OpportunityPageFilters): string {
  const norm = validateFilters(f)
  return JSON.stringify([
    norm.holder_id, norm.card_id, norm.bank_id, norm.category, norm.kind, norm.q,
  ])
}

function encodeCursor(offset: number, fingerprint: string): string {
  const payload: CursorPayload = { offset, filters: fingerprint }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string, fingerprint: string): number {
  let payload: CursorPayload
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload
  } catch {
    throw new OpportunityError('VALIDATION_FAILED', 'cursor 不合法', { field: 'cursor' })
  }
  if (payload.filters !== fingerprint) {
    throw new OpportunityError('VALIDATION_FAILED', '筛选条件已变化，请从第一页开始', { field: 'cursor' })
  }
  if (!Number.isInteger(payload.offset) || payload.offset < 0) {
    throw new OpportunityError('VALIDATION_FAILED', 'cursor 不合法', { field: 'cursor' })
  }
  return payload.offset
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/** The unified opportunity list (spec §9 getOpportunityPage). */
export async function getOpportunityPage(
  actor: OpportunityActor,
  filters: OpportunityPageFilters = {},
  opts: { now?: string } = {},
): Promise<OpportunityPage> {
  const nowIso = opts.now ?? new Date().toISOString()
  const f = validateFilters(filters)
  const { dtos } = await assemble(actor, filters, nowIso)

  // Counts share the same snapshot minus the status filter (§6.2).
  const counts: Record<string, number> = {}
  for (const status of STATUSES) counts[status] = 0
  for (const dto of dtos) counts[dto.status] += 1

  const statusFiltered =
    f.status === null ? dtos : dtos.filter((d) => d.status === f.status)
  const sorted = sortDtos(statusFiltered)

  const fingerprint = filtersFingerprint(filters)
  const limit = f.limit ?? PAGE_LIMIT_DEFAULT
  const offset = f.cursor === null ? 0 : decodeCursor(f.cursor, fingerprint)
  const page = sorted.slice(offset, offset + limit)
  const nextCursor =
    offset + limit < sorted.length ? encodeCursor(offset + limit, fingerprint) : null
  return { items: page, next_cursor: nextCursor, counts }
}

/**
 * Distinct accounts usable today — the dashboard “今天可用 N 项” figure.
 * Excludes claims-pending, needs-confirmation and tasks by construction (they
 * are not available_today).
 */
export async function getTodayAvailableCount(
  actor: OpportunityActor,
  opts: { now?: string } = {},
): Promise<number> {
  const nowIso = opts.now ?? new Date().toISOString()
  const { dtos } = await assemble(actor, {}, nowIso)
  return dtos.filter((d) => d.usable_today).length
}

/**
 * Opportunities linked to one card — the card detail “可用机会” strip. Same
 * DTO and availability as the list page (accounts dedupe: a shared account
 * appears once).
 */
export async function getCardOpportunities(
  actor: OpportunityActor,
  cardId: unknown,
  limit = 3,
  opts: { now?: string } = {},
): Promise<OpportunityDto[]> {
  if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 64) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 card_id 不合法', { field: 'card_id' })
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) {
    limit = Math.min(Math.max(limit, 1), PAGE_LIMIT_MAX)
  }
  const nowIso = opts.now ?? new Date().toISOString()
  const page = await getOpportunityPage(actor, { card_id: cardId }, { now: nowIso })
  return page.items.slice(0, limit)
}

/**
 * The benefit ledger view: accounts with their current cycle, balance and
 * review hints (opening unverified / unassigned legacy history).
 */
export interface LedgerRow extends OpportunityDto {
  /** Earliest unverified hint; null when the account is clean. */
  review_hint: string | null
}

export async function getBenefitLedger(
  actor: OpportunityActor,
  filters: OpportunityPageFilters = {},
  opts: { now?: string } = {},
): Promise<{ items: LedgerRow[]; next_cursor: string | null; counts: Record<string, number> }> {
  const page = await getOpportunityPage(actor, filters, opts)
  const db = getDb()

  // Unassigned legacy history touching this actor's definitions — content-free
  // hint only (never the notes themselves).
  const accountIds = page.items.map((i) => i.account_id)
  const hintByAccount = new Map<string, string>()
  if (accountIds.length > 0) {
    const ph = accountIds.map(() => '?').join(',')
    const { results: legacyRows } = await db
      .prepare(
        `SELECT a.id AS account_id, COUNT(*) AS n
         FROM opportunity_definitions d
         JOIN opportunity_accounts a ON a.definition_id = d.id
         JOIN promos p ON d.legacy_promo_id = p.id
         JOIN promo_usages pu ON pu.promo_id = p.id
         LEFT JOIN opportunity_legacy_links l
           ON l.source_table = 'promo_usages' AND l.source_id = pu.id
         WHERE a.id IN (${ph}) AND l.source_id IS NULL
         GROUP BY a.id`,
      )
      .bind(...accountIds)
      .all<{ account_id: string; n: number }>()
    for (const row of legacyRows) {
      hintByAccount.set(row.account_id, `有 ${row.n} 条待归属历史记录`)
    }
  }

  const items: LedgerRow[] = page.items.map((dto) => ({
    ...dto,
    review_hint:
      hintByAccount.get(dto.account_id) ??
      (dto.needs_review ? '期初余额未核对' : null),
  }))
  return { items, next_cursor: page.next_cursor, counts: page.counts }
}

/** Full detail for one account (spec §9 getOpportunityDetail). */
export interface OpportunityDetail extends LedgerRow {
  eligibility: 'unknown' | 'confirmed' | 'ineligible'
  eligible_from_on: string | null
  definition_status: 'active' | 'archived'
  terminated_at: string | null
  bank_name: string | null
}

export async function getOpportunityDetail(
  actor: OpportunityActor,
  accountId: unknown,
  opts: { now?: string } = {},
): Promise<OpportunityDetail> {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 account_id 不合法', { field: 'account_id' })
  }
  const nowIso = opts.now ?? new Date().toISOString()
  const scope = holderScopePredicate(actor)
  const row = await getDb()
    .prepare(
      `SELECT a.id, a.definition_id, a.holder_id, a.scope_kind, a.eligibility,
              a.eligible_from_on, a.status AS account_status, a.revision,
              h.name AS holder_name,
              d.kind, d.status AS definition_status, d.terminated_at,
              (SELECT rules_json FROM opportunity_rule_versions v2
                 WHERE v2.definition_id = d.id
                 ORDER BY v2.version DESC LIMIT 1) AS rules_json
       FROM opportunity_accounts a
       JOIN card_holders h ON h.id = a.holder_id
       JOIN opportunity_definitions d ON d.id = a.definition_id
       WHERE a.id = ? AND ${scope.sql}`,
    )
    .bind(accountId, ...scope.binds)
    .first<AccountWorldRow>()
  if (!row || !row.rules_json) throw forbiddenOrNotFound('account')

  const rules = parseRules(row.rules_json)
  const cards = (
    await getDb()
      .prepare(
        'SELECT card_id FROM opportunity_account_cards WHERE account_id = ? AND retired_at IS NULL ORDER BY card_id',
      )
      .bind(accountId)
      .all<{ card_id: string }>()
  ).results.map((r) => r.card_id)
  const todayOn = localDateInZone(new Date(nowIso), rules.time_zone)
  const cycles = (
    await getDb()
      .prepare(
        `SELECT id, account_id, cycle_key, allocation_kind, activation_state,
                period_start_on, period_end_before, usable_start_on, usable_end_before,
                time_zone, count_limit, amount_limit_minor, currency,
                opening_used_count, used_count, reserved_count,
                opening_used_minor, used_minor, reserved_minor, balance_verified
         FROM opportunity_cycles WHERE account_id = ?`,
      )
      .bind(accountId)
      .all<CycleWorldRow>()
  ).results
  const covering = cycles.filter((c) => cycleCovers(c, todayOn)).sort(compareCycles)[0] ?? null
  const followed = await getDb()
    .prepare('SELECT followed FROM opportunity_user_states WHERE user_id = ? AND account_id = ?')
    .bind(actor.user_id, accountId)
    .first<{ followed: number }>()

  const dto = toDto(row, rules, cards, covering ?? null, followed?.followed === 1, nowIso)
  return {
    ...dto,
    review_hint: dto.needs_review ? '期初余额未核对' : null,
    eligibility: row.eligibility,
    eligible_from_on: row.eligible_from_on,
    definition_status: row.definition_status,
    terminated_at: row.terminated_at,
    bank_name: rules.bank_id,
  }
}

/** Stable comparator: regular before grant, later period first. */
function compareCycles(a: CycleWorldRow, b: CycleWorldRow): number {
  if (a.allocation_kind !== b.allocation_kind) {
    return a.allocation_kind === 'regular' ? -1 : 1
  }
  return b.period_start_on.localeCompare(a.period_start_on)
}

// ---------------------------------------------------------------------------
// setOpportunityFollowed (user-level state, no quota semantics)
// ---------------------------------------------------------------------------

export async function setOpportunityFollowed(
  actor: OpportunityActor,
  input: {
    account_id: string
    followed: boolean
    expected_revision?: number | null
  },
  opts: { now?: string } = {},
): Promise<{ account_id: string; followed: boolean; revision: number }> {
  const now = opts.now ?? new Date().toISOString()
  if (typeof input.account_id !== 'string' || input.account_id.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', '参数 account_id 不合法', { field: 'account_id' })
  }
  await (await import('./scope.server')).assertAccountAccess(input.account_id, actor)
  const db = getDb()

  const existing = await db
    .prepare('SELECT followed, revision FROM opportunity_user_states WHERE user_id = ? AND account_id = ?')
    .bind(actor.user_id, input.account_id)
    .first<{ followed: number; revision: number }>()

  if (existing) {
    if (
      input.expected_revision !== undefined &&
      input.expected_revision !== null &&
      input.expected_revision !== existing.revision
    ) {
      throw new OpportunityError('REVISION_CONFLICT', '关注状态已被其他操作修改，请刷新后重试', {
        expected_revision: input.expected_revision,
        actual_revision: existing.revision,
      })
    }
    const { results } = await db
      .prepare(
        `UPDATE opportunity_user_states
         SET followed = ?, revision = revision + 1, updated_at = ?
         WHERE user_id = ? AND account_id = ? AND revision = ?
         RETURNING revision`,
      )
      .bind(input.followed ? 1 : 0, now, actor.user_id, input.account_id, existing.revision)
      .all<{ revision: number }>()
    if (results.length === 0) {
      throw new OpportunityError('REVISION_CONFLICT', '关注状态已被其他操作修改，请刷新后重试')
    }
    return { account_id: input.account_id, followed: input.followed, revision: results[0].revision }
  }

  await db
    .prepare(
      `INSERT INTO opportunity_user_states (user_id, account_id, followed, revision, updated_at)
       VALUES (?,?,?,1,?)`,
    )
    .bind(actor.user_id, input.account_id, input.followed ? 1 : 0, now)
    .run()
  return { account_id: input.account_id, followed: input.followed, revision: 1 }
}

// ---------------------------------------------------------------------------
// exportOpportunityUsages — flat, scoped, page-based (spec §9/§12)
// ---------------------------------------------------------------------------

export interface ExportUsageRow {
  used_on: string
  kind: string
  title: string
  holder_name: string
  card_id: string
  cycle_key: string | null
  quantity: number
  amount_minor: number
  currency: string | null
  status: string
  note: string | null
  source: 'ledger'
}

export interface ExportUsagePage {
  items: ExportUsageRow[]
  next_cursor: string | null
}

/**
 * Flat export DTO over ledger usages. holder/card/date/kind filters all apply
 * in SQL inside the actor's scope; nothing outside the scope is ever read.
 */
export async function exportOpportunityUsages(
  actor: OpportunityActor,
  input: {
    holder_id?: string | null
    card_id?: string | null
    from_on?: string | null
    to_before?: string | null
    kind?: string | null
    cursor?: string | null
    limit?: number | null
  } = {},
): Promise<ExportUsagePage> {
  const scope = holderScopePredicate(actor)
  const conditions = [scope.sql]
  const binds: unknown[] = [...scope.binds]
  if (input.holder_id) {
    conditions.push('a.holder_id = ?')
    binds.push(input.holder_id)
  }
  if (input.card_id) {
    conditions.push('u.card_id = ?')
    binds.push(input.card_id)
  }
  if (input.from_on) {
    conditions.push('u.used_on >= ?')
    binds.push(input.from_on)
  }
  if (input.to_before) {
    conditions.push('u.used_on < ?')
    binds.push(input.to_before)
  }
  if (input.kind) {
    conditions.push('d.kind = ?')
    binds.push(input.kind)
  }
  const lastId = typeof input.cursor === 'string' && input.cursor.length > 0 ? input.cursor : null
  if (lastId) {
    conditions.push('u.id > ?')
    binds.push(lastId)
  }
  const limit = Math.min(Math.max(Number.isInteger(input.limit) ? (input.limit as number) : 200, 1), 500)

  const { results } = await getDb()
    .prepare(
      `SELECT u.used_on, d.kind, d.id AS definition_id, h.name AS holder_name,
              u.card_id, c.cycle_key, u.quantity, u.amount_minor, c.currency,
              u.status, u.note, u.id
       FROM opportunity_usages u
       JOIN opportunity_accounts a ON a.id = u.account_id
       JOIN card_holders h ON h.id = a.holder_id
       JOIN opportunity_definitions d ON d.id = a.definition_id
       LEFT JOIN opportunity_cycles c ON c.id = u.cycle_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.id ASC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      used_on: string; kind: string; definition_id: string; holder_name: string
      card_id: string; cycle_key: string | null; quantity: number; amount_minor: number
      currency: string | null; status: string; note: string | null; id: string
    }>()

  // Titles resolve from each definition's newest version in one query.
  const defIds = [...new Set(results.map((r) => r.definition_id))]
  const titleByDef = new Map<string, string>()
  if (defIds.length > 0) {
    const ph = defIds.map(() => '?').join(',')
    const { results: versionRows } = await getDb()
      .prepare(
        `SELECT definition_id, json_extract(rules_json, '$.title') AS title
         FROM opportunity_rule_versions
         WHERE definition_id IN (${ph}) AND version = (
           SELECT MAX(v2.version) FROM opportunity_rule_versions v2
           WHERE v2.definition_id = opportunity_rule_versions.definition_id)`,
      )
      .bind(...defIds)
      .all<{ definition_id: string; title: string | null }>()
    for (const row of versionRows) {
      titleByDef.set(row.definition_id, row.title ?? '(未知)')
    }
  }

  const items: ExportUsageRow[] = results.map((r) => ({
    used_on: r.used_on,
    kind: r.kind,
    title: titleByDef.get(r.definition_id) ?? '(未知)',
    holder_name: r.holder_name,
    card_id: r.card_id,
    cycle_key: r.cycle_key,
    quantity: r.quantity,
    amount_minor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    note: r.note,
    source: 'ledger' as const,
  }))

  return {
    items,
    next_cursor: results.length === limit ? results[results.length - 1].id : null,
  }
}
