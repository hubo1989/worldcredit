// lib/opportunities/reminders.ts — pure reminder primitives (tech spec §10):
// user config with deep-merged defaults, stable event/delivery identity whose
// business hash covers only action-relevant inputs, threshold day-nodes,
// wall-clock → UTC instant resolution with DST gap/fold handling, quiet-hours
// postponement and the read/dismiss/snooze/restore state machine. No I/O:
// every `now` and timezone comes from the caller, so P1 calendar queries and
// the P2 cron scanner share exactly these rules.

import { addDays, isValidCivilDate, isValidIanaTimeZone } from './dates'
import { canonicalJson, sha256Hex } from './hash'
import { OpportunityError } from './errors'

// ---------------------------------------------------------------------------
// User config (§10.2) — stored at reminder_config.opportunities, deep-merged
// over defaults on read; unknown legacy fields under other subtrees are kept
// untouched by the preferences service.
// ---------------------------------------------------------------------------

export interface OpportunityReminderConfig {
  enabled: boolean
  web_push_enabled: boolean
  time_zone: string
  local_time: string
  expiry_days_before: number[]
  activity_days_before: number[]
  claim_days_before: number[]
  task_days_before: number[]
  reset_enabled: boolean
  booking_enabled: boolean
}

export const DEFAULT_OPPORTUNITY_REMINDER_CONFIG: OpportunityReminderConfig = {
  enabled: true,
  web_push_enabled: true,
  time_zone: 'Asia/Shanghai',
  local_time: '09:00',
  expiry_days_before: [3, 1, 0],
  activity_days_before: [7, 3, 1],
  claim_days_before: [3, 1, 0],
  task_days_before: [3, 1, 0],
  reset_enabled: true,
  booking_enabled: true,
}

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MAX_DAYS_BEFORE = 366

function mergeDays(value: unknown): number[] {
  if (value === undefined) throw new OpportunityError('VALIDATION_FAILED', '提醒天数配置缺失', {
    field: 'days_before',
  })
  if (!Array.isArray(value)) {
    throw new OpportunityError('VALIDATION_FAILED', '提醒天数必须是数组', {
      field: 'days_before',
    })
  }
  const days = value.map((d) => {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > MAX_DAYS_BEFORE) {
      throw new OpportunityError('VALIDATION_FAILED', '提醒天数必须是 0–366 的整数', {
        field: 'days_before',
        value: d,
      })
    }
    return d
  })
  // Normalize: dedupe + descending remaining days (d7 scans before d3).
  return [...new Set(days)].sort((a, b) => b - a)
}

function mergeTimeOfDay(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HH_MM_RE.test(value)) {
    throw new OpportunityError('VALIDATION_FAILED', `${field} 必须是 HH:MM（24 小时制）`, {
      field,
    })
  }
  return value
}

function mergeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new OpportunityError('VALIDATION_FAILED', `${field} 必须是布尔值`, { field })
  }
  return value
}

/**
 * Overlays a stored (possibly partial/legacy) `reminder_config.opportunities`
 * value onto the defaults. Arrays replace wholesale; every provided field is
 * validated so a corrupt row fails loudly at read time, never silently
 * disables reminders.
 */
export function mergeOpportunityReminderConfig(
  stored: unknown,
): OpportunityReminderConfig {
  if (stored === null || stored === undefined) return { ...DEFAULT_OPPORTUNITY_REMINDER_CONFIG }
  if (typeof stored !== 'object' || Array.isArray(stored)) {
    throw new OpportunityError('VALIDATION_FAILED', '权益提醒配置格式不正确', {
      field: 'opportunities',
    })
  }
  const raw = stored as Record<string, unknown>
  const tz = raw.time_zone ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.time_zone
  if (!isValidIanaTimeZone(tz)) {
    throw new OpportunityError('VALIDATION_FAILED', '提醒时区不合法', { field: 'time_zone' })
  }
  return {
    enabled: mergeBoolean(raw.enabled ?? true, 'enabled'),
    web_push_enabled: mergeBoolean(raw.web_push_enabled ?? true, 'web_push_enabled'),
    time_zone: tz,
    local_time: mergeTimeOfDay(
      raw.local_time ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.local_time,
      'local_time',
    ),
    expiry_days_before: mergeDays(raw.expiry_days_before ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.expiry_days_before),
    activity_days_before: mergeDays(raw.activity_days_before ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.activity_days_before),
    claim_days_before: mergeDays(raw.claim_days_before ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.claim_days_before),
    task_days_before: mergeDays(raw.task_days_before ?? DEFAULT_OPPORTUNITY_REMINDER_CONFIG.task_days_before),
    reset_enabled: mergeBoolean(raw.reset_enabled ?? true, 'reset_enabled'),
    booking_enabled: mergeBoolean(raw.booking_enabled ?? true, 'booking_enabled'),
  }
}

