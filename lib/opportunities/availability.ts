// lib/opportunities/availability.ts — the pure availability state machine
// (product spec §6, tech spec §4). One function decides, for one account on
// one civil date, the single filter status, the primary action and the
// human-readable reason. Pages, card details and the dashboard count all call
// THIS — no page re-derives availability from titles or product names.

import type { RuleSnapshotV1 } from './types'
import { isValidCivilDate } from './dates'
import { OpportunityError } from './errors'

/** Filter statuses from product spec §6.2 — one per account per date. */
export type OpportunityAvailabilityStatus =
  | 'available_today' // 今天可用
  | 'expiring_soon' // 即将到期（7 天内结束、仍有余额）
  | 'claimable' // 待领取
  | 'exhausted' // 已用尽（含预约占用）
  | 'needs_confirmation' // 需确认
  | 'not_started' // 未开始
  | 'expired' // 已失效／已归档／资格不适用

export type AvailabilityAction =
  | 'record_usage'
  | 'record_booking'
  | 'record_claim'
  | 'view_entry'
  | 'fix_data'
  | 'none'

export interface AvailabilityCycleState {
  activation_state: 'active' | 'pending_claim' | 'voided'
  usable_start_on: string
  usable_end_before: string | null
  count_limit: number | null
  amount_limit_minor: number | null
  opening_used_count: number
  used_count: number
  reserved_count: number
  opening_used_minor: number
  used_minor: number
  reserved_minor: number
}

export interface AvailabilityInput {
  today_on: string
  /** ISO weekday of today_on: 1=Mon … 7=Sun. */
  weekday: number
  rules: RuleSnapshotV1
  definition_status: 'active' | 'archived'
  terminated_at: string | null
  account_status: 'active' | 'archived'
  eligibility: 'unknown' | 'confirmed' | 'ineligible'
  eligible_from_on: string | null
  has_active_linked_card: boolean
  /** The cycle covering today, when one exists. */
  cycle: AvailabilityCycleState | null
  /** Whether the account's opening balance was verified (review badge only). */
  balance_verified: boolean
}

export interface Availability {
  status: OpportunityAvailabilityStatus
  action: AvailabilityAction
  usable_today: boolean
  /** Human reason, safe for end users; never SQL or internal ids. */
  reason: string
  /** Days until the usable window ends (null = no deadline). */
  days_left: number | null
  /** Opening balance was never verified — show a review hint, not a blocker. */
  needs_review: boolean
  /** Remaining quota on the current cycle, per dimension (null = unlimited). */
  remaining_count: number | null
  remaining_minor: number | null
}

