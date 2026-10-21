// lib/opportunities/dates.ts — civil-date validation, IANA timezone handling
// and nominal cycle windows (tech spec §4.2). Pure functions: every date is a
// civil date string (YYYY-MM-DD), every `now` is injected by the caller, and
// month arithmetic is always recomputed from the source anchor (no chained
// setMonth, so 2024-02-29 clamps to 2025-02-28 and back to 2028-02-29).

import type { CycleAnchor, CycleWindow, RuleSnapshotV1 } from './types'

const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function isValidCivilDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = CIVIL_DATE_RE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

function parseCivilDate(value: string): { year: number; month: number; day: number } {
  const m = CIVIL_DATE_RE.exec(value)
  if (!m) throw new Error(`非法 civil date: ${value}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** The wall-clock date of `now` inside `timeZone`. Never the host timezone. */
export function localDateInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type)
    if (!part) throw new Error(`Intl formatToParts 缺少 ${type}`)
    return part.value
  }
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isValidRfc3339Utc(value: unknown): value is string {
  if (typeof value !== 'string' || !RFC3339_UTC_RE.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseCivilDate(date)
  const utc = Date.UTC(year, month - 1, day) + days * 86_400_000
  const next = new Date(utc)
  return toIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

/**
 * `date` shifted by whole months, with the day clamped to the target month's
 * length. Always recomputed from `date` itself — callers pass the source
 * anchor so a 29 Feb anniversary collapses and later restores, never drifts.
 */
export function addMonthsClamped(date: string, months: number): string {
  const { year, month, day } = parseCivilDate(date)
  const totalMonths = (month - 1) + months
  const targetYear = year + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1
  return toIso(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

/** ISO weekday 1=Mon … 7=Sun of a civil date. */
function isoWeekday(date: string): number {
  const { year, month, day } = parseCivilDate(date)
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=Sun
  return ((jsDay + 6) % 7) + 1
}

interface Period {
  start: string
  end: string | null
}

/** The clamped month/day anchor of `year` (anchorMonth 1..12, anchorDay 1..31). */
function clampedAnchorInYear(year: number, anchorMonth: number, anchorDay: number): string {
  return toIso(year, anchorMonth, Math.min(anchorDay, daysInMonth(year, anchorMonth)))
}

function resolveAnniversaryAnchor(rules: RuleSnapshotV1, anchor: CycleAnchor): string {
  const source = rules.cycle.anchor_source
  const value = source === 'activated_on' ? anchor.activated_on : anchor.issued_on
  if (!isValidCivilDate(value)) {
    throw new Error(
      `anniversary 周期缺少合法核卡锚点（anchor_source=${String(source)}），请先补录发卡/激活日期`,
    )
  }
  return value
}

function computePeriod(rules: RuleSnapshotV1, localDate: string, anchor: CycleAnchor): Period {
  switch (rules.cycle.kind) {
    case 'daily':
      return { start: localDate, end: addDays(localDate, 1) }
    case 'weekly': {
      const start = addDays(localDate, -(isoWeekday(localDate) - 1))
      return { start, end: addDays(start, 7) }
    }
    case 'monthly': {
      const anchorDay = rules.cycle.anchor_day ?? 1
      const { year, month } = parseCivilDate(localDate)
      const thisMonth = clampedAnchorInYear(year, month, anchorDay)
      const start =
        localDate >= thisMonth ? thisMonth : clampedAnchorInYear(year, month - 1, anchorDay)
      const { year: startYear, month: startMonth } = parseCivilDate(start)
      return { start, end: clampedAnchorInYear(startYear, startMonth + 1, anchorDay) }
    }
    case 'annual': {
      const anchorMonth = rules.cycle.anchor_month ?? 1
      const anchorDay = rules.cycle.anchor_day ?? 1
      return annualPeriod(localDate, anchorMonth, anchorDay)
    }
    case 'anniversary': {
      const { month, day } = parseCivilDate(resolveAnniversaryAnchor(rules, anchor))
      return annualPeriod(localDate, month, day)
    }
    case 'one_time': {
      if (!isValidCivilDate(rules.valid_from)) {
        throw new Error('one_time 规则缺少合法生效日（valid_from），请人工确认后补充')
      }
      return { start: rules.valid_from, end: rules.valid_until_before ?? null }
    }
  }
}

/** Latest clamped m/d anchor not after localDate; ends at next year's anchor. */
function annualPeriod(localDate: string, anchorMonth: number, anchorDay: number): Period {
  const year = parseCivilDate(localDate).year
  const thisYear = clampedAnchorInYear(year, anchorMonth, anchorDay)
  const start = localDate >= thisYear ? thisYear : clampedAnchorInYear(year - 1, anchorMonth, anchorDay)
  const startYear = parseCivilDate(start).year
  return { start, end: clampedAnchorInYear(startYear + 1, anchorMonth, anchorDay) }
}

/**
 * The nominal civil-date window of the cycle containing `localDate`.
 * Half-open: [period_start_on, period_end_before). `usable_*` mirror the
 * nominal period here; first-cycle trimming (version, eligibility, rule
 * validity) belongs to the account service, not to date math.
 */
export function getCycleWindow(
  rules: RuleSnapshotV1,
  localDate: string,
  anchor: CycleAnchor,
): CycleWindow {
  if (!isValidIanaTimeZone(rules.time_zone)) {
    throw new Error(`规则时区不合法: ${String(rules.time_zone)}`)
  }
  if (!isValidCivilDate(localDate)) {
    throw new Error(`localDate 不是合法 civil date: ${String(localDate)}`)
  }
  const { start, end } = computePeriod(rules, localDate, anchor)
  return {
    cycle_key: `regular:${start}`,
    period_start_on: start,
    period_end_before: end,
    usable_start_on: start,
    usable_end_before: end,
    // A one_time allocation never resets; every recurring kind does at `end`.
    next_reset_on: rules.cycle.kind === 'one_time' ? null : end,
    time_zone: rules.time_zone,
  }
}