// ---------------------------------------------------------------------------
// Identity (§10.1)
//
//   event_key    = op:<type>:<object_id>:<cycle_or_grant_key>:<business_date_hash>
//   delivery_key = <event_key>:<step>
//   tag          = wc-op:<delivery_key>
//
// business_date_hash covers ONLY inputs that change what the user must do:
// the deadline/service timepoint, the rule time windows and the rule version.
// Notes and current usage never enter the hash, so ordinary usage changes do
// not respawn reminders; a corrected deadline produces a new event (whose old
// jobs the scanner cancels).
// ---------------------------------------------------------------------------

export interface ReminderEventIdentity {
  type: string
  object_id: string
  /** cycle_key, or the grant key for reward-only allocations. */
  cycle_or_grant_key: string
  /** Action deadline/service timepoint; null for reset-style nodes. */
  deadline_before: string | null
  /** Rule version id (or workflow revision) that affects the action. */
  version: string
}

async function businessDateHash(identity: ReminderEventIdentity): Promise<string> {
  const canonical = canonicalJson({
    deadline_before: identity.deadline_before,
    version: identity.version,
  })
  return (await sha256Hex(canonical)).slice(0, 12)
}

export async function reminderEventKey(identity: ReminderEventIdentity): Promise<string> {
  for (const field of ['type', 'object_id', 'cycle_or_grant_key', 'version'] as const) {
    if (typeof identity[field] !== 'string' || identity[field].length === 0) {
      throw new OpportunityError('VALIDATION_FAILED', `提醒事件身份字段 ${field} 不合法`, {
        field,
      })
    }
  }
  return `op:${identity.type}:${identity.object_id}:${identity.cycle_or_grant_key}:${await businessDateHash(identity)}`
}

export function reminderDeliveryKey(eventKey: string, step: string): string {
  if (!eventKey.startsWith('op:') || step.length === 0) {
    throw new OpportunityError('VALIDATION_FAILED', '提醒投递键组成部分不合法', {
      event_key: eventKey,
      step,
    })
  }
  return `${eventKey}:${step}`
}

export function reminderTag(deliveryKey: string): string {
  return `wc-op:${deliveryKey}`
}

// ---------------------------------------------------------------------------
// Threshold day-nodes
// ---------------------------------------------------------------------------

export interface ReminderDayNode {
  step: string
  days_before: number
  local_date_on: string
}

/** Day nodes counting back from a half-open deadline (`deadline_before`). */
export function expiryThresholds(deadlineBefore: string, daysBefore: readonly number[]): ReminderDayNode[] {
  if (!isValidCivilDate(deadlineBefore)) {
    throw new OpportunityError('VALIDATION_FAILED', '提醒截止日不是合法日期', {
      deadline_before: deadlineBefore,
    })
  }
  return [...new Set(daysBefore)]
    .sort((a, b) => b - a)
    .map((days) => ({
      step: `d${days}`,
      days_before: days,
      local_date_on: addDays(deadlineBefore, -days),
    }))
}

export interface ClaimWindowNodes {
  open: ReminderDayNode
  deadlines: ReminderDayNode[]
}

/**
 * Nodes for a claim/booking window: one `open` node on the local date the
 * window starts, plus threshold nodes counting back from its end. The window's
 * local dates come from the rule's own time zone, resolved by the caller.
 */
export function claimWindowNodes(
  window: { starts_at: string; ends_at: string },
  daysBefore: readonly number[],
): ClaimWindowNodes {
  const openDate = window.starts_at.slice(0, 10)
  const endDate = window.ends_at.slice(0, 10)
  if (!isValidCivilDate(openDate) || !isValidCivilDate(endDate)) {
    throw new OpportunityError('VALIDATION_FAILED', '领取/预约窗口日期不合法', { window })
  }
  return {
    open: { step: 'open', days_before: 0, local_date_on: openDate },
    deadlines: expiryThresholds(endDate, daysBefore),
  }
}

