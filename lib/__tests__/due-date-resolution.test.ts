import { describe, it, expect } from 'vitest'
import {
  isExactDueDate,
  evaluateParsedBillDueDate,
  DUE_DATE_ISSUE_LABELS,
} from '../email-core/due-date'
import type { BillParseResult } from '../email-core/types'
import {
  buildDueDateReasonReport,
  resolveCardDueDate,
  type CardForDueDateSummary,
  type BillForDueDateSummary,
} from '../due-date-summary'
import type { EmailParseLog } from '../types'

describe('还款日确切性与四类缺失原因判定', () => {
  describe('isExactDueDate', () => {
    it('正确识别真日历日 YYYY-MM-DD', () => {
      expect(isExactDueDate('2026-09-25')).toBe(true)
      expect(isExactDueDate('2026-02-28')).toBe(true)
      expect(isExactDueDate('2024-02-29')).toBe(true) // 闰年合法
    })

    it('拦截非法日历日（如 2 月 30 日、4 月 31 日）', () => {
      expect(isExactDueDate('2026-02-30')).toBe(false)
      expect(isExactDueDate('2026-04-31')).toBe(false)
      expect(isExactDueDate('2026-13-01')).toBe(false)
    })

    it('拦截模糊日期、相对描述、不完整日期及非字符串', () => {
      expect(isExactDueDate('账单日后20天')).toBe(false)
      expect(isExactDueDate('免息期25天')).toBe(false)
      expect(isExactDueDate('每月15日')).toBe(false)
      expect(isExactDueDate('2026-09')).toBe(false)
      expect(isExactDueDate('09-25')).toBe(false)
      expect(isExactDueDate('')).toBe(false)
      expect(isExactDueDate(null)).toBe(false)
      expect(isExactDueDate(undefined)).toBe(false)
      expect(isExactDueDate(12345)).toBe(false)
    })
  })

  describe('evaluateParsedBillDueDate', () => {
    it('非账单或缺少月份/金额时，拒绝入库', () => {
      expect(evaluateParsedBillDueDate({ is_bill: false }).ok).toBe(false)
      expect(evaluateParsedBillDueDate({ is_bill: true, bill_amount: 100 } as unknown as BillParseResult).ok).toBe(false)
    })

    it('0 元账单（本期无需还款）：允许缺还款日，返回 dueDate 为 null', () => {
      const res = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 0,
      })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.zeroBill).toBe(true)
        expect(res.dueDate).toBeNull()
      }
    })

    it('0 元账单若有确切还款日，则正常保留', () => {
      const res = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 0,
        due_date: '2026-10-15',
      })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.dueDate).toBe('2026-10-15')
      }
    })

    it('非 0 元账单有确切还款日：校验通过', () => {
      const res = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 5200,
        due_date: '2026-10-25',
      })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.dueDate).toBe('2026-10-25')
      }
    })

    it('非 0 元账单缺少还款日：精确归类为 missing_in_email', () => {
      const res = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 5200,
        due_date: null,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.kind).toBe('missing_in_email')
        expect(res.reason).toContain('邮件未提供确切还款日')
      }
    })

    it('非 0 元账单日期模糊或仅有宽限期：精确归类为 ambiguous_or_grace_only，严禁编造日期', () => {
      const res1 = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 5200,
        due_date: '账单日后20天',
      })
      expect(res1.ok).toBe(false)
      if (!res1.ok) {
        expect(res1.kind).toBe('ambiguous_or_grace_only')
      }

      const res2 = evaluateParsedBillDueDate({
        is_bill: true,
        bill_month: '2026-09',
        bill_amount: 5200,
        due_date_status: 'ambiguous_or_grace_only',
      })
      expect(res2.ok).toBe(false)
      if (!res2.ok) {
        expect(res2.kind).toBe('ambiguous_or_grace_only')
      }
    })
  })

  describe('resolveCardDueDate & buildDueDateReasonReport', () => {
    const cardTemplate: CardForDueDateSummary = {
      id: 'card_招行',
      holder_id: 'holder_1',
      bank_name: '招商银行',
      card_name: '经典白',
      card_number_last4: '8888',
      billing_day: 5,
      card_type: 'credit',
    }

    it('存在账单邮件确切还款日时，返回确切日期', () => {
      const bills: BillForDueDateSummary[] = [
        {
          id: 'b1',
          card_id: 'card_招行',
          bill_month: '2026-09',
          bill_amount: 1000,
          due_date: '2026-09-25',
        },
      ]
      const res = resolveCardDueDate({
        card: cardTemplate,
        bills,
        matchedIssues: [],
        hasAnyUserSyncActivity: true,
      })
      expect(res.has_exact_due_date).toBe(true)
      expect(res.exact_due_date).toBe('2026-09-25')
      expect(res.exact_source).toBe('bill_email')
    })

    it('人工确认覆盖账单日期（due_date_override）时，优先采用人工覆盖', () => {
      const bills: BillForDueDateSummary[] = [
        {
          id: 'b1',
          card_id: 'card_招行',
          bill_month: '2026-09',
          bill_amount: 1000,
          due_date: '2026-09-25',
          due_date_override: '2026-09-28',
        },
      ]
      const res = resolveCardDueDate({
        card: cardTemplate,
        bills,
        matchedIssues: [],
        hasAnyUserSyncActivity: true,
      })
      expect(res.has_exact_due_date).toBe(true)
      expect(res.exact_due_date).toBe('2026-09-28')
      expect(res.exact_source).toBe('bill_override')
    })

    it('无账单日但有匹配邮件日志时：精准归入四类原因并返回依据', () => {
      const res = resolveCardDueDate({
        card: cardTemplate,
        bills: [],
        matchedIssues: [
          {
            source: 'email_parse_log',
            id: 'log_1',
            created_at: '2026-10-01',
            from_email: 'cmb@cmbchina.com',
            subject: '招商银行信用卡电子账单',
            bank_name: '招商银行',
            card_last4: '8888',
            reason_code: 'ambiguous_or_grace_only',
            reason_label: DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only,
            detail: '邮件仅含宽限期或还款日期模糊',
          },
        ],
        hasAnyUserSyncActivity: true,
      })
      expect(res.has_exact_due_date).toBe(false)
      expect(res.exact_due_date).toBeNull()
      expect(res.reason_code).toBe('ambiguous_or_grace_only')
      expect(res.summary).toContain('日期模糊/只有宽限期 1 封')
      expect(res.email_evidences.length).toBe(1)
    })

    it('无账单且无邮件时归类为 unsynced（未同步），绝不编造具体日历日', () => {
      const res = resolveCardDueDate({
        card: cardTemplate,
        bills: [],
        matchedIssues: [],
        hasAnyUserSyncActivity: false,
      })
      expect(res.has_exact_due_date).toBe(false)
      expect(res.exact_due_date).toBeNull()
      expect(res.reason_code).toBe('unsynced')
      expect(res.reason_label).toBe(DUE_DATE_ISSUE_LABELS.unsynced)
    })

    it('buildDueDateReasonReport 聚合多卡与邮件日志生成统计报表', () => {
      const cards: CardForDueDateSummary[] = [
        { ...cardTemplate, id: 'c1', card_number_last4: '1111' },
        { ...cardTemplate, id: 'c2', card_number_last4: '2222' },
      ]
      const bills: BillForDueDateSummary[] = [
        {
          id: 'b1',
          card_id: 'c1',
          bill_month: '2026-09',
          bill_amount: 800,
          due_date: '2026-09-25',
        },
      ]
      const emailLogs: EmailParseLog[] = [
        {
          id: 'l1',
          user_id: 'u1',
          created_at: '2026-10-01',
          from_email: 'cmb@cmbchina.com',
          subject: '招商银行信用卡账单 (2222)',
          status: 'skipped',
          error_msg: '邮件未提供确切还款日，未写入账单',
          raw_ai_response: JSON.stringify({
            is_bill: true,
            card_last4: '2222',
            bank_name: '招商银行',
            due_date_status: 'missing',
          }),
        },
      ]

      const report = buildDueDateReasonReport({
        cards,
        bills,
        emailLogs,
      })

      expect(report.cards_total).toBe(2)
      expect(report.cards_with_exact_due_date).toBe(1)
      expect(report.cards_missing_exact_due_date).toBe(1)
      expect(report.by_reason.missing_in_email).toBe(1)
      expect(report.cards[0].resolution.has_exact_due_date).toBe(true)
      expect(report.cards[1].resolution.reason_code).toBe('missing_in_email')
    })
  })
})
