// lib/opportunities/notifications.server.ts — calendar query, reminder list
// and personal state writes (plan Task 14 second half, spec §10). Static P1
// events only: no booking/task events are fabricated before P2 data exists.
// Unverified rule versions surface as review items (needs_review) and are
// excluded from nudge-grade reminders — they never become push pressure.

import { getDb } from '../db/client'
import type { OpportunityActor } from './types'
import { OpportunityError, forbiddenOrNotFound, revisionConflict } from './errors'
import { holderScopePredicate } from './scope.server'
import { parseRules } from './catalog.server'
import {
  addDays,
  isValidCivilDate,
  isValidRfc3339Utc,
  localDateInZone,
} from './dates'
import {
  buildCycleCalendarEvents,
  applyReminderStateAction,
  reminderStateFromRow,
  type OpportunityCalendarEvent,
} from './reminders'

const CALENDAR_MAX_DAYS = 92
const REMINDER_HORIZON_DAYS = 30

interface CalendarAccountRow {
  account_id: string
  holder_id: string
  definition_id: string
  verification: string
  version_id: string
  rules_json: string
}

interface CalendarCycleRow {
  id: string
  account_id: string
  cycle_key: string
  allocation_kind: string
  usable_start_on: string
  usable_end_before: string | null
}

function requireCivilDate(value: unknown, field: string): string {
  if (!isValidCivilDate(value)) {
    throw new OpportunityError('VALIDATION_FAILED', `参数 ${field} 不合法`, { field })
  }
  return value as string
}