// ---------------------------------------------------------------------------
// Wall clock → UTC instant (DST gap/fold)
// ---------------------------------------------------------------------------

export type WallTimeResolution = 'exact' | 'fold_earliest' | 'gap_postponed'

export interface WallTimeInstant {
  utc: string
  resolution: WallTimeResolution
}

const MINUTE_MS = 60_000
/** Wide enough to contain any transition around the naive instant. */
const PROBE_WINDOW_MS = 26 * 3_600_000

/** Timezone offset (minutes east of UTC) of `instant`, via Intl longOffset. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  if (!m) return 0 // "GMT" exactly
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3]))
}

function wallClockMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
}

/**
 * Resolves one local wall-clock time (civil date + HH:MM) in `timeZone` to
 * its UTC instant.
 *
 *   gap  (spring forward): the local time does not exist — postponed to the
 *        first valid instant (the transition itself), §10.3.
 *   fold (fall back): the local time occurs twice — the EARLIER UTC instant
 *        wins, so a repeated hour produces exactly one reminder.
 */
export function localWallTimeToInstant(dateOn: string, hhmm: string, timeZone: string): WallTimeInstant {
  if (!isValidCivilDate(dateOn)) {
    throw new OpportunityError('VALIDATION_FAILED', `不是合法日期: ${dateOn}`, { date_on: dateOn })
  }
  if (!HH_MM_RE.test(hhmm)) {
    throw new OpportunityError('VALIDATION_FAILED', `不是合法时刻（HH:MM）: ${hhmm}`, {
      hhmm,
    })
  }
  if (!isValidIanaTimeZone(timeZone)) {
    throw new OpportunityError('VALIDATION_FAILED', `时区不合法: ${timeZone}`, { time_zone: timeZone })
  }
  const target = Date.parse(`${dateOn}T${hhmm}:00Z`)

  // Candidate offsets from probes around the naive instant, then keep those
  // whose back-computed wall clock equals the target.
  const probes = [0, -PROBE_WINDOW_MS, PROBE_WINDOW_MS].map((shift) =>
    tzOffsetMinutes(new Date(target + shift), timeZone),
  )
  const offsets = [...new Set(probes)]
  const candidates = offsets
    .map((offset) => new Date(target - offset * MINUTE_MS))
    .filter((instant) => wallClockMs(instant, timeZone) === target)
    .sort((a, b) => a.getTime() - b.getTime())

  if (candidates.length > 0) {
    return {
      utc: candidates[0].toISOString().replace(/\.\d{3}Z$/, 'Z'),
      resolution: candidates.length > 1 ? 'fold_earliest' : 'exact',
    }
  }

  // Gap: binary-search the first instant whose wall clock reaches the target —
  // for a skipped hour that is the transition instant (e.g. 03:00 local).
  let low = target - PROBE_WINDOW_MS
  let high = target + PROBE_WINDOW_MS
  while (high - low > MINUTE_MS) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS
    if (wallClockMs(new Date(mid), timeZone) >= target) high = mid
    else low = mid
  }
  return {
    utc: new Date(high).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    resolution: 'gap_postponed',
  }
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

export interface QuietHoursWindow {
  quiet_hours_start?: string
  quiet_hours_end?: string
}

