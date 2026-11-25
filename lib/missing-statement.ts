// lib/missing-statement.ts — pure computation module for "missing statement" (超期未获得账单) detection.
// No database or Node-only imports; safe for both Cloudflare Workers and browser bundles.

import type { CardProduct, CreditAccount, CreditCard } from './types'
import { getLocalTodayString } from './utils'

export const DEFAULT_MISSING_STATEMENT_GRACE_DAYS = 3
export const MIN_MISSING_STATEMENT_GRACE_DAYS = 0
export const MAX_MISSING_STATEMENT_GRACE_DAYS = 15

export interface MissingStatementCardInput {
  card: Pick<
    CreditCard,
    | 'id'
    | 'holder_id'
    | 'account_id'
    | 'card_number_last4'
    | 'billing_day'
    | 'override_billing_day'
    | 'override_due_type'
    | 'override_due_value'
    | 'name_override'
    | 'status'
    | 'card_type'
    | 'created_at'
  > & {
    card_product?: Pick<
      CardProduct,
      'bank_name' | 'card_name' | 'currency' | 'payment_due_type' | 'payment_due_value'
    > | null
  }
  account?: Pick<
    CreditAccount,
    | 'id'
    | 'holder_id'
    | 'bank_name'
    | 'currency'
    | 'statement_mode'
    | 'billing_day'
    | 'due_type'
    | 'due_value'
    | 'primary_card_id'
    | 'status'
  > | null
}

export interface MissingStatementBillRef {
  id?: string
  card_id: string
  account_id?: string | null
  bill_month: string | null | undefined
}

export interface MissingStatementDraftRef {
  id: string
  card_id: string | null
  matched_account_id?: string | null
  bill_month?: string | null
  parse_status?: 'parsing' | 'needs_password' | 'parse_failed' | 'ready' | null
}

export interface MissingStatementSummary {
  /** Unique business key: `account:${accountId}` for merged accounts, `card:${anchorCardId}` otherwise. */
  targetKey: string
  /** Anchor active credit card ID for display and supplement modal prefill. */
  anchorCardId: string
  accountId: string | null
  holderId: string
  isMerged: boolean
  /** Missing bill month in `YYYY-MM`. */
  missingBillMonth: string
  /** Expected statement date in `YYYY-MM-DD` (clamped for 29-31 end-of-month). */
  expectedStatementDate: string
  /** Suggested due date in `YYYY-MM-DD` derived from card/product due rules. */
  suggestedDueDate: string
  /** Calendar days past `expectedStatementDate` (always > graceDays). */
  daysPast: number
  /** Effective grace days applied (0..15). */
  graceDays: number
  /** Normalized display subject (single card or merged account summary). */
  subject: string
  currency: string
  /** Matching pending draft in inbox (does not clear missing status). */
  pendingDraftId: string | null
  pendingDraftStatus: 'parsing' | 'needs_password' | 'parse_failed' | 'ready' | null
}

export interface DetectMissingStatementsOptions {
  cards: MissingStatementCardInput[]
  /** Unfiltered historical bill month references (including paid and zero bills). */
  bills: MissingStatementBillRef[]
  drafts?: MissingStatementDraftRef[]
  /** Civil today (`YYYY-MM-DD` or Date); defaults to `getLocalTodayString(timeZone)`. */
  today?: string | Date
  /** Defaults to `'Asia/Shanghai'`. */
  timeZone?: string
  /** User-configured grace days; normalized to integer in [0, 15], defaulting to 3. */
  graceDays?: unknown
}

export interface DetectMissingStatementsResult {
  /** Deduplicated missing statements sorted by `daysPast DESC, anchorCardId ASC`. */
  items: MissingStatementSummary[]
  /** Indexed by carrier `anchorCardId` for O(1) attachment on CardWithBillsSummary. */
  byCarrierCardId: Map<string, MissingStatementSummary>
  /** Non-carrier member card IDs under merged accounts (must suppress missing warnings). */
  suppressedCardIds: Set<string>
  /** Resolved active carrier card ID for each active merged account. */
  carrierCardIdByAccountId: Map<string, string>
}