async function loadScopedEvents(
  actor: OpportunityActor,
  filters: { holder_id?: string | null; card_id?: string | null },
): Promise<OpportunityCalendarEvent[]> {
  const db = getDb()
  const scope = holderScopePredicate(actor)
  const conditions = [scope.sql]
  const binds: unknown[] = [...scope.binds]
  if (filters.holder_id) {
    conditions.push('a.holder_id = ?')
    binds.push(filters.holder_id)
  }
  if (filters.card_id) {
    conditions.push(
      `EXISTS (SELECT 1 FROM opportunity_account_cards ac
         WHERE ac.account_id = a.id AND ac.card_id = ? AND ac.retired_at IS NULL)`,
    )
    binds.push(filters.card_id)
  }

  const { results: accounts } = await db
    .prepare(
      `SELECT a.id AS account_id, a.holder_id, a.definition_id, v.id AS version_id,
              v.verification, v.rules_json
       FROM opportunity_accounts a
       JOIN card_holders h ON h.id = a.holder_id
       JOIN opportunity_definitions d ON d.id = a.definition_id AND d.status = 'active'
       LEFT JOIN opportunity_rule_versions v
         ON v.definition_id = d.id
        AND v.version = (SELECT MAX(v2.version) FROM opportunity_rule_versions v2
                          WHERE v2.definition_id = d.id)
       WHERE ${conditions.join(' AND ')}`,
    )
    .bind(...binds)
    .all<CalendarAccountRow>()

  const events: OpportunityCalendarEvent[] = []
  for (const account of accounts) {
    if (!account.rules_json) continue
    let rules
    try {
      rules = parseRules(account.rules_json)
    } catch {
      continue // corrupt snapshots stay out of the calendar; reconciliation owns them
    }
    const { results: cycles } = await db
      .prepare(
        `SELECT id, account_id, cycle_key, allocation_kind, usable_start_on, usable_end_before
         FROM opportunity_cycles WHERE account_id = ? ORDER BY usable_start_on`,
      )
      .bind(account.account_id)
      .all<CalendarCycleRow>()
    for (const cycle of cycles) {
      events.push(
        ...(await buildCycleCalendarEvents({
          account_id: account.account_id,
          cycle_id: cycle.id,
          title: rules.title,
          time_zone: rules.time_zone,
          usable_start_on: cycle.usable_start_on,
          usable_end_before: cycle.usable_end_before,
          next_reset_on:
            cycle.allocation_kind === 'regular' && cycle.usable_end_before !== null
              ? cycle.usable_end_before
              : null,
          claim_window: rules.claim_window,
          version_id: account.version_id,
          verification: (account.verification ?? 'unverified') as
            | 'unverified' | 'user_confirmed' | 'official_verified',
        })),
      )
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// getOpportunityCalendar
// ---------------------------------------------------------------------------

export interface CalendarEventView extends OpportunityCalendarEvent {
  dismissed: boolean
  snoozed_until: string | null
}

export async function getOpportunityCalendar(
  actor: OpportunityActor,
  input: { from_on: string; to_before: string; holder_id?: string | null; card_id?: string | null },
): Promise<{ events: CalendarEventView[] }> {
  const fromOn = requireCivilDate(input.from_on, 'from_on')
  const toBefore = requireCivilDate(input.to_before, 'to_before')
  if (toBefore <= fromOn) {
    throw new OpportunityError('VALIDATION_FAILED', 'to_before 必须晚于 from_on', { field: 'to_before' })
  }
  const days = Math.round((Date.parse(`${toBefore}T00:00:00Z`) - Date.parse(`${fromOn}T00:00:00Z`)) / 86_400_000)
  if (days > CALENDAR_MAX_DAYS) {
    throw new OpportunityError('VALIDATION_FAILED', `日历范围最多 ${CALENDAR_MAX_DAYS} 天`, {
      field: 'to_before',
      days,
    })
  }

  const events = await loadScopedEvents(actor, input)
  const inRange = events
    .filter((e) => e.local_date_on >= fromOn && e.local_date_on < toBefore)
    .sort((a, b) => a.local_date_on.localeCompare(b.local_date_on) || a.event_key.localeCompare(b.event_key))

  const states = await loadStates(actor, inRange.map((e) => e.event_key))
  return {
    events: inRange.map((e) => {
      const state = states.get(e.event_key)
      return {
        ...e,
        dismissed: state?.dismissed_at != null,
        snoozed_until: state?.snooze_until ?? null,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// getOpportunityReminders — pending actionable items with personal state
// ---------------------------------------------------------------------------

export interface ReminderItem {
  event: OpportunityCalendarEvent
  state: { read_steps: string[]; dismissed_at: string | null; snooze_until: string | null; revision: number }
}

export interface ReminderPage {
  items: ReminderItem[]
  next_cursor: string | null
}

export async function getOpportunityReminders(
  actor: OpportunityActor,
  input: { holder_id?: string | null; card_id?: string | null; cursor?: string | null; limit?: number | null } = {},
): Promise<ReminderPage> {
  const limit = Math.min(Math.max(Number.isInteger(input.limit) ? (input.limit as number) : 30, 1), 100)
  const nowIso = new Date().toISOString()
  // “今天”以规则时区逐账户评估过；这里用调用方可在浏览器展示的本地口径截取
  // 窗口（服务端不依赖主机时区）。
  const todayOn = localDateInZone(new Date(nowIso), 'Asia/Shanghai')
  const horizonEnd = addDays(todayOn, REMINDER_HORIZON_DAYS)

  const events = await loadScopedEvents(actor, input)
  const states = await loadStates(actor, events.map((e) => e.event_key))

  const pending = events
    .filter((e) => e.local_date_on >= todayOn && e.local_date_on <= horizonEnd)
    .filter((e) => !e.needs_review) // 未核实数据只进待核对，不进催用提醒
    .filter((e) => {
      const state = states.get(e.event_key)
      if (!state) return true
      if (state.dismissed_at !== null) return false
      if (state.snooze_until !== null && state.snooze_until > nowIso) return false
      return true
    })
    .sort((a, b) => a.local_date_on.localeCompare(b.local_date_on) || a.event_key.localeCompare(b.event_key))

  const lastKey = typeof input.cursor === 'string' && input.cursor.length > 0 ? input.cursor : null
  const start = lastKey
    ? Math.max(pending.findIndex((e) => e.event_key === lastKey), 0) + (pending.some((e) => e.event_key === lastKey) ? 1 : 0)
    : 0
  const page = pending.slice(start, start + limit)
  return {
    items: page.map((e) => {
      const state = states.get(e.event_key)
      return {
        event: e,
        state: state
          ? { read_steps: state.read_steps, dismissed_at: state.dismissed_at, snooze_until: state.snooze_until, revision: state.revision }
          : { read_steps: [], dismissed_at: null, snooze_until: null, revision: 0 },
      }
    }),
    next_cursor: start + limit < pending.length ? (page[page.length - 1]?.event_key ?? null) : null,
  }
}

// ---------------------------------------------------------------------------
// updateOpportunityReminderState
// ---------------------------------------------------------------------------

export interface UpdateReminderStateInput {
  event_key: string
  action: 'read' | 'dismiss' | 'snooze' | 'restore'
  step?: string | null
  until_at?: string | null
  deadline_utc?: string | null
  expected_revision?: number | null
}

async function loadStates(
  actor: OpportunityActor,
  eventKeys: string[],
): Promise<Map<string, { read_steps: string[]; dismissed_at: string | null; snooze_until: string | null; revision: number }>> {
  const map = new Map()
  if (eventKeys.length === 0) return map
  const db = getDb()
  const ph = eventKeys.map(() => '?').join(',')
  const { results } = await db
    .prepare(
      `SELECT event_key, read_steps_json, dismissed_at, snooze_until, revision
       FROM opportunity_reminder_states WHERE user_id = ? AND event_key IN (${ph})`,
    )
    .bind(actor.user_id, ...eventKeys)
    .all<{
      event_key: string; read_steps_json: string; dismissed_at: string | null
      snooze_until: string | null; revision: number
    }>()
  for (const row of results) {
    map.set(row.event_key, reminderStateFromRow(row))
  }
  return map
}

/**
 * Persists one personal state transition. The event's account must be inside
 * the actor's scope (parsed from the event key, then re-authorized); snoozing
 * past the event's action deadline is refused by the pure transition.
 */
export async function updateOpportunityReminderState(
  actor: OpportunityActor,
  input: UpdateReminderStateInput,
  opts: { now?: string } = {},
): Promise<{ event_key: string; revision: number }> {
  const now = opts.now ?? new Date().toISOString()
  if (!isValidRfc3339Utc(now)) {
    throw new OpportunityError('VALIDATION_FAILED', 'now 不是合法 UTC 时间', { field: 'now' })
  }
  if (typeof input.event_key !== 'string' || !input.event_key.startsWith('op:')) {
    throw new OpportunityError('VALIDATION_FAILED', 'event_key 不合法', { field: 'event_key' })
  }
  // event_key = op:<type>:<account_id>:<cycle_or_grant_key>:<hash>
  const parts = input.event_key.split(':')
  const accountId = parts[2]
  if (!accountId) throw new OpportunityError('VALIDATION_FAILED', 'event_key 不合法', { field: 'event_key' })
  const db = getDb()
  const scope = holderScopePredicate(actor)
  const owned = await db
    .prepare(
      `SELECT 1 AS ok FROM opportunity_accounts a JOIN card_holders h ON h.id = a.holder_id
       WHERE a.id = ? AND ${scope.sql}`,
    )
    .bind(accountId, ...scope.binds)
    .first<{ ok: number }>()
  if (!owned) throw forbiddenOrNotFound('reminder_event')

  const existing = await db
    .prepare(
      `SELECT event_key, read_steps_json, dismissed_at, snooze_until, revision
       FROM opportunity_reminder_states WHERE user_id = ? AND event_key = ?`,
    )
    .bind(actor.user_id, input.event_key)
    .first<{ event_key: string; read_steps_json: string; dismissed_at: string | null; snooze_until: string | null; revision: number }>()

  const current = existing
    ? reminderStateFromRow(existing)
    : { read_steps: [], dismissed_at: null, snooze_until: null, revision: 0 }

  if (
    input.expected_revision !== undefined &&
    input.expected_revision !== null &&
    input.expected_revision !== current.revision
  ) {
    throw revisionConflict({ expected_revision: input.expected_revision, actual_revision: current.revision })
  }

  const next = applyReminderStateAction(current, input.action, {
    now,
    step: input.step ?? undefined,
    until_utc: input.until_at ?? undefined,
    deadline_utc: input.deadline_utc ?? undefined,
  })

  await db
    .prepare(
      `INSERT INTO opportunity_reminder_states (user_id, event_key, read_steps_json, dismissed_at, snooze_until, revision, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id, event_key) DO UPDATE SET
         read_steps_json = excluded.read_steps_json,
         dismissed_at = excluded.dismissed_at,
         snooze_until = excluded.snooze_until,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    )
    .bind(
      actor.user_id,
      input.event_key,
      JSON.stringify(next.read_steps),
      next.dismissed_at,
      next.snooze_until,
      next.revision,
      now,
    )
    .run()

  return { event_key: input.event_key, revision: next.revision }
}