export interface DeliveryInstant extends WallTimeInstant {
  postponed_by_quiet_hours: boolean
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Resolves the delivery instant for one reminder node: the user's preferred
 * local time on the node's date, postponed to the quiet-hours end when it
 * falls inside the quiet interval. The postponed wall time itself goes through
 * DST resolution, so a quiet end inside a gap keeps postponing (§10.3).
 */
export function resolveDeliveryInstant(
  dateOn: string,
  hhmm: string,
  timeZone: string,
  quiet: QuietHoursWindow | undefined,
): DeliveryInstant {
  const base = localWallTimeToInstant(dateOn, hhmm, timeZone)
  if (!quiet?.quiet_hours_start || !quiet.quiet_hours_end) {
    return { ...base, postponed_by_quiet_hours: false }
  }
  const start = minutesOfDay(quiet.quiet_hours_start)
  const end = minutesOfDay(quiet.quiet_hours_end)
  const t = minutesOfDay(hhmm)
  const crossesMidnight = start >= end
  const inQuiet = crossesMidnight ? t >= start || t < end : t >= start && t < end
  if (!inQuiet) return { ...base, postponed_by_quiet_hours: false }

  // Postpone to the quiet end: the next day only in the evening leg of a
  // cross-midnight window; a same-day window (and the pre-dawn leg) ends on
  // this date.
  const targetDate = crossesMidnight && t >= start ? addDays(dateOn, 1) : dateOn
  const postponed = localWallTimeToInstant(targetDate, quiet.quiet_hours_end, timeZone)
  return { ...postponed, postponed_by_quiet_hours: true }
}

// ---------------------------------------------------------------------------
// Personal state machine (opportunity_reminder_states)
// ---------------------------------------------------------------------------

export const MAX_READ_STEPS = 16

export interface ReminderStateSnapshot {
  read_steps: string[]
  dismissed_at: string | null
  snooze_until: string | null
  revision: number
}

export type ReminderStateAction = 'read' | 'dismiss' | 'snooze' | 'restore'

export interface ReminderStateActionOptions {
  now: string
  /** read: which delivery step was opened. */
  step?: string
  /** snooze: UTC instant the event resurfaces at. */
  until_utc?: string
  /** snooze: the event's action deadline; snoozing past it is refused. */
  deadline_utc?: string
}

function requireUtc(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new OpportunityError('VALIDATION_FAILED', `${field} 必须是合法 UTC 时间`, { field })
  }
  return value
}

/**
 * Pure transition for one user's state on one event. Invalid transitions
 * (restoring a live event, snoozing into the past or past the deadline,
 * overflowing the 16-step read cap) throw instead of silently degrading.
 */
export function applyReminderStateAction(
  state: ReminderStateSnapshot,
  action: ReminderStateAction,
  opts: ReminderStateActionOptions,
): ReminderStateSnapshot {
  const next: ReminderStateSnapshot = {
    read_steps: [...state.read_steps],
    dismissed_at: state.dismissed_at,
    snooze_until: state.snooze_until,
    revision: state.revision + 1,
  }
  switch (action) {
    case 'read': {
      const step = opts.step
      if (typeof step !== 'string' || step.length === 0) {
        throw new OpportunityError('VALIDATION_FAILED', '缺少已读节点标识', { field: 'step' })
      }
      if (!state.read_steps.includes(step)) {
        if (state.read_steps.length >= MAX_READ_STEPS) {
          throw new OpportunityError('VALIDATION_FAILED', `已读节点已达上限 ${MAX_READ_STEPS}`, {
            field: 'read_steps',
          })
        }
        next.read_steps.push(step)
      }
      return next
    }
    case 'dismiss':
      next.dismissed_at = requireUtc(opts.now, 'now')
      return next
    case 'restore':
      if (state.dismissed_at === null) {
        throw new OpportunityError('INVALID_TRANSITION', '该提醒未处于忽略状态，无法恢复')
      }
      next.dismissed_at = null
      next.snooze_until = null
      return next
    case 'snooze': {
      const until = requireUtc(opts.until_utc, 'until_utc')
      requireUtc(opts.now, 'now')
      if (Date.parse(until) <= Date.parse(opts.now)) {
        throw new OpportunityError('INVALID_TRANSITION', '延后时间必须晚于当前时间')
      }
      if (opts.deadline_utc !== undefined) {
        requireUtc(opts.deadline_utc, 'deadline_utc')
        if (Date.parse(until) > Date.parse(opts.deadline_utc)) {
          throw new OpportunityError('INVALID_TRANSITION', '延后时间不能超过该提醒的截止时间')
        }
      }
      next.snooze_until = until
      return next
    }
  }
}

/** Parses a reminder_states row into a snapshot, validating the JSON shape. */
export function reminderStateFromRow(row: {
  read_steps_json: string
  dismissed_at: string | null
  snooze_until: string | null
  revision: number
}): ReminderStateSnapshot {
  const parsed: unknown = JSON.parse(row.read_steps_json)
  if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== 'string') || parsed.length > MAX_READ_STEPS) {
    throw new OpportunityError('VALIDATION_FAILED', '已读节点数据损坏', {
      field: 'read_steps_json',
    })
  }
  return {
    read_steps: parsed as string[],
    dismissed_at: row.dismissed_at,
    snooze_until: row.snooze_until,
    revision: row.revision,
  }
}

