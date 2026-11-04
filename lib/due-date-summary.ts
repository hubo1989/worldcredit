/**
 * 卡片与邮件维度的还款日确切性判定及缺失原因汇总。
 *
 * 严格区分四类缺失原因，绝不编造日期：
 *   - missing_in_email：邮件未提供确切还款日
 *   - parse_failed：邮件解析失败（AI 异常 / JSON 损坏 / 入库失败）
 *   - ambiguous_or_grace_only：日期模糊或仅有宽限期（如仅「账单日后 20 天」相对规则、非 YYYY-MM-DD）
 *   - unsynced：未同步（尚无该卡的邮件同步/解析记录）
 */

import { query, queryOne } from './db'
import type {
  Bill,
  CardDueDateEmailEvidence,
  CardDueDateResolution,
  CardProduct,
  CreditCard,
  DueDateMissingReasonCode,
  EmailParseLog,
} from './types'
import {
  DUE_DATE_ISSUE_LABELS,
  isExactDueDate,
} from './email-core/due-date'

export { DUE_DATE_ISSUE_LABELS }

export interface GmailSyncMessageLite {
  gmail_message_id: string
  user_id: string
  from_email?: string | null
  subject?: string | null
  status: 'bill_written' | 'draft_parked' | 'skipped' | 'failed'
  bill_id?: string | null
  draft_id?: string | null
  error_msg?: string | null
  created_at: string
}

export interface BillImportDraftLite {
  id: string
  created_by: string
  card_id?: string | null
  source_type?: string | null
  parsed_payload: string | Record<string, unknown>
  status?: string | null
  created_at: string
}

export interface CardForDueDateSummary {
  id: string
  holder_id: string
  card_number_last4?: string | null
  billing_day: number
  card_type: 'credit' | 'loan'
  loan_due_day?: number | null
  override_due_type?: 'fixed' | 'after_billing' | 'fixed_before_billing' | null
  override_due_value?: number | null
  bank_name?: string | null
  card_name?: string | null
  card_product?: Pick<
    CardProduct,
    'bank_name' | 'card_name' | 'payment_due_type' | 'payment_due_value'
  > | null
}

export interface BillForDueDateSummary {
  id: string
  card_id: string
  bill_month: string
  bill_amount: number
  statement_date?: string | null
  due_date: string
  due_date_override?: string | null
  created_at?: string
}

export interface EmailIssueSummaryItem {
  source: 'email_parse_log' | 'gmail_sync' | 'bill_draft'
  id: string
  created_at: string
  from_email: string | null
  subject: string | null
  bank_name: string | null
  card_last4: string | null
  reason_code: DueDateMissingReasonCode
  reason_label: string
  detail: string
}

export interface DueDateReasonReport {
  cards_total: number
  cards_with_exact_due_date: number
  cards_missing_exact_due_date: number
  by_reason: Record<DueDateMissingReasonCode, number>
  cards: Array<{
    card_id: string
    bank_name: string
    card_name: string
    card_last4: string
    resolution: CardDueDateResolution
  }>
  unmatched_email_issues: EmailIssueSummaryItem[]
}

function emptyReasonCounts(): Record<DueDateMissingReasonCode, number> {
  return {
    missing_in_email: 0,
    parse_failed: 0,
    ambiguous_or_grace_only: 0,
    unsynced: 0,
  }
}

