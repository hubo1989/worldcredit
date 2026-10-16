// lib/opportunities/view-model.ts — pure presentation logic for the P1 UI
// (plan Task 12). Balance units, status/action labels and deadline copy are
// derived here so rows, ledger and detail never format independently; amounts
// stay integer minor units until the last formatting step.

import type { OpportunityAvailabilityStatus, AvailabilityAction } from './availability'
import type { OpportunityDto, LedgerRow } from './queries.server'

/** Renders one integer minor-unit amount with its currency. */
export function formatMinorAmount(minor: number, currency: string | null): string {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' || currency === null ? '¥' : `${currency} `
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}${symbol}${whole}.${cents}`
}

export interface BalanceText {
  main: string
  /** Secondary line, e.g. the limit denominator; empty when none. */
  sub: string
}

/** Balance copy per spec §5: counts, amounts, unlimited, unknown. */
export function formatBalance(dto: Pick<OpportunityDto,
  'count_limit' | 'amount_limit_minor' | 'currency' | 'remaining_count' | 'remaining_minor' | 'cycle_id' | 'status'
>): BalanceText {
  if (dto.cycle_id === null) {
    return { main: dto.status === 'needs_confirmation' ? '待确认' : '—', sub: '' }
  }
  if (dto.count_limit !== null) {
    return { main: `剩余 ${dto.remaining_count ?? 0} 次`, sub: `共 ${dto.count_limit} 次` }
  }
  if (dto.amount_limit_minor !== null) {
    return {
      main: `剩余 ${formatMinorAmount(dto.remaining_minor ?? 0, dto.currency)}`,
      sub: `共 ${formatMinorAmount(dto.amount_limit_minor, dto.currency)}`,
    }
  }
  return { main: '不限次数', sub: '' }
}

export const STATUS_LABELS: Record<OpportunityAvailabilityStatus, string> = {
  available_today: '今天可用',
  expiring_soon: '即将到期',
  claimable: '待领取',
  exhausted: '已用尽',
  needs_confirmation: '需确认',
  not_started: '未开始',
  expired: '已失效',
}

export const ACTION_LABELS: Record<AvailabilityAction, string> = {
  record_usage: '记录使用',
  record_booking: '记录预约',
  record_claim: '记录已领取',
  view_entry: '查看参与方式',
  fix_data: '去核对',
  none: '查看',
}

/** Deadline copy; days_left ≤ 0 means “today is the last day”. */
export function deadlineText(daysLeft: number | null, deadlineOn: string | null): string {
  if (deadlineOn === null) return '无固定截止'
  if (daysLeft === null) return `截止 ${deadlineOn}`
  if (daysLeft <= 0) return '今天截止'
  if (daysLeft === 1) return '明天截止'
  return `${daysLeft} 天后截止（${deadlineOn}）`
}

/** Shared-account copy: one line regardless of how many cards link it. */
export function sharedScopeText(scopeKind: 'card' | 'holder', cardCount: number): string {
  if (scopeKind === 'card' || cardCount <= 1) return ''
  return `${cardCount} 张卡共享额度`
}

export interface OpportunityRowVm {
  accountId: string
  title: string
  metaLine: string
  balance: BalanceText
  statusLabel: string
  actionLabel: string
  reason: string
  deadline: string
  sharedText: string
  reviewHint: string | null
  usableToday: boolean
  followed: boolean
}

/** One row's complete view model (used by list, ledger and detail). */
export function toRowVm(dto: OpportunityDto | LedgerRow): OpportunityRowVm {
  const kindLabel = dto.kind === 'benefit' ? '权益' : dto.kind === 'promo' ? '优惠' : '私人奖励'
  const metaParts = [kindLabel, dto.holder_name]
  if (dto.deadline_on !== null) metaParts.push(deadlineText(dto.days_left, dto.deadline_on))
  return {
    accountId: dto.account_id,
    title: dto.title,
    metaLine: metaParts.join(' · '),
    balance: formatBalance(dto),
    statusLabel: STATUS_LABELS[dto.status],
    actionLabel: ACTION_LABELS[dto.action],
    reason: dto.reason,
    deadline: deadlineText(dto.days_left, dto.deadline_on),
    sharedText: sharedScopeText(dto.scope_kind, dto.card_ids.length),
    reviewHint: 'review_hint' in dto ? (dto.review_hint as string | null) : null,
    usableToday: dto.usable_today,
    followed: dto.followed,
  }
}

/** Serializes page filters into URL query params (§6.2 fixed names). */
export function filtersToQuery(
  filters: Partial<Record<'holder' | 'card' | 'bank' | 'category' | 'kind' | 'status' | 'q', string | null>>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value)
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Parses URL query params back into snake_case filter DTO fields. */
export function queryToFilters(searchParams: URLSearchParams): {
  holder_id: string | null
  card_id: string | null
  bank_id: string | null
  category: string | null
  kind: string | null
  status: string | null
  q: string | null
} {
  const get = (k: string) => {
    const v = searchParams.get(k)
    return v && v.length > 0 ? v.slice(0, 64) : null
  }
  return {
    holder_id: get('holder'),
    card_id: get('card'),
    bank_id: get('bank'),
    category: get('category'),
    kind: get('kind'),
    status: get('status'),
    q: get('q'),
  }
}