/** ISO weekday (1=Mon…7=Sun) of a civil date; shared with queries. */
export function isoWeekdayOf(dateOn: string): number {
  const [y, m, d] = dateOn.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  return ((jsDay + 6) % 7) + 1
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

const EXPIRING_WINDOW_DAYS = 7

/**
 * Statuses at their spec §6.2 default-order rank: today-deadline actionable →
 * 3d → 7d → available → claimable → needs confirmation; hidden ones follow.
 */
export const AVAILABILITY_SORT_RANK: Record<OpportunityAvailabilityStatus, number> = {
  expiring_soon: 0,
  available_today: 1,
  claimable: 2,
  needs_confirmation: 3,
  exhausted: 4,
  not_started: 5,
  expired: 6,
}

/**
 * Computes the availability of one account on `today_on`. The evaluation
 * order mirrors spec §6.2/§6.3: terminal states first (archived/terminated/
 * window over), then not-yet-started, then data gaps that must be confirmed,
 * then claim gating, weekday and quota. Every branch returns an explicit
 * reason — there is no silent default.
 */
export function computeAvailability(input: AvailabilityInput): Availability {
  const { rules } = input
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    throw new OpportunityError('VALIDATION_FAILED', 'weekday 必须是 1–7', { field: 'weekday' })
  }
  if (!isValidCivilDate(input.today_on)) {
    throw new OpportunityError('VALIDATION_FAILED', 'today_on 不是合法日期', { field: 'today_on' })
  }
  const base = {
    usable_today: false,
    needs_review: !input.balance_verified,
    remaining_count: null as number | null,
    remaining_minor: null as number | null,
  }

  const daysLeft = (endBefore: string | null): number | null =>
    endBefore === null ? null : daysBetween(input.today_on, endBefore)

  // --- Terminal states -----------------------------------------------------
  if (input.definition_status === 'archived') {
    return { ...base, status: 'expired', action: 'view_entry', reason: '该权益定义已归档', days_left: null }
  }
  if (input.terminated_at !== null) {
    return { ...base, status: 'expired', action: 'view_entry', reason: '该规则已提前终止', days_left: null }
  }
  if (input.account_status === 'archived') {
    return { ...base, status: 'expired', action: 'view_entry', reason: '该账户已归档，历史仍可查看', days_left: null }
  }
  if (input.eligibility === 'ineligible') {
    return { ...base, status: 'expired', action: 'fix_data', reason: '资格已确认不适用', days_left: null }
  }
  if (rules.valid_until_before !== null && input.today_on >= rules.valid_until_before) {
    return {
      ...base,
      status: 'expired',
      action: 'view_entry',
      reason: '使用期已结束',
      days_left: 0,
    }
  }
  if (rules.valid_from !== null && input.today_on < rules.valid_from) {
    return {
      ...base,
      status: 'not_started',
      action: 'view_entry',
      reason: '使用期尚未开始',
      days_left: daysLeft(rules.valid_from) === null ? null : Math.max(daysLeft(rules.valid_from)!, 0),
    }
  }
  if (!rules.open_ended && rules.valid_until_before === null) {
    // 日期无截止且非 open_ended：数据不完整，禁止默认当作长期有效
    return { ...base, status: 'needs_confirmation', action: 'fix_data', reason: '规则缺少截止日期，需先确认有效期', days_left: null }
  }

  // --- Data gaps that must be confirmed ------------------------------------
  if (rules.requires_personal_confirmation && input.eligibility === 'unknown') {
    return {
      ...base,
      status: 'needs_confirmation',
      action: 'fix_data',
      reason: '该权益需要先确认个人资格',
      days_left: daysLeft(rules.valid_until_before),
    }
  }
  if (input.eligible_from_on !== null && input.today_on < input.eligible_from_on) {
    return {
      ...base,
      status: 'not_started',
      action: 'view_entry',
      reason: '个人资格自该日起生效',
      days_left: daysLeft(input.eligible_from_on),
    }
  }
  if (!input.has_active_linked_card) {
    return {
      ...base,
      status: 'needs_confirmation',
      action: 'fix_data',
      reason: '没有可用的关联信用卡（冻结、注销或贷款卡不算）',
      days_left: daysLeft(rules.valid_until_before),
    }
  }

  // --- Weekday ---------------------------------------------------------------
  const weekdayOk = rules.weekdays === null || rules.weekdays.includes(input.weekday)

  // --- Cycle / claim gating --------------------------------------------------
  if (rules.allocation === 'grant_only') {
    // Quota arrives only through recorded grants; without one there is nothing
    // to use today, but the account stays visible for the reward flow.
    if (input.cycle && input.cycle.activation_state === 'active') {
      return finishWithBalance(input, base, weekdayOk, 'grant')
    }
    return {
      ...base,
      status: 'exhausted',
      action: 'view_entry',
      reason: '奖励配额尚未到账',
      days_left: daysLeft(rules.valid_until_before),
    }
  }

  if (input.cycle === null) {
    return {
      ...base,
      status: 'needs_confirmation',
      action: 'fix_data',
      reason: '未找到覆盖今天的周期，请核对周期规则',
      days_left: daysLeft(rules.valid_until_before),
    }
  }
  const cycle = input.cycle
  if (cycle.activation_state === 'voided') {
    return { ...base, status: 'expired', action: 'view_entry', reason: '当前周期已作废', days_left: daysLeft(cycle.usable_end_before) }
  }
  if (input.today_on < cycle.usable_start_on) {
    return {
      ...base,
      status: 'not_started',
      action: 'view_entry',
      reason: '本期自 ' + cycle.usable_start_on + ' 起可用',
      days_left: daysLeft(cycle.usable_start_on),
    }
  }
  if (cycle.usable_end_before !== null && input.today_on >= cycle.usable_end_before) {
    return { ...base, status: 'expired', action: 'view_entry', reason: '本期已结束', days_left: 0 }
  }

  if (cycle.activation_state === 'pending_claim') {
    const window = rules.claim_window
    if (window === null) {
      return {
        ...base,
        status: 'claimable',
        action: 'record_claim',
        reason: '本期尚未领取',
        days_left: daysLeft(cycle.usable_end_before),
      }
    }
    if (window.starts_at !== null && input.today_on < window.starts_at.slice(0, 10)) {
      return { ...base, status: 'not_started', action: 'view_entry', reason: '领取窗口尚未开启', days_left: daysLeft(window.starts_at.slice(0, 10)) }
    }
    if (window.ends_at !== null && input.today_on > window.ends_at.slice(0, 10)) {
      return {
        ...base,
        status: 'needs_confirmation',
        action: 'fix_data',
        reason: '领取窗口已关闭且本期未领取，请核对规则',
        days_left: daysLeft(cycle.usable_end_before),
      }
    }
    return {
      ...base,
      status: 'claimable',
      action: 'record_claim',
      reason: '领取窗口已开启，尚未记录领取',
      days_left: daysLeft(cycle.usable_end_before),
    }
  }

  return finishWithBalance(input, base, weekdayOk, rules.allocation === 'claim_gated' ? 'claimed' : 'regular')
}