/** Normalize user-configured grace days; preserves explicit 0, rejects out-of-range/non-integers. */
export function normalizeMissingStatementGraceDays(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= MIN_MISSING_STATEMENT_GRACE_DAYS &&
    raw <= MAX_MISSING_STATEMENT_GRACE_DAYS
  ) {
    return raw
  }
  return DEFAULT_MISSING_STATEMENT_GRACE_DAYS
}

/** Normalize `bill_month` strings like `2026-10` or `202610` into `YYYY-MM`; returns null if invalid. */
export function normalizeBillMonth(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const hyphenMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed)
  if (hyphenMatch) return `${hyphenMatch[1]}-${hyphenMatch[2]}`
  const compact = trimmed.replace(/[^0-9]/g, '')
  if (compact.length === 6) {
    const year = compact.slice(0, 4)
    const month = Number(compact.slice(4, 6))
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  }
  return null
}

function clampBillingDay(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.min(Math.max(Math.trunc(raw), 1), 31)
}

function daysInCivilMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
}

function formatCivilYmd(year: number, month1Based: number, day: number): string {
  return `${year}-${String(month1Based).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Shift a `YYYY-MM` year-month string by `delta` months across year boundaries. */
export function addYearMonth(yearMonth: string, delta: number): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth)
  if (!m) return yearMonth
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const nextYear = Math.floor(total / 12)
  const nextMonth = (((total % 12) + 12) % 12) + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

/** Compute the actual `YYYY-MM-DD` statement date in `yearMonth`, clamping 29-31 to month end. */
export function actualStatementDateInMonth(billingDay: number, yearMonth: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth)
  if (!m) return `${yearMonth}-01`
  const year = Number(m[1])
  const month = Number(m[2])
  const clamped = clampBillingDay(billingDay)
  const actualDay = Math.min(clamped, daysInCivilMonth(year, month))
  return formatCivilYmd(year, month, actualDay)
}

/** Convert D1/ISO timestamp or `YYYY-MM-DD` string into a civil day in `timeZone`. */
export function toCivilDay(
  value: string | null | undefined,
  timeZone: string = 'Asia/Shanghai',
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return null
  return getLocalTodayString(timeZone, parsed)
}

/** Civil day difference `laterYmd - earlierYmd` independent of host local timezone. */
export function diffCivilDays(laterYmd: string, earlierYmd: string): number {
  const l = /^(\d{4})-(\d{2})-(\d{2})$/.exec(laterYmd)
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(earlierYmd)
  if (!l || !e) return 0
  const lMs = Date.UTC(Number(l[1]), Number(l[2]) - 1, Number(l[3]))
  const eMs = Date.UTC(Number(e[1]), Number(e[2]) - 1, Number(e[3]))
  return Math.round((lMs - eMs) / 86_400_000)
}

function addCivilDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return formatCivilYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Compute suggested due date in `YYYY-MM-DD` using card override -> product -> account rule. */
export function computeSuggestedDueDate(
  card: MissingStatementCardInput['card'],
  account: MissingStatementCardInput['account'],
  billMonth: string,
): string {
  const effectiveBillingDay = clampBillingDay(
    card.override_billing_day ?? card.billing_day ?? account?.billing_day ?? 1,
  )
  const product = card.card_product
  let dueType: 'fixed' | 'after_billing' | 'fixed_before_billing' = 'after_billing'
  let dueValue = 20

  if (card.override_due_type != null && card.override_due_value != null) {
    dueType = card.override_due_type
    dueValue = card.override_due_value
  } else if (product?.payment_due_type != null && product?.payment_due_value != null) {
    dueType = product.payment_due_type
    dueValue = product.payment_due_value
  } else if (account?.due_type != null && account?.due_value != null) {
    dueType = account.due_type
    dueValue = account.due_value
  }

  if (dueType === 'fixed') {
    const nextMonth = addYearMonth(billMonth, 1)
    return actualStatementDateInMonth(Math.max(1, Math.trunc(dueValue)), nextMonth)
  }
  if (dueType === 'fixed_before_billing') {
    return actualStatementDateInMonth(Math.max(1, Math.trunc(dueValue)), billMonth)
  }
  const stmtDate = actualStatementDateInMonth(effectiveBillingDay, billMonth)
  return addCivilDays(stmtDate, Math.max(0, Math.trunc(dueValue)))
}

function formatCardTailLast4(tail: string | null | undefined): string {
  const digits = String(tail ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits
}

function formatSingleCardSubject(card: MissingStatementCardInput['card']): string {
  const bankName = card.card_product?.bank_name || ''
  const cardName = card.name_override || card.card_product?.card_name || '信用卡'
  const last4 = formatCardTailLast4(card.card_number_last4)
  const tail = last4 ? ` 尾号${last4}` : ''
  return `${bankName} ${cardName}${tail}`.trim() || '信用卡'
}

function formatMergedAccountSubject(
  account: NonNullable<MissingStatementCardInput['account']>,
  activeMembers: MissingStatementCardInput[],
  carrier: MissingStatementCardInput,
): string {
  if (activeMembers.length < 2) {
    return formatSingleCardSubject(carrier.card)
  }
  const bankName = account.bank_name || carrier.card.card_product?.bank_name || ''
  const tails = activeMembers
    .map((m) => formatCardTailLast4(m.card.card_number_last4))
    .filter(Boolean)
  if (tails.length === 0) {
    return `${bankName} 合并账单（共 ${activeMembers.length} 张卡）`.trim()
  }
  if (activeMembers.length === 2 && tails.length === 2) {
    return `${bankName} 合并账单（含尾号 ${tails[0]} · ${tails[1]}）`.trim()
  }
  const preview = tails.slice(0, 2).join(' · ')
  return `${bankName} 合并账单（含尾号 ${preview} 等 ${activeMembers.length} 张卡）`.trim()
}

function isEligibleCreditCard(card: MissingStatementCardInput['card']): boolean {
  return card.status === 'active' && (card.card_type ?? 'credit') === 'credit'
}

function resolveTodayString(today: string | Date | undefined, timeZone: string): string {
  if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today.trim())) {
    return today.trim()
  }
  if (today instanceof Date && !Number.isNaN(today.getTime())) {
    return getLocalTodayString(timeZone, today)
  }
  return getLocalTodayString(timeZone)
}

function findMatchingDraft(
  drafts: MissingStatementDraftRef[] | undefined,
  unit: {
    isMerged: boolean
    accountId: string | null
    anchorCardId: string
    memberCardIds: Set<string>
    missingBillMonth: string
  },
): MissingStatementDraftRef | null {
  if (!drafts || drafts.length === 0) return null
  const matchingCardDrafts = drafts.filter((d) => {
    if (unit.isMerged && unit.accountId) {
      if (d.matched_account_id === unit.accountId) return true
      if (d.card_id && unit.memberCardIds.has(d.card_id)) return true
      return false
    }
    return d.card_id === unit.anchorCardId
  })
  if (matchingCardDrafts.length === 0) return null

  const exactMonth = matchingCardDrafts.find(
    (d) => normalizeBillMonth(d.bill_month) === unit.missingBillMonth,
  )
  if (exactMonth) return exactMonth

  const unparsedFallback = matchingCardDrafts.find(
    (d) =>
      !normalizeBillMonth(d.bill_month) &&
      (d.parse_status === 'needs_password' || d.parse_status === 'parse_failed'),
  )
  return unparsedFallback ?? null
}

/**
 * Pure detection of cards / merged credit accounts whose expected statement date + grace days
 * has passed without a bill record for that period.
 */
export function detectMissingStatements(
  options: DetectMissingStatementsOptions,
): DetectMissingStatementsResult {
  const timeZone = options.timeZone || 'Asia/Shanghai'
  const todayStr = resolveTodayString(options.today, timeZone)
  const graceDays = normalizeMissingStatementGraceDays(options.graceDays)

  const directBillCountByCardId = new Map<string, number>()
  const latestMonthByCardId = new Map<string, string>()
  const latestMonthByAccountId = new Map<string, string>()

  for (const bill of options.bills) {
    directBillCountByCardId.set(bill.card_id, (directBillCountByCardId.get(bill.card_id) ?? 0) + 1)
    const ym = normalizeBillMonth(bill.bill_month)
    if (!ym) continue
    const prevCard = latestMonthByCardId.get(bill.card_id)
    if (!prevCard || ym > prevCard) latestMonthByCardId.set(bill.card_id, ym)
    if (bill.account_id) {
      const prevAcc = latestMonthByAccountId.get(bill.account_id)
      if (!prevAcc || ym > prevAcc) latestMonthByAccountId.set(bill.account_id, ym)
    }
  }

  const mergedGroups = new Map<string, MissingStatementCardInput[]>()
  const independentCards: MissingStatementCardInput[] = []

  for (const entry of options.cards) {
    const accId = entry.account?.id ?? entry.card.account_id ?? null
    if (entry.account?.statement_mode === 'merged' && accId) {
      const list = mergedGroups.get(accId) ?? []
      list.push(entry)
      mergedGroups.set(accId, list)
    } else {
      independentCards.push(entry)
    }
  }

  const items: MissingStatementSummary[] = []
  const byCarrierCardId = new Map<string, MissingStatementSummary>()
  const suppressedCardIds = new Set<string>()
  const carrierCardIdByAccountId = new Map<string, string>()

  const evaluateUnit = (unit: {
    targetKey: string
    carrier: MissingStatementCardInput
    account: MissingStatementCardInput['account']
    accountId: string | null
    isMerged: boolean
    memberCardIds: Set<string>
    latestBillMonth: string | null
    earliestCreatedDay: string
    subject: string
    currency: string
  }) => {
    const effectiveBillingDay = clampBillingDay(
      unit.carrier.card.override_billing_day ??
        unit.carrier.card.billing_day ??
        unit.account?.billing_day ??
        1,
    )

    let missingBillMonth: string | null = null
    let expectedStatementDate: string | null = null
    let daysPast = 0

    if (unit.latestBillMonth) {
      const targetMonth = addYearMonth(unit.latestBillMonth, 1)
      const stmtDate = actualStatementDateInMonth(effectiveBillingDay, targetMonth)
      const diff = diffCivilDays(todayStr, stmtDate)
      if (diff > graceDays) {
        missingBillMonth = targetMonth
        expectedStatementDate = stmtDate
        daysPast = diff
      }
    } else {
      const createdMonth = unit.earliestCreatedDay.slice(0, 7)
      const firstMonthStmt = actualStatementDateInMonth(effectiveBillingDay, createdMonth)
      const firstExpectedMonth =
        unit.earliestCreatedDay <= firstMonthStmt
          ? createdMonth
          : addYearMonth(createdMonth, 1)

      const todayMonth = todayStr.slice(0, 7)
      const candidates = [
        todayMonth,
        addYearMonth(todayMonth, -1),
        addYearMonth(todayMonth, -2),
      ]
      let mostRecentOverdueMonth: string | null = null
      let mostRecentStmt: string | null = null
      let mostRecentDiff = 0

      for (const m of candidates) {
        const stmtDate = actualStatementDateInMonth(effectiveBillingDay, m)
        const diff = diffCivilDays(todayStr, stmtDate)
        if (diff > graceDays) {
          mostRecentOverdueMonth = m
          mostRecentStmt = stmtDate
          mostRecentDiff = diff
          break
        }
      }

      if (mostRecentOverdueMonth && mostRecentStmt && mostRecentOverdueMonth >= firstExpectedMonth) {
        missingBillMonth = mostRecentOverdueMonth
        expectedStatementDate = mostRecentStmt
        daysPast = mostRecentDiff
      }
    }

    if (!missingBillMonth || !expectedStatementDate) return

    const draft = findMatchingDraft(options.drafts, {
      isMerged: unit.isMerged,
      accountId: unit.accountId,
      anchorCardId: unit.carrier.card.id,
      memberCardIds: unit.memberCardIds,
      missingBillMonth,
    })

    const summary: MissingStatementSummary = {
      targetKey: unit.targetKey,
      anchorCardId: unit.carrier.card.id,
      accountId: unit.accountId,
      holderId: unit.carrier.card.holder_id,
      isMerged: unit.isMerged,
      missingBillMonth,
      expectedStatementDate,
      suggestedDueDate: computeSuggestedDueDate(
        unit.carrier.card,
        unit.account,
        missingBillMonth,
      ),
      daysPast,
      graceDays,
      subject: unit.subject,
      currency: unit.currency,
      pendingDraftId: draft?.id ?? null,
      pendingDraftStatus: draft?.parse_status ?? null,
    }
    items.push(summary)
    byCarrierCardId.set(unit.carrier.card.id, summary)
  }

  for (const [accountId, members] of mergedGroups.entries()) {
    const account = members.find((m) => m.account)?.account ?? null
    if (!account || account.status === 'archived') {
      for (const m of members) suppressedCardIds.add(m.card.id)
      continue
    }

    const activeMembers = members.filter((m) => isEligibleCreditCard(m.card))
    if (activeMembers.length === 0) {
      for (const m of members) suppressedCardIds.add(m.card.id)
      continue
    }

    let carrier =
      (account.primary_card_id
        ? activeMembers.find((m) => m.card.id === account.primary_card_id)
        : undefined) ?? undefined

    if (!carrier) {
      const sorted = [...activeMembers].sort((a, b) => {
        const countDiff =
          (directBillCountByCardId.get(b.card.id) ?? 0) -
          (directBillCountByCardId.get(a.card.id) ?? 0)
        if (countDiff !== 0) return countDiff
        const createdA = a.card.created_at || ''
        const createdB = b.card.created_at || ''
        if (createdA !== createdB) return createdA.localeCompare(createdB)
        return a.card.id.localeCompare(b.card.id)
      })
      carrier = sorted[0]
    }

    carrierCardIdByAccountId.set(accountId, carrier.card.id)
    for (const m of members) {
      if (m.card.id !== carrier.card.id) {
        suppressedCardIds.add(m.card.id)
      }
    }

    const memberCardIds = new Set(members.map((m) => m.card.id))
    let latestBillMonth: string | null = latestMonthByAccountId.get(accountId) ?? null
    for (const cid of memberCardIds) {
      const cm = latestMonthByCardId.get(cid)
      if (cm && (!latestBillMonth || cm > latestBillMonth)) {
        latestBillMonth = cm
      }
    }

    let earliestCreatedDay = todayStr
    let hasCreated = false
    for (const m of activeMembers) {
      const day = toCivilDay(m.card.created_at, timeZone)
      if (day && (!hasCreated || day < earliestCreatedDay)) {
        earliestCreatedDay = day
        hasCreated = true
      }
    }

    evaluateUnit({
      targetKey: `account:${accountId}`,
      carrier,
      account,
      accountId,
      isMerged: true,
      memberCardIds,
      latestBillMonth,
      earliestCreatedDay,
      subject: formatMergedAccountSubject(account, activeMembers, carrier),
      currency: carrier.card.card_product?.currency || account.currency || 'CNY',
    })
  }

  for (const entry of independentCards) {
    if (entry.account?.status === 'archived') continue
    if (!isEligibleCreditCard(entry.card)) continue

    const latestBillMonth = latestMonthByCardId.get(entry.card.id) ?? null
    const earliestCreatedDay = toCivilDay(entry.card.created_at, timeZone) ?? todayStr

    evaluateUnit({
      targetKey: `card:${entry.card.id}`,
      carrier: entry,
      account: entry.account,
      accountId: entry.account?.id ?? entry.card.account_id ?? null,
      isMerged: false,
      memberCardIds: new Set([entry.card.id]),
      latestBillMonth,
      earliestCreatedDay,
      subject: formatSingleCardSubject(entry.card),
      currency: entry.card.card_product?.currency || entry.account?.currency || 'CNY',
    })
  }

  items.sort((a, b) => b.daysPast - a.daysPast || a.anchorCardId.localeCompare(b.anchorCardId))

  return {
    items,
    byCarrierCardId,
    suppressedCardIds,
    carrierCardIdByAccountId,
  }
}