// ---------------------------------------------------------------------------
// Calendar events (§5/§10.1) — pure builders shared by the calendar query,
// the reminder list and the P2 cron scanner. P1 emits STATIC dates only
// (expiry/reset/claim windows); booking-service events arrive with P2
// fulfillments and are never fabricated here.
// ---------------------------------------------------------------------------

export type CalendarEventKind =
  | 'cycle_expiry'
  | 'cycle_reset'
  | 'claim_window_open'
  | 'claim_window_deadline'
  | 'task_deadline'
  | 'reward_window'
  | 'booking_service'

export interface OpportunityCalendarEvent {
  event_key: string
  kind: CalendarEventKind
  /** null for P2 task/booking events (they key on their own objects). */
  account_id: string | null
  cycle_id: string | null
  title: string
  /** Civil date the event falls on, in the rule's own timezone. */
  local_date_on: string
  time_zone: string
  /** Half-open deadline driving the event's business hash (null = reset-style). */
  deadline_before: string | null
  action_hint: string
  /** Unverified rule versions surface as review items, never as nudges. */
  needs_review: boolean
}

export interface CycleEventInputs {
  account_id: string
  cycle_id: string | null
  title: string
  time_zone: string
  usable_start_on: string
  usable_end_before: string | null
  /** Next period start (reset day); null for one_time allocations. */
  next_reset_on: string | null
  claim_window: { starts_at: string | null; ends_at: string | null } | null
  version_id: string
  verification: 'unverified' | 'user_confirmed' | 'official_verified'
}

/**
 * Builds the static P1 events for one cycle: expiry on the last usable day,
 * reset on the next period start, claim-window open/deadline. Every event
 * carries a stable event_key whose business hash tracks the deadline and rule
 * version only (§10.1) — notes and usage never respawn events.
 */
