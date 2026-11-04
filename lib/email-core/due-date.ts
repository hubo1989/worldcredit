/**
 * 邮件还款日确切性校验与缺失原因分类（email-worker 与主工程共用，零外部依赖）。
 *
 * 铁律：只有邮件给出确切的 YYYY-MM-DD 真日历日才允许写入/展示还款日；
 * 缺失、解析失败、或仅有宽限期/模糊日期一律不编造日期，并明确归因。
 */

import type { BillParseResult } from './types'

export type DueDateIssueKind =
  | 'missing_in_email'
  | 'parse_failed'
  | 'ambiguous_or_grace_only'
  | 'unsynced'

export const DUE_DATE_ISSUE_LABELS: Record<DueDateIssueKind, string> = {
  missing_in_email: '邮件未提供',
  parse_failed: '解析失败',
  ambiguous_or_grace_only: '日期模糊/只有宽限期',
  unsynced: '未同步',
}

/**
 * 严格校验 YYYY-MM-DD 真日历日（拦截 2026-02-30、相对描述「账单日后20天」、不完整年月等）。
 */
export function isExactDueDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  )
}

export type ParsedBillDueDateEvaluation =
  | { ok: true; dueDate: string | null; zeroBill: boolean }
  | {
      ok: false
      kind: 'not_a_bill' | 'missing_in_email' | 'ambiguous_or_grace_only'
      reason: string
    }

/**
 * 入库前校验解析结果中的账单基础字段与确切还款日。
 *
 * - 非账单或缺 bill_month / bill_amount：返回 kind='not_a_bill'（保持既有「非账单或缺少必填字段」文案兼容）。
 * - 0 元账单（应还 0 元无需还款）：due_date 若确切则采用，否则返回 dueDate=null。
 * - 非 0 元账单：必须具备确切 YYYY-MM-DD 还款日；否则精确区分
 *   `ambiguous_or_grace_only`（日期模糊/只有宽限期）与 `missing_in_email`（邮件未提供）。
 */
export function evaluateParsedBillDueDate(parsed: BillParseResult): ParsedBillDueDateEvaluation {
  if (
    parsed.is_bill === false ||
    !parsed.bill_month ||
    parsed.bill_amount == null ||
    Number.isNaN(Number(parsed.bill_amount))
  ) {
    return { ok: false, kind: 'not_a_bill', reason: '非账单或缺少必填字段' }
  }

  const zeroBill = Number(parsed.bill_amount) === 0
  const rawDue = typeof parsed.due_date === 'string' ? parsed.due_date.trim() : ''
  const hasValidDate = isExactDueDate(rawDue)

  if (zeroBill) {
    return {
      ok: true,
      dueDate: hasValidDate && parsed.due_date_status !== 'ambiguous_or_grace_only' ? rawDue : null,
      zeroBill: true,
    }
  }

  if (hasValidDate && parsed.due_date_status !== 'ambiguous_or_grace_only') {
    return { ok: true, dueDate: rawDue, zeroBill: false }
  }

  if (parsed.due_date_status === 'ambiguous_or_grace_only' || rawDue.length > 0) {
    return {
      ok: false,
      kind: 'ambiguous_or_grace_only',
      reason: '还款日模糊或仅有宽限期，未写入账单（禁止编造还款日）',
    }
  }

  return {
    ok: false,
    kind: 'missing_in_email',
    reason: '邮件未提供确切还款日，未写入账单',
  }
}

/**
 * 提取合法正数信用额度；0、负数、NaN、null 一律视为未获取（null）。
 */
export function extractValidCreditLimit(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}
