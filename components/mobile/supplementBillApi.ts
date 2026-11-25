// components/mobile/supplementBillApi.ts
// Stage 3 客户端冻结契约桥接与纯计算兜底（HUB-270）。
// 不触碰 lib/api/**、lib/types.ts、lib/missing-statement.ts，支持与 HUB-269 零冲突并行研发。
import { callRpc, RpcError } from '@/lib/api/rpc-client'
import type { CardWithBillsSummary } from '@/lib/api/bills'
import type { Bill, CardProduct, CreditAccount, CreditCard } from '@/lib/types'
import {
  formatCardTail,
  getEffectiveCardName,
  getEffectiveDueConfig,
  getLocalTodayString,
} from '@/lib/utils'

export const DEFAULT_MISSING_STATEMENT_GRACE_DAYS = 3
export const MIN_MISSING_STATEMENT_GRACE_DAYS = 0
export const MAX_MISSING_STATEMENT_GRACE_DAYS = 15

export interface MissingStatementSummary {
  /** 唯一业务键：合并账户为 `account:${accountId}`，独立卡为 `card:${anchorCardId}` */
  targetKey: string
  /** 展示与补录跳转锚点卡 ID（保证为 status='active' 且 card_type='credit'） */
  anchorCardId: string
  accountId: string | null
  holderId: string
  isMerged: boolean
  /** 缺失目标账期 'YYYY-MM' */
  missingBillMonth: string
  /** 预期出账日 'YYYY-MM-DD'（已做月末 28/29/30 收拢） */
  expectedStatementDate: string
  /** 按卡/产品还款规则推算的到期日 'YYYY-MM-DD' */
  suggestedDueDate: string
  /** 已过预期出账日自然天数（恒 > graceDays） */
  daysPast: number
  /** 本次判定使用的生效宽限天数（0..15） */
  graceDays: number
  /** 规范化展示标题（独立卡或合并账户多尾号文案） */
  subject: string
  currency: string
  /** 同卡/同账户待确认草稿提示（不影响超期判定消除） */
  pendingDraftId: string | null
  pendingDraftStatus: 'parsing' | 'needs_password' | 'parse_failed' | 'ready' | null
}

export type CardWithMissingStatement = CardWithBillsSummary & {
  missingStatement?: MissingStatementSummary | null
}

export interface MissingStatementDraftRef {
  id: string
  card_id: string | null
  matched_account_id?: string | null
  bill_month?: string | null
  parse_status?: 'parsing' | 'needs_password' | 'parse_failed' | 'ready' | null
}

export interface SupplementMissingBillInput {
  /** 客户端幂等 UUID（可选；传入时作为 bills.id 支持离线/弱网安全重试） */
  id?: string
  /** 服务端由 bindField 强制覆写，客户端不传 */
  user_id?: string
  card_id: string
  /** 'YYYY-MM' */
  bill_month: string
  /** >= 0；0 表示确认「本期无消费 / 0 元零账单」 */
  bill_amount: number
  /** 选填，>= 0 */
  min_payment?: number | null
  /** 必填，'YYYY-MM-DD' 真实日历日 */
  due_date: string
  /** 选填，'YYYY-MM-DD' 真实日历日 */
  statement_date?: string | null
  statement_start?: string | null
  statement_end?: string | null
  pin_due_date?: boolean
  pin_statement_date?: boolean
  pin_min_payment?: boolean
  /** 仅当 bill_amount > 0 时有效：同事务生成一笔等额还款（channel='手动补录结清'）并置为 paid */
  mark_as_paid?: boolean
  subtotals?: Array<{
    card_id?: string | null
    card_tail: string
    subtotal_amount: number
    currency?: string
  }>
}

export interface SupplementMissingBillResult {
  bill: Bill
  action: 'created' | 'updated_existing' | 'replayed'
  is_zero_bill: boolean
  payment_created: boolean
}

type RpcFn<A extends unknown[], R> = (...args: A) => Promise<R>

export function supplementMissingBill(
  input: SupplementMissingBillInput
): Promise<SupplementMissingBillResult> {
  return callRpc<RpcFn<[SupplementMissingBillInput], SupplementMissingBillResult>>(
    'bills',
    'supplementMissingBill',
    input
  )
}

export function extractExistingBillIdFromConflict(err: unknown): string | null {
  if (!(err instanceof RpcError) || err.code !== 'CONFLICT') return null
  const details = err.details as { existing_bill_id?: unknown } | null | undefined
  return typeof details?.existing_bill_id === 'string' && details.existing_bill_id
    ? details.existing_bill_id
    : null
}

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