function normalizeTail(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeBank(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
}

function bankMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBank(a)
  const nb = normalizeBank(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function parseJsonSafe(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 分类单封邮件解析日志（若属于非账单营销邮件或已成功给出确切还款日且已关联账单，则返回 null 表示无缺失问题）。
 */
export function classifyEmailLogDueDateIssue(log: EmailParseLog): EmailIssueSummaryItem[] {
  const createdAt = log.created_at || ''
  const fromEmail = log.from_email ?? null
  const subject = log.subject ?? null
  const errMsg = (log.error_msg ?? '').trim()
  const parsed = parseJsonSafe(log.raw_ai_response)

  // 1. 转发包日志：拆解内部 skipped 条目
  if (parsed && parsed.source === 'forwarded_bundle') {
    const skipped = Array.isArray(parsed.skipped)
      ? (parsed.skipped as Array<{ label?: string; reason?: string }>)
      : []
    const items: EmailIssueSummaryItem[] = []
    for (let i = 0; i < skipped.length; i++) {
      const entry = skipped[i]
      const r = String(entry?.reason ?? '').trim()
      if (!r) continue
      if (r.includes('AI 解析失败')) {
        items.push({
          source: 'email_parse_log',
          id: `${log.id}#${i + 1}`,
          created_at: createdAt,
          from_email: fromEmail,
          subject: entry?.label ? `${subject ?? '转发包'} (${entry.label})` : subject,
          bank_name: null,
          card_last4: null,
          reason_code: 'parse_failed',
          reason_label: DUE_DATE_ISSUE_LABELS.parse_failed,
          detail: r,
        })
      } else if (r.includes('宽限期') || r.includes('模糊')) {
        items.push({
          source: 'email_parse_log',
          id: `${log.id}#${i + 1}`,
          created_at: createdAt,
          from_email: fromEmail,
          subject: entry?.label ? `${subject ?? '转发包'} (${entry.label})` : subject,
          bank_name: null,
          card_last4: null,
          reason_code: 'ambiguous_or_grace_only',
          reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
          detail: r,
        })
      } else if (r.includes('邮件未提供确切还款日')) {
        items.push({
          source: 'email_parse_log',
          id: `${log.id}#${i + 1}`,
          created_at: createdAt,
          from_email: fromEmail,
          subject: entry?.label ? `${subject ?? '转发包'} (${entry.label})` : subject,
          bank_name: null,
          card_last4: null,
          reason_code: 'missing_in_email',
          reason_label: DUE_DATE_ISSUE_LABELS.missing_in_email,
          detail: r,
        })
      }
    }
    return items
  }

  // 2. 明确的非账单（营销/自动扣款通知/验证邮件）不计入账单还款日缺失
  if (
    errMsg.startsWith('Gmail 转发验证') ||
    errMsg.includes('email_kind=') ||
    (parsed && parsed.is_bill === false)
  ) {
    return []
  }

  const bankName = typeof parsed?.bank_name === 'string' ? parsed.bank_name : null
  const cardLast4 =
    typeof parsed?.card_last4 === 'string' ? normalizeTail(parsed.card_last4) || null : null
  const rawDue = typeof parsed?.due_date === 'string' ? parsed.due_date.trim() : ''
  const dueStatus = typeof parsed?.due_date_status === 'string' ? parsed.due_date_status : null

  // 3. 解析失败（status='failed' 且无有效 AI JSON，或 AI 接口报错，或建卡/入库失败导致未产出账单）
  if (log.status === 'failed') {
    if (!parsed) {
      return [
        {
          source: 'email_parse_log',
          id: log.id,
          created_at: createdAt,
          from_email: fromEmail,
          subject,
          bank_name: null,
          card_last4: null,
          reason_code: 'parse_failed',
          reason_label: DUE_DATE_ISSUE_LABELS.parse_failed,
          detail: errMsg || '邮件 AI 解析失败，未生成结构化结果',
        },
      ]
    }
    if (dueStatus === 'ambiguous_or_grace_only' || (rawDue && !isExactDueDate(rawDue))) {
      return [
        {
          source: 'email_parse_log',
          id: log.id,
          created_at: createdAt,
          from_email: fromEmail,
          subject,
          bank_name: bankName,
          card_last4: cardLast4,
          reason_code: 'ambiguous_or_grace_only',
          reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
          detail: errMsg || `邮件还款日「${rawDue || '宽限期规则'}」非确切日期`,
        },
      ]
    }
    if (!rawDue) {
      return [
        {
          source: 'email_parse_log',
          id: log.id,
          created_at: createdAt,
          from_email: fromEmail,
          subject,
          bank_name: bankName,
          card_last4: cardLast4,
          reason_code: 'missing_in_email',
          reason_label: DUE_DATE_ISSUE_LABELS.missing_in_email,
          detail: errMsg ? `邮件未提供还款日（且处理报错：${errMsg}）` : '邮件未提供确切还款日',
        },
      ]
    }
    return [
      {
        source: 'email_parse_log',
        id: log.id,
        created_at: createdAt,
        from_email: fromEmail,
        subject,
        bank_name: bankName,
        card_last4: cardLast4,
        reason_code: 'parse_failed',
        reason_label: DUE_DATE_ISSUE_LABELS.parse_failed,
        detail: errMsg || '账单入库失败',
      },
    ]
  }

  // 4. status === 'skipped'（含模糊日期跳过、缺少还款日跳过、或历史日志里 is_bill=true 但缺 due_date）
  if (log.status === 'skipped') {
    if (
      errMsg.includes('宽限期') ||
      errMsg.includes('模糊') ||
      dueStatus === 'ambiguous_or_grace_only' ||
      (rawDue && !isExactDueDate(rawDue))
    ) {
      return [
        {
          source: 'email_parse_log',
          id: log.id,
          created_at: createdAt,
          from_email: fromEmail,
          subject,
          bank_name: bankName,
          card_last4: cardLast4,
          reason_code: 'ambiguous_or_grace_only',
          reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
          detail: errMsg || '邮件仅含宽限期或还款日期模糊，未写入账单',
        },
      ]
    }
    if (
      errMsg.includes('邮件未提供确切还款日') ||
      (parsed && parsed.is_bill === true && !rawDue && Number(parsed.bill_amount) !== 0)
    ) {
      return [
        {
          source: 'email_parse_log',
          id: log.id,
          created_at: createdAt,
          from_email: fromEmail,
          subject,
          bank_name: bankName,
          card_last4: cardLast4,
          reason_code: 'missing_in_email',
          reason_label: DUE_DATE_ISSUE_LABELS.missing_in_email,
          detail: errMsg || '邮件未提供确切还款日',
        },
      ]
    }
  }

  return []
}

/**
 * 分类 Gmail 同步审计记录与待确认草稿的还款日缺失原因。
 */
export function classifyGmailMessageDueDateIssue(
  msg: GmailSyncMessageLite,
  draftById: Map<string, BillImportDraftLite>,
): EmailIssueSummaryItem | null {
  const errMsg = (msg.error_msg ?? '').trim()
  if (msg.status === 'bill_written') return null
  if (errMsg.includes('email_kind=')) return null

  const draft = msg.draft_id ? draftById.get(msg.draft_id) : undefined
  const payload = draft ? parseJsonSafe(draft.parsed_payload) : null
  if (payload && payload.is_bill === false) return null

  const bankName = typeof payload?.bank_name === 'string' ? payload.bank_name : null
  const cardLast4 =
    typeof payload?.card_last4 === 'string' ? normalizeTail(payload.card_last4) || null : null
  const rawDue = typeof payload?.due_date === 'string' ? payload.due_date.trim() : ''
  const dueStatus = typeof payload?.due_date_status === 'string' ? payload.due_date_status : null

  if (msg.status === 'failed') {
    return {
      source: 'gmail_sync',
      id: msg.gmail_message_id,
      created_at: msg.created_at,
      from_email: msg.from_email ?? null,
      subject: msg.subject ?? null,
      bank_name: bankName,
      card_last4: cardLast4,
      reason_code: 'parse_failed',
      reason_label: DUE_DATE_ISSUE_LABELS.parse_failed,
      detail: errMsg || 'Gmail 账单邮件解析失败',
    }
  }

  if (
    errMsg.includes('宽限期') ||
    errMsg.includes('模糊') ||
    dueStatus === 'ambiguous_or_grace_only' ||
    (rawDue && !isExactDueDate(rawDue))
  ) {
    return {
      source: 'gmail_sync',
      id: msg.gmail_message_id,
      created_at: msg.created_at,
      from_email: msg.from_email ?? null,
      subject: msg.subject ?? null,
      bank_name: bankName,
      card_last4: cardLast4,
      reason_code: 'ambiguous_or_grace_only',
      reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
      detail: errMsg || '邮件仅含宽限期或还款日期模糊',
    }
  }

  if (
    errMsg.includes('邮件未提供确切还款日') ||
    (payload && payload.is_bill !== false && !rawDue && Number(payload.bill_amount) !== 0)
  ) {
    return {
      source: 'gmail_sync',
      id: msg.gmail_message_id,
      created_at: msg.created_at,
      from_email: msg.from_email ?? null,
      subject: msg.subject ?? null,
      bank_name: bankName,
      card_last4: cardLast4,
      reason_code: 'missing_in_email',
      reason_label: DUE_DATE_ISSUE_LABELS.missing_in_email,
      detail: errMsg || '邮件未提供确切还款日',
    }
  }

  return null
}

function classifyStandaloneDraftIssue(draft: BillImportDraftLite): {
  cardId: string | null
  item: EmailIssueSummaryItem
} | null {
  if (draft.status && draft.status !== 'draft' && draft.status !== 'pending') return null
  const payload = parseJsonSafe(draft.parsed_payload)
  if (!payload || payload.is_bill === false) return null
  const rawDue = typeof payload.due_date === 'string' ? payload.due_date.trim() : ''
  const dueStatus = typeof payload.due_date_status === 'string' ? payload.due_date_status : null
  if (isExactDueDate(rawDue) && dueStatus !== 'ambiguous_or_grace_only') return null
  if (Number(payload.bill_amount) === 0) return null

  const bankName = typeof payload.bank_name === 'string' ? payload.bank_name : null
  const cardLast4 =
    typeof payload.card_last4 === 'string' ? normalizeTail(payload.card_last4) || null : null
  const reasonCode: DueDateMissingReasonCode =
    dueStatus === 'ambiguous_or_grace_only' || rawDue.length > 0
      ? 'ambiguous_or_grace_only'
      : 'missing_in_email'

  return {
    cardId: draft.card_id ?? null,
    item: {
      source: 'bill_draft',
      id: draft.id,
      created_at: draft.created_at,
      from_email: null,
      subject: bankName ? `${bankName} 待确认账单草稿` : '待确认账单草稿',
      bank_name: bankName,
      card_last4: cardLast4,
      reason_code: reasonCode,
      reason_label: DUE_DATE_ISSUE_LABELS[reasonCode],
      detail:
        reasonCode === 'ambiguous_or_grace_only'
          ? '草稿中还款日模糊或仅有宽限期'
          : '草稿中邮件未提供确切还款日',
    },
  }
}

function matchesCard(card: CardForDueDateSummary, issue: EmailIssueSummaryItem): boolean {
  const cardTail = normalizeTail(card.card_number_last4)
  const cardBank = card.bank_name ?? card.card_product?.bank_name ?? ''

  if (issue.card_last4 && cardTail) {
    if (issue.card_last4 !== cardTail) return false
    if (issue.bank_name && cardBank) {
      return bankMatches(issue.bank_name, cardBank)
    }
    return true
  }

  // 解析失败（无结构化尾号）时，若邮件主题含银行名且（无尾号或主题含该卡尾号），允许关联提示
  if (issue.reason_code === 'parse_failed' && !issue.card_last4) {
    const subj = `${issue.subject ?? ''} ${issue.detail ?? ''}`
    if (cardTail && subj.includes(cardTail)) return true
    if (cardBank && subj.toLowerCase().includes(cardBank.toLowerCase()) && !cardTail) return true
  }

  return false
}

/**
 * 判断账单行是否携带真实确切的还款日（排除 0 元账单的月末 -28 / 出账日存储兜底）。
 */
function pickExactBillDueDate(
  bills: BillForDueDateSummary[],
): { dueDate: string; source: 'bill_email' | 'bill_override'; billMonth: string } | null {
  const sorted = [...bills].sort((a, b) => {
    const byMonth = (b.bill_month || '').localeCompare(a.bill_month || '')
    if (byMonth !== 0) return byMonth
    return (b.created_at || '').localeCompare(a.created_at || '')
  })

  for (const bill of sorted) {
    if (bill.due_date_override && isExactDueDate(bill.due_date_override)) {
      return {
        dueDate: bill.due_date_override.trim(),
        source: 'bill_override',
        billMonth: bill.bill_month,
      }
    }
    const rawDue = typeof bill.due_date === 'string' ? bill.due_date.trim() : ''
    if (!isExactDueDate(rawDue)) continue
    // 0 元账单在入库时允许在无 due_date 情况下回落 statement_date 或 `${bill_month}-28` 以满足 NOT NULL；
    // 若金额为 0 且恰好等于回落占位值，不能当作邮件确切还款日展示。
    if (Number(bill.bill_amount) === 0) {
      const fallback28 = `${bill.bill_month}-28`
      if (rawDue === fallback28 || (bill.statement_date && rawDue === bill.statement_date)) {
        continue
      }
    }
    return {
      dueDate: rawDue,
      source: 'bill_email',
      billMonth: bill.bill_month,
    }
  }
  return null
}

function getManualFixedDueDay(card: CardForDueDateSummary): number | null {
  if (card.card_type === 'loan' && card.loan_due_day && card.loan_due_day >= 1 && card.loan_due_day <= 31) {
    return card.loan_due_day
  }
  if (
    (card.override_due_type === 'fixed' || card.override_due_type === 'fixed_before_billing') &&
    card.override_due_value &&
    card.override_due_value >= 1 &&
    card.override_due_value <= 31
  ) {
    return card.override_due_value
  }
  return null
}

/**
 * 纯函数：为单张卡计算还款日确切性与缺失原因汇总。
 */
export function resolveCardDueDate(params: {
  card: CardForDueDateSummary
  bills: BillForDueDateSummary[]
  matchedIssues: EmailIssueSummaryItem[]
  hasAnyUserSyncActivity: boolean
}): CardDueDateResolution {
  const { card, bills, matchedIssues, hasAnyUserSyncActivity } = params
  const sortedIssues = [...matchedIssues].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || ''),
  )

  const counts = emptyReasonCounts()
  for (const item of sortedIssues) {
    counts[item.reason_code]++
  }

  const evidences: CardDueDateEmailEvidence[] = sortedIssues.slice(0, 10).map((item) => ({
    source: item.source,
    id: item.id,
    subject: item.subject,
    from_email: item.from_email,
    created_at: item.created_at,
    reason_code: item.reason_code,
    reason_label: item.reason_label,
    detail: item.detail,
  }))

  const exact = pickExactBillDueDate(bills)
  const manualFixedDay = getManualFixedDueDay(card)

  if (exact) {
    return {
      has_exact_due_date: true,
      exact_due_date: exact.dueDate,
      exact_source: exact.source,
      exact_bill_month: exact.billMonth,
      manual_fixed_day: manualFixedDay,
      reason_code: null,
      reason_label: null,
      summary:
        exact.source === 'bill_override'
          ? `${exact.dueDate}（${exact.billMonth} 账单人工确认）`
          : `${exact.dueDate}（${exact.billMonth} 账单邮件）`,
      email_evidences: evidences,
      reason_counts: counts,
    }
  }

  // 无邮件/账单确切日期：严格按证据归入四类原因，绝不推算编造某月某日
  if (sortedIssues.length > 0) {
    const primary = sortedIssues[0]
    const parts: string[] = []
    if (counts.missing_in_email > 0) parts.push(`邮件未提供 ${counts.missing_in_email} 封`)
    if (counts.ambiguous_or_grace_only > 0)
      parts.push(`日期模糊/只有宽限期 ${counts.ambiguous_or_grace_only} 封`)
    if (counts.parse_failed > 0) parts.push(`解析失败 ${counts.parse_failed} 封`)
    return {
      has_exact_due_date: false,
      exact_due_date: null,
      exact_source: null,
      exact_bill_month: null,
      manual_fixed_day: manualFixedDay,
      reason_code: primary.reason_code,
      reason_label: primary.reason_label,
      summary: `未获取确切还款日（${parts.join('，')}）`,
      email_evidences: evidences,
      reason_counts: counts,
    }
  }

  // 无任何命中邮件时：若用户仅设置了相对宽限期覆盖（after_billing），归入「日期模糊/只有宽限期」；
  // 否则归入「未同步」（尚未同步到该卡的账单邮件）。
  if (card.override_due_type === 'after_billing' && card.override_due_value != null) {
    counts.ambiguous_or_grace_only = 1
    return {
      has_exact_due_date: false,
      exact_due_date: null,
      exact_source: null,
      exact_bill_month: null,
      manual_fixed_day: manualFixedDay,
      reason_code: 'ambiguous_or_grace_only',
      reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
      summary: `仅设置宽限期（账单日后 ${card.override_due_value} 天），尚无账单邮件确切日期`,
      email_evidences: [],
      reason_counts: counts,
    }
  }

  counts.unsynced = 1
  const graceHint =
    card.card_product?.payment_due_type === 'after_billing' && card.card_product?.payment_due_value
      ? `；卡产品默认仅含宽限期（账单日后 ${card.card_product.payment_due_value} 天），不编造具体日期`
      : ''
  return {
    has_exact_due_date: false,
    exact_due_date: null,
    exact_source: null,
    exact_bill_month: null,
    manual_fixed_day: manualFixedDay,
    reason_code: 'unsynced',
    reason_label: DUE_DATE_ISSUE_LABELS.unsynced,
    summary: hasAnyUserSyncActivity
      ? `未同步到该卡的账单邮件${graceHint}`
      : `尚未同步账单邮件${graceHint}`,
    email_evidences: [],
    reason_counts: counts,
  }
}

/**
 * 纯函数：汇总一组卡片及全部邮件日志/Gmail 同步消息/草稿的还款日状态与缺失原因。
 */
export function buildDueDateReasonReport(input: {
  cards: CardForDueDateSummary[]
  bills: BillForDueDateSummary[]
  emailLogs: EmailParseLog[]
  gmailMessages?: GmailSyncMessageLite[]
  billDrafts?: BillImportDraftLite[]
}): DueDateReasonReport {
  const { cards, bills, emailLogs, gmailMessages = [], billDrafts = [] } = input
  const draftById = new Map(billDrafts.map((d) => [d.id, d]))
  const referencedDraftIds = new Set(
    gmailMessages.map((m) => m.draft_id).filter((id): id is string => !!id),
  )

  const allIssues: Array<{ explicitCardId?: string | null; item: EmailIssueSummaryItem }> = []
  for (const log of emailLogs) {
    for (const item of classifyEmailLogDueDateIssue(log)) {
      allIssues.push({ item })
    }
  }
  for (const msg of gmailMessages) {
    const item = classifyGmailMessageDueDateIssue(msg, draftById)
    if (item) {
      const draft = msg.draft_id ? draftById.get(msg.draft_id) : undefined
      allIssues.push({ explicitCardId: draft?.card_id ?? null, item })
    }
  }
  for (const draft of billDrafts) {
    if (referencedDraftIds.has(draft.id)) continue
    const res = classifyStandaloneDraftIssue(draft)
    if (res) {
      allIssues.push({ explicitCardId: res.cardId, item: res.item })
    }
  }

  const hasAnyUserSyncActivity =
    emailLogs.length > 0 || gmailMessages.length > 0 || billDrafts.length > 0

  const billsByCard = new Map<string, BillForDueDateSummary[]>()
  for (const b of bills) {
    const arr = billsByCard.get(b.card_id) ?? []
    arr.push(b)
    billsByCard.set(b.card_id, arr)
  }

  const matchedIssueIds = new Set<string>()
  const byReason = emptyReasonCounts()
  let withExact = 0
  let missingExact = 0

  const cardReports = cards.map((card) => {
    const cardIssues: EmailIssueSummaryItem[] = []
    for (const entry of allIssues) {
      if (
        (entry.explicitCardId && entry.explicitCardId === card.id) ||
        matchesCard(card, entry.item)
      ) {
        cardIssues.push(entry.item)
        matchedIssueIds.add(`${entry.item.source}:${entry.item.id}`)
      }
    }
    const resolution = resolveCardDueDate({
      card,
      bills: billsByCard.get(card.id) ?? [],
      matchedIssues: cardIssues,
      hasAnyUserSyncActivity,
    })
    if (resolution.has_exact_due_date) {
      withExact++
    } else {
      missingExact++
      if (resolution.reason_code) byReason[resolution.reason_code]++
    }
    return {
      card_id: card.id,
      bank_name: card.bank_name ?? card.card_product?.bank_name ?? '',
      card_name: card.card_name ?? card.card_product?.card_name ?? '',
      card_last4: card.card_number_last4 ?? '',
      resolution,
    }
  })

  const unmatched = allIssues
    .filter((entry) => !matchedIssueIds.has(`${entry.item.source}:${entry.item.id}`))
    .map((entry) => entry.item)

  return {
    cards_total: cards.length,
    cards_with_exact_due_date: withExact,
    cards_missing_exact_due_date: missingExact,
    by_reason: byReason,
    cards: cardReports,
    unmatched_email_issues: unmatched,
  }
}

/**
 * 服务端查询：为单张卡片从 D1 加载账单与所属用户的邮件/Gmail/草稿记录并生成 CardDueDateResolution。
 */
export async function loadCardDueDateResolution(
  card: CreditCard & { card_product?: CardProduct; bank_name?: string; card_name?: string },
): Promise<CardDueDateResolution> {
  const holderRow = await queryOne<{ created_by: string; auth_user_id?: string | null }>(
    'SELECT created_by, auth_user_id FROM card_holders WHERE id = ?',
    [card.holder_id],
  )
  const ownerIds = Array.from(
    new Set(
      [holderRow.data?.created_by, holderRow.data?.auth_user_id].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ),
    ),
  )

  const { data: billRows } = await query<BillForDueDateSummary>(
    `SELECT id, card_id, bill_month, COALESCE(bill_amount_override, bill_amount) AS bill_amount,
            statement_date, due_date, due_date_override, created_at
     FROM bills WHERE card_id = ? ORDER BY bill_month DESC LIMIT 12`,
    [card.id],
  )

  let emailLogs: EmailParseLog[] = []
  let gmailMessages: GmailSyncMessageLite[] = []
  let billDrafts: BillImportDraftLite[] = []

  if (ownerIds.length > 0) {
    const placeholders = ownerIds.map(() => '?').join(',')
    const [logsRes, gmailRes, draftsRes] = await Promise.all([
      query<EmailParseLog>(
        `SELECT * FROM email_parse_logs WHERE user_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
        ownerIds,
      ),
      query<GmailSyncMessageLite>(
        `SELECT gmail_message_id, user_id, from_email, subject, status, bill_id, draft_id, error_msg, created_at
         FROM gmail_sync_messages WHERE user_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
        ownerIds,
      ),
      query<BillImportDraftLite>(
        `SELECT id, created_by, card_id, source_type, parsed_payload, status, created_at
         FROM bill_import_drafts WHERE created_by IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
        ownerIds,
      ),
    ])
    emailLogs = logsRes.data ?? []
    gmailMessages = gmailRes.data ?? []
    billDrafts = draftsRes.data ?? []
  }

  const report = buildDueDateReasonReport({
    cards: [card],
    bills: (billRows ?? []) as Bill[],
    emailLogs,
    gmailMessages,
    billDrafts,
  })
  return report.cards[0].resolution
}