function finishWithBalance(
  input: AvailabilityInput,
  base: Omit<Availability, 'status' | 'action' | 'reason' | 'days_left'>,
  weekdayOk: boolean,
  mode: 'regular' | 'claimed' | 'grant',
): Availability {
  const cycle = input.cycle!
  const endBefore = cycle.usable_end_before ?? input.rules.valid_until_before ?? null
  const daysLeft = endBefore === null ? null : daysBetween(input.today_on, endBefore)

  const remainingCount =
    cycle.count_limit === null
      ? null
      : Math.max(cycle.count_limit - cycle.opening_used_count - cycle.used_count - cycle.reserved_count, 0)
  const remainingMinor =
    cycle.amount_limit_minor === null
      ? null
      : Math.max(cycle.amount_limit_minor - cycle.opening_used_minor - cycle.used_minor - cycle.reserved_minor, 0)
  const out: Availability = {
    ...base,
    remaining_count: remainingCount,
    remaining_minor: remainingMinor,
    status: 'available_today',
    action: 'record_usage',
    reason: weekdayOk ? '今天可用' : '今天不在有效星期内',
    usable_today: weekdayOk,
    days_left: daysLeft,
  }

  const exhausted =
    (remainingCount !== null && remainingCount <= 0) ||
    (remainingMinor !== null && remainingMinor <= 0)
  if (exhausted) {
    const reservedOnly =
      (remainingCount !== null && remainingCount <= 0 && cycle.reserved_count > 0) ||
      (remainingMinor !== null && remainingMinor <= 0 && cycle.reserved_minor > 0)
    out.status = 'exhausted'
    out.action = 'view_entry'
    out.reason = reservedOnly ? '本期额度已被预约占用' : '本期额度已用完'
    out.usable_today = false
    return out
  }

  // Weekday-invalid days are not "available today" but keep the expiring flag
  // so the list still surfaces the deadline.
  if (!weekdayOk) {
    out.status = daysLeft !== null && daysLeft <= EXPIRING_WINDOW_DAYS ? 'expiring_soon' : out.status
    return out
  }

  // Claim-gated cycles whose window closed after claiming stay usable.
  void mode
  if (daysLeft !== null && daysLeft <= EXPIRING_WINDOW_DAYS) {
    out.status = 'expiring_soon'
    out.reason = daysLeft <= 0 ? '今天截止' : `${daysLeft} 天内结束`
  }
  return out
}