export async function buildCycleCalendarEvents(inputs: CycleEventInputs): Promise<OpportunityCalendarEvent[]> {
  const events: OpportunityCalendarEvent[] = []
  const needsReview = inputs.verification === 'unverified'

  if (inputs.usable_end_before !== null) {
    const lastUsableDay = addDays(inputs.usable_end_before, -1)
    const eventKey = await reminderEventKey({
      type: 'expiry',
      object_id: inputs.account_id,
      cycle_or_grant_key: inputs.cycle_id ?? 'nocycle',
      deadline_before: inputs.usable_end_before,
      version: inputs.version_id,
    })
    events.push({
      event_key: eventKey,
      kind: 'cycle_expiry',
      account_id: inputs.account_id,
      cycle_id: inputs.cycle_id,
      title: inputs.title,
      local_date_on: lastUsableDay,
      time_zone: inputs.time_zone,
      deadline_before: inputs.usable_end_before,
      action_hint: '本期权益将于次日失效',
      needs_review: needsReview,
    })

    if (inputs.next_reset_on !== null) {
      const resetKey = await reminderEventKey({
        type: 'reset',
        object_id: inputs.account_id,
        cycle_or_grant_key: inputs.cycle_id ?? 'nocycle',
        deadline_before: inputs.usable_end_before,
        version: inputs.version_id,
      })
      events.push({
        event_key: resetKey,
        kind: 'cycle_reset',
        account_id: inputs.account_id,
        cycle_id: inputs.cycle_id,
        title: inputs.title,
        local_date_on: inputs.next_reset_on,
        time_zone: inputs.time_zone,
        deadline_before: inputs.usable_end_before,
        action_hint: '新周期开始，额度重置',
        needs_review: needsReview,
      })
    }
  }

  const window = inputs.claim_window
  if (window !== null) {
    if (window.starts_at !== null && isValidCivilDate(window.starts_at.slice(0, 10))) {
      const openKey = await reminderEventKey({
        type: 'claim_open',
        object_id: inputs.account_id,
        cycle_or_grant_key: inputs.cycle_id ?? 'nocycle',
        deadline_before: window.ends_at?.slice(0, 10) ?? null,
        version: inputs.version_id,
      })
      events.push({
        event_key: openKey,
        kind: 'claim_window_open',
        account_id: inputs.account_id,
        cycle_id: inputs.cycle_id,
        title: inputs.title,
        local_date_on: window.starts_at.slice(0, 10),
        time_zone: inputs.time_zone,
        deadline_before: window.ends_at ? window.ends_at.slice(0, 10) : null,
        action_hint: '领取窗口开启',
        needs_review: needsReview,
      })
    }
    if (window.ends_at !== null && isValidCivilDate(window.ends_at.slice(0, 10))) {
      const deadlineKey = await reminderEventKey({
        type: 'claim_deadline',
        object_id: inputs.account_id,
        cycle_or_grant_key: inputs.cycle_id ?? 'nocycle',
        deadline_before: window.ends_at.slice(0, 10),
        version: inputs.version_id,
      })
      events.push({
        event_key: deadlineKey,
        kind: 'claim_window_deadline',
        account_id: inputs.account_id,
        cycle_id: inputs.cycle_id,
        title: inputs.title,
        local_date_on: window.ends_at.slice(0, 10),
        time_zone: inputs.time_zone,
        deadline_before: window.ends_at.slice(0, 10),
        action_hint: '领取窗口截止',
        needs_review: needsReview,
      })
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// P2 events: task deadlines, reward windows and booking service times
// (plan Task 22). Dates come from committed rows only — missing data yields
// 待补充 flags instead of guessed events.
// ---------------------------------------------------------------------------

export type TaskCalendarEvent = OpportunityCalendarEvent & {
  kind: 'task_deadline' | 'reward_window'
  task_cycle_id: string
}

export type BookingCalendarEvent = OpportunityCalendarEvent & {
  kind: 'booking_service'
  fulfillment_id: string
}

/** Task deadline + expected reward window events (window only when satisfied). */
export async function buildTaskCalendarEvents(params: {
  task_cycle_id: string
  title: string
  deadline_at: string
  expected_from_on: string | null
  expected_until_before: string | null
  satisfied: boolean
  version: string
}): Promise<TaskCalendarEvent[]> {
  const events: TaskCalendarEvent[] = []
  const deadlineDate = params.deadline_at.slice(0, 10)
  if (deadlineDate) {
    events.push({
      event_key: await reminderEventKey({
        type: 'task_deadline',
        object_id: params.task_cycle_id,
        cycle_or_grant_key: params.task_cycle_id,
        deadline_before: deadlineDate,
        version: params.version,
      }),
      kind: 'task_deadline',
      account_id: null,
      cycle_id: null,
      task_cycle_id: params.task_cycle_id,
      title: params.title,
      local_date_on: deadlineDate,
      time_zone: 'Asia/Shanghai',
      deadline_before: deadlineDate,
      action_hint: '任务统计截止',
      needs_review: false,
    })
  }
  // Reward window events only after manual satisfaction — a not-yet-reached
  // task has no delivery to expect, so no guessed window event.
  if (params.satisfied && params.expected_from_on) {
    events.push({
      event_key: await reminderEventKey({
        type: 'reward_window',
        object_id: params.task_cycle_id,
        cycle_or_grant_key: params.task_cycle_id,
        deadline_before: params.expected_until_before ?? null,
        version: params.version,
      }),
      kind: 'reward_window',
      account_id: null,
      cycle_id: null,
      task_cycle_id: params.task_cycle_id,
      title: params.title,
      local_date_on: params.expected_from_on,
      time_zone: 'Asia/Shanghai',
      deadline_before: params.expected_until_before ?? null,
      action_hint: '奖励预计发放窗口（实际到账需手动记录）',
      needs_review: false,
    })
  }
  return events
}

/** Booking service-time events; only confirmed bookings generate reminders. */
export async function buildBookingCalendarEvents(params: {
  fulfillment_id: string
  title: string
  service_at: string
  service_time_zone: string
}): Promise<BookingCalendarEvent[]> {
  const serviceDate = params.service_at.slice(0, 10)
  if (!serviceDate) return []
  return [
    {
      event_key: await reminderEventKey({
        type: 'booking_service',
        object_id: params.fulfillment_id,
        cycle_or_grant_key: params.fulfillment_id,
        deadline_before: serviceDate,
        version: params.service_at,
      }),
      kind: 'booking_service',
      account_id: null,
      cycle_id: null,
      fulfillment_id: params.fulfillment_id,
      title: params.title,
      local_date_on: serviceDate,
      time_zone: params.service_time_zone,
      deadline_before: serviceDate,
      action_hint: '预约服务时间（完成或取消后在此记录结算）',
      needs_review: false,
    },
  ]
}