export function normalizeYearMonth(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (match) {
    const month = Number(match[2])
    return month >= 1 && month <= 12 ? trimmed : null
  }
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length === 6) {
    const month = Number(digits.slice(4, 6))
    return month >= 1 && month <= 12 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}` : null
  }
  return null
}

export function addYearMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const totalMonths = y * 12 + (m - 1) + deltaMonths
  const nextYear = Math.floor(totalMonths / 12)
  const nextMonth = ((totalMonths % 12) + 12) % 12 + 1
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
}

function daysInCivilMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
}

export function clampBillingDay(raw: number): number {
  return Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 31) : 1
}

export function actualStatementDateInMonth(billingDay: number, yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const clamped = clampBillingDay(billingDay)
  const lastDay = daysInCivilMonth(year, month)
  const actualDay = Math.min(clamped, lastDay)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`
}

export function diffCivilDays(laterYmd: string, earlierYmd: string): number {
  const [y1, m1, d1] = laterYmd.split('-').map(Number)
  const [y2, m2, d2] = earlierYmd.split('-').map(Number)
  return Math.round(
    (Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000
  )
}

function addCivilDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`
}

export function computeSuggestedDueDate(
  card: Pick<
    CreditCard,
    'billing_day' | 'override_billing_day' | 'override_due_type' | 'override_due_value'
  >,
  cardProduct: Pick<CardProduct, 'payment_due_type' | 'payment_due_value'> | null | undefined,
  billMonth: string
): string {
  const normalized = normalizeYearMonth(billMonth) ?? billMonth
  const fallbackProduct: Pick<CardProduct, 'payment_due_type' | 'payment_due_value'> =
    cardProduct ?? { payment_due_type: 'after_billing', payment_due_value: 20 }
  const { type, value } = getEffectiveDueConfig(
    card as CreditCard,
    fallbackProduct as CardProduct
  )
  const effectiveBillingDay = card.override_billing_day ?? card.billing_day

  if (type === 'fixed') {
    const nextMonth = addYearMonth(normalized, 1)
    const [ny, nm] = nextMonth.split('-').map(Number)
    const day = Math.min(Math.max(Math.trunc(value), 1), daysInCivilMonth(ny, nm))
    return `${nextMonth}-${String(day).padStart(2, '0')}`
  }
  if (type === 'fixed_before_billing') {
    const [y, m] = normalized.split('-').map(Number)
    const day = Math.min(Math.max(Math.trunc(value), 1), daysInCivilMonth(y, m))
    return `${normalized}-${String(day).padStart(2, '0')}`
  }
  const statementDate = actualStatementDateInMonth(effectiveBillingDay, normalized)
  return addCivilDays(statementDate, Math.trunc(value))
}

function toCivilDay(raw: string | null | undefined, timeZone: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s.replace(' ', 'T') + 'Z')
    return Number.isNaN(d.getTime()) ? null : getLocalTodayString(timeZone, d)
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : getLocalTodayString(timeZone, d)
}

function formatUnitSubject(
  carrierCard: CardWithBillsSummary['card'],
  activeMembers: CardWithBillsSummary['card'][],
  account: CreditAccount | undefined
): string {
  const bankName = carrierCard.card_product?.bank_name || account?.bank_name || '银行卡'
  if (account?.statement_mode === 'merged' && activeMembers.length >= 2) {
    const tails = activeMembers
      .map(m => formatCardTail(m.card_number_last4))
      .filter(Boolean)
    if (tails.length > 2) {
      return `${bankName} 合并账单（含尾号 ${tails.slice(0, 2).join(' · ')} 等 ${activeMembers.length} 张卡）`
    }
    if (tails.length > 0) {
      return `${bankName} 合并账单（含尾号 ${tails.join(' · ')}）`
    }
    return `${bankName} 合并账单（${activeMembers.length} 张卡）`
  }
  const cardName = getEffectiveCardName(carrierCard, carrierCard.card_product)
  const displayCardName = cardName.startsWith(bankName)
    ? cardName.slice(bankName.length).trim()
    : cardName
  const tail = formatCardTail(carrierCard.card_number_last4)
  const head = displayCardName ? `${bankName} ${displayCardName}` : bankName
  return tail ? `${head}（尾号 ${tail}）` : head
}

function isActiveCreditCard(card: Pick<CreditCard, 'status' | 'card_type'>): boolean {
  const status = card.status ?? 'active'
  const cardType = card.card_type ?? 'credit'
  return status === 'active' && cardType === 'credit'
}

export interface DetectClientResult {
  items: MissingStatementSummary[]
  byCarrierCardId: Map<string, MissingStatementSummary>
  suppressedCardIds: Set<string>
  carrierCardIdByAccountId: Map<string, string>
}

export function detectMissingStatementsFromSummary(
  cardsSummary: CardWithBillsSummary[],
  opts: {
    today?: string | Date
    timeZone?: string
    graceDays?: unknown
    drafts?: MissingStatementDraftRef[]
  } = {}
): DetectClientResult {
  const timeZone = opts.timeZone ?? 'Asia/Shanghai'
  const todayStr =
    typeof opts.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.today)
      ? opts.today
      : getLocalTodayString(timeZone, opts.today instanceof Date ? opts.today : new Date())
  const todayMonth = todayStr.slice(0, 7)
  const graceDays = normalizeMissingStatementGraceDays(opts.graceDays)
  const drafts = opts.drafts ?? []

  const cardById = new Map<string, CardWithBillsSummary>()
  for (const item of cardsSummary) {
    cardById.set(item.card.id, item)
  }

  type Unit = {
    targetKey: string
    accountId: string | null
    account: CreditAccount | undefined
    isMerged: boolean
    members: CardWithBillsSummary[]
  }

  const mergedUnits = new Map<string, Unit>()
  const independentUnits: Unit[] = []

  for (const item of cardsSummary) {
    const account = item.account
    if (account?.statement_mode === 'merged' && item.card.account_id) {
      const accountId = item.card.account_id
      let unit = mergedUnits.get(accountId)
      if (!unit) {
        unit = {
          targetKey: `account:${accountId}`,
          accountId,
          account,
          isMerged: true,
          members: [],
        }
        mergedUnits.set(accountId, unit)
      }
      unit.members.push(item)
    } else {
      independentUnits.push({
        targetKey: `card:${item.card.id}`,
        accountId: item.card.account_id ?? null,
        account,
        isMerged: false,
        members: [item],
      })
    }
  }

  const items: MissingStatementSummary[] = []
  const byCarrierCardId = new Map<string, MissingStatementSummary>()
  const suppressedCardIds = new Set<string>()
  const carrierCardIdByAccountId = new Map<string, string>()

  const allUnits = [...mergedUnits.values(), ...independentUnits]

  for (const unit of allUnits) {
    if (unit.account?.status === 'archived') {
      for (const m of unit.members) suppressedCardIds.add(m.card.id)
      continue
    }

    const activeMembers = unit.members.filter(m => isActiveCreditCard(m.card))
    if (activeMembers.length === 0) {
      for (const m of unit.members) suppressedCardIds.add(m.card.id)
      continue
    }

    let carrier = activeMembers[0]
    if (unit.isMerged) {
      const primaryId = unit.account?.primary_card_id
      const primaryMember = primaryId
        ? activeMembers.find(m => m.card.id === primaryId)
        : undefined
      if (primaryMember) {
        carrier = primaryMember
      } else {
        const sorted = [...activeMembers].sort((a, b) => {
          const directA = a.historyBills.filter(hb => hb.card_id === a.card.id).length
          const directB = b.historyBills.filter(hb => hb.card_id === b.card.id).length
          if (directA !== directB) return directB - directA
          const cmpCreated = (a.card.created_at || '').localeCompare(b.card.created_at || '')
          if (cmpCreated !== 0) return cmpCreated
          return a.card.id.localeCompare(b.card.id)
        })
        carrier = sorted[0]
      }
      if (unit.accountId) {
        carrierCardIdByAccountId.set(unit.accountId, carrier.card.id)
      }
      for (const m of unit.members) {
        if (m.card.id !== carrier.card.id) {
          suppressedCardIds.add(m.card.id)
        }
      }
    }

    const memberCardIds = new Set(unit.members.map(m => m.card.id))
    let latestBillMonth: string | null = null
    for (const m of unit.members) {
      for (const b of m.historyBills) {
        const normalized = normalizeYearMonth(b.bill_month)
        if (normalized && (!latestBillMonth || normalized > latestBillMonth)) {
          latestBillMonth = normalized
        }
      }
    }

    const effectiveBillingDay = clampBillingDay(
      carrier.card.override_billing_day ??
        carrier.card.billing_day ??
        unit.account?.billing_day ??
        1
    )

    let missingBillMonth: string | null = null
    let expectedStatementDate: string | null = null
    let daysPast = 0

    if (latestBillMonth) {
      const targetMonth = addYearMonth(latestBillMonth, 1)
      const expected = actualStatementDateInMonth(effectiveBillingDay, targetMonth)
      const diff = diffCivilDays(todayStr, expected)
      if (diff > graceDays) {
        missingBillMonth = targetMonth
        expectedStatementDate = expected
        daysPast = diff
      }
    } else {
      const createdDays = activeMembers
        .map(m => toCivilDay(m.card.created_at, timeZone))
        .filter((d): d is string => Boolean(d))
        .sort()
      const earliestCreated = createdDays[0]
      if (earliestCreated) {
        const createdMonth = earliestCreated.slice(0, 7)
        const firstMonthStmt = actualStatementDateInMonth(effectiveBillingDay, createdMonth)
        const firstExpectedMonth =
          earliestCreated <= firstMonthStmt ? createdMonth : addYearMonth(createdMonth, 1)

        const candidates = [
          todayMonth,
          addYearMonth(todayMonth, -1),
          addYearMonth(todayMonth, -2),
        ]
        for (const m of candidates) {
          if (m < firstExpectedMonth) continue
          const expected = actualStatementDateInMonth(effectiveBillingDay, m)
          const diff = diffCivilDays(todayStr, expected)
          if (diff > graceDays) {
            missingBillMonth = m
            expectedStatementDate = expected
            daysPast = diff
            break
          }
        }
      }
    }

    if (!missingBillMonth || !expectedStatementDate) continue

    const matchedDraft = drafts.find(d => {
      const cardMatch =
        (d.card_id && memberCardIds.has(d.card_id)) ||
        (unit.accountId && d.matched_account_id === unit.accountId)
      if (!cardMatch) return false
      const draftMonth = normalizeYearMonth(d.bill_month)
      if (draftMonth) return draftMonth === missingBillMonth
      return d.parse_status === 'needs_password' || d.parse_status === 'parse_failed'
    })

    const suggestedDueDate = computeSuggestedDueDate(
      carrier.card,
      carrier.card.card_product,
      missingBillMonth
    )

    const summary: MissingStatementSummary = {
      targetKey: unit.targetKey,
      anchorCardId: carrier.card.id,
      accountId: unit.accountId,
      holderId: carrier.holder_id,
      isMerged: unit.isMerged,
      missingBillMonth,
      expectedStatementDate,
      suggestedDueDate,
      daysPast,
      graceDays,
      subject: formatUnitSubject(
        carrier.card,
        activeMembers.map(m => m.card),
        unit.account
      ),
      currency: carrier.card.card_product?.currency || unit.account?.currency || 'CNY',
      pendingDraftId: matchedDraft?.id ?? null,
      pendingDraftStatus: matchedDraft?.parse_status ?? null,
    }

    items.push(summary)
    byCarrierCardId.set(carrier.card.id, summary)
  }

  items.sort((a, b) => {
    if (a.daysPast !== b.daysPast) return b.daysPast - a.daysPast
    return a.anchorCardId.localeCompare(b.anchorCardId)
  })

  return { items, byCarrierCardId, suppressedCardIds, carrierCardIdByAccountId }
}

/**
 * 为卡片列表挂载 `missingStatement` 口径：
 * - 若服务端（HUB-269）已返回 `missingStatement` 字段（含显式 `null`），保留服务端结果；
 * - 否则在客户端按同一算法计算兜底，并对齐合并账户载体卡。
 */
export function attachMissingStatements(
  cardsSummary: CardWithMissingStatement[],
  opts: {
    today?: string | Date
    timeZone?: string
    graceDays?: unknown
    drafts?: MissingStatementDraftRef[]
  } = {}
): CardWithMissingStatement[] {
  if (cardsSummary.length === 0) return cardsSummary
  const hasServerField = cardsSummary.some(c => c.missingStatement !== undefined)
  if (hasServerField) {
    return cardsSummary
  }

  const detected = detectMissingStatementsFromSummary(cardsSummary, opts)
  return cardsSummary.map(item => {
    const isMerged = item.account?.statement_mode === 'merged' && Boolean(item.card.account_id)
    const carrierId =
      isMerged && item.card.account_id
        ? detected.carrierCardIdByAccountId.get(item.card.account_id)
        : undefined
    const isAnchorCard = carrierId ? carrierId === item.card.id : item.isAnchorCard
    const suppressMissingStatement = detected.suppressedCardIds.has(item.card.id)
      ? true
      : item.suppressMissingStatement
    const missingStatement = detected.byCarrierCardId.get(item.card.id) ?? null
    return {
      ...item,
      isAnchorCard,
      suppressMissingStatement,
      missingStatement,
    }
  })
}
