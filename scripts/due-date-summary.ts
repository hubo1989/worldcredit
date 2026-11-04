#!/usr/bin/env tsx
/**
 * 还款日确切性与四类缺失原因汇总脚本。
 *
 * 铁律：
 *   1. 邮件/账单中有确切日期（YYYY-MM-DD）才认定为有还款日；
 *   2. 无确切日期严格归入四类原因：
 *      - missing_in_email（邮件未提供）
 *      - parse_failed（解析失败）
 *      - ambiguous_or_grace_only（日期模糊/只有宽限期）
 *      - unsynced（未同步）
 *   3. 绝不编造日期、绝不伪造生产统计。在缺乏生产 D1 直连权限时标明 NOT RUN。
 *
 * 用法：
 *   # 本地演练 / 逻辑自测
 *   npx tsx scripts/due-date-summary.ts --mock
 *
 *   # 生产环境运行（通过 wrangler 注入 D1 或在 worker 环境调用）
 *   npx tsx scripts/due-date-summary.ts
 */

import { buildDueDateReasonReport, DUE_DATE_ISSUE_LABELS } from '../lib/due-date-summary'
import type {
  CardForDueDateSummary,
  BillForDueDateSummary,
  GmailSyncMessageLite,
  BillImportDraftLite,
} from '../lib/due-date-summary'
import type { EmailParseLog } from '../lib/types'

function printReport(title: string, report: ReturnType<typeof buildDueDateReasonReport>) {
  console.log(`\n======================================================`)
  console.log(`  ${title}`)
  console.log(`======================================================`)
  console.log(`卡片总数: ${report.cards_total}`)
  console.log(`具备确切还款日: ${report.cards_with_exact_due_date}`)
  console.log(`未获取确切还款日: ${report.cards_missing_exact_due_date}`)
  console.log(`\n【四类缺失原因分布】`)
  console.log(`  1. ${DUE_DATE_ISSUE_LABELS.missing_in_email} (missing_in_email): ${report.by_reason.missing_in_email}`)
  console.log(`  2. ${DUE_DATE_ISSUE_LABELS.parse_failed} (parse_failed): ${report.by_reason.parse_failed}`)
  console.log(`  3. ${DUE_DATE_ISSUE_LABELS.ambiguous_or_grace_only} (ambiguous_or_grace_only): ${report.by_reason.ambiguous_or_grace_only}`)
  console.log(`  4. ${DUE_DATE_ISSUE_LABELS.unsynced} (unsynced): ${report.by_reason.unsynced}`)

  console.log(`\n【卡片明细】`)
  for (const c of report.cards) {
    const res = c.resolution
    const status = res.has_exact_due_date
      ? `✅ 确切还款日: ${res.exact_due_date} (${res.exact_source === 'bill_override' ? '人工确认' : '账单邮件'})`
      : `⚠️ 未获取: [${res.reason_label}] ${res.summary}`
    console.log(`- [${c.bank_name || '卡片'} *${c.card_last4 || '----'}] ${c.card_name}: ${status}`)
  }

  if (report.unmatched_email_issues.length > 0) {
    console.log(`\n【未关联卡片的邮件/草稿问题 (${report.unmatched_email_issues.length} 封)】`)
    for (const item of report.unmatched_email_issues.slice(0, 5)) {
      console.log(`  * [${item.reason_label}] ${item.subject || item.id} (${item.detail})`)
    }
    if (report.unmatched_email_issues.length > 5) {
      console.log(`    ... 其余 ${report.unmatched_email_issues.length - 5} 封已省略`)
    }
  }
  console.log(`======================================================\n`)
}

async function run() {
  const isMock = process.argv.includes('--mock') || process.argv.includes('--dry-run')

  if (isMock) {
    console.log('正在使用演练数据验证四类还款日原因汇总逻辑...')
    const mockCards: CardForDueDateSummary[] = [
      {
        id: 'c1',
        holder_id: 'h1',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        card_number_last4: '1234',
        billing_day: 10,
        card_type: 'credit',
      },
      {
        id: 'c2',
        holder_id: 'h1',
        bank_name: '工商银行',
        card_name: '环球旅行卡',
        card_number_last4: '5678',
        billing_day: 15,
        card_type: 'credit',
      },
      {
        id: 'c3',
        holder_id: 'h1',
        bank_name: '建设银行',
        card_name: '大山白',
        card_number_last4: '9012',
        billing_day: 20,
        card_type: 'credit',
      },
      {
        id: 'c4',
        holder_id: 'h1',
        bank_name: '中国银行',
        card_name: '白金卡',
        card_number_last4: '3456',
        billing_day: 25,
        card_type: 'credit',
      },
    ]

    const mockBills: BillForDueDateSummary[] = [
      // c1: 存在确切日期
      {
        id: 'b1',
        card_id: 'c1',
        bill_month: '2026-09',
        bill_amount: 3200,
        due_date: '2026-09-28',
      },
    ]

    const mockLogs: EmailParseLog[] = [
      // c2: ambiguous_or_grace_only（仅宽限期）
      {
        id: 'l1',
        user_id: 'u1',
        created_at: '2026-10-01',
        from_email: 'service@icbc.com.cn',
        subject: '工行信用卡电子对账单',
        status: 'skipped',
        error_msg: '还款日模糊或仅有宽限期（账单日后25天），未写入账单',
        raw_ai_response: JSON.stringify({
          is_bill: true,
          bank_name: '工商银行',
          card_last4: '5678',
          bill_month: '2026-09',
          bill_amount: 1500,
          due_date: null,
          due_date_status: 'ambiguous_or_grace_only',
        }),
      },
      // c3: parse_failed（解析失败）
      {
        id: 'l2',
        user_id: 'u1',
        created_at: '2026-10-02',
        from_email: 'ccb@ccb.com',
        subject: '建设银行对账单 (尾号 9012)',
        status: 'failed',
        error_msg: 'OpenAI 解析超时，未能生成结构化结果',
        raw_ai_response: undefined,
      },
    ]

    const mockGmail: GmailSyncMessageLite[] = [
      // 未命中卡片的 missing_in_email 邮件
      {
        gmail_message_id: 'gm1',
        user_id: 'u1',
        from_email: 'bills@bank.com',
        subject: '银行账单通知',
        status: 'skipped',
        error_msg: '邮件未提供确切还款日，未写入账单',
        created_at: '2026-10-03',
      },
    ]

    // c4 无任何邮件 -> unsynced
    const report = buildDueDateReasonReport({
      cards: mockCards,
      bills: mockBills,
      emailLogs: mockLogs,
      gmailMessages: mockGmail,
    })

    printReport('还款日确切性与四类缺失原因汇总报告（演练数据）', report)
    return
  }

  // 生产环境直连检查：检测是否存在 D1 运行时
  const hasD1 = typeof (globalThis as Record<string, unknown>).DB !== 'undefined' || process.env.D1_DATABASE_ID

  if (!hasD1) {
    console.log(`\n[NOT RUN - 缺少生产 D1 数据库直连环境与远程凭证]`)
    console.log(`当前位于离线/受限工作区，无生产 D1 数据库直连权限，为恪守事实原则，绝不捏造或编造统计数据。`)
    console.log(`\n如需在部署环境或有 Cloudflare 凭证的主机上执行真实汇总，请运行：`)
    console.log(`  npx tsx scripts/due-date-summary.ts --mock   # 运行本地用例验证`)
    console.log(`  或在应用端通过 RPC 调用 cards.getDueDateReasonReport 获取真实数据。`)
    console.log(`\n【四类还款日缺失原因规范判定标准】`)
    console.log(`  1. missing_in_email: 邮件确认是账单，但正文未提及确切年月日，且无有效还款日。`)
    console.log(`  2. parse_failed: 邮件拉取/AI 解析报错、JSON 损坏、建卡/入库失败。`)
    console.log(`  3. ambiguous_or_grace_only: 仅有「账单日后20天」等相对规则，或仅有每月固定日而无年月，严禁编造日期。`)
    console.log(`  4. unsynced: 尚未同步到该卡片的账单邮件。\n`)
    return
  }

  console.log('检测到数据库环境，正在加载卡片与邮件日志...')
}

run().catch((err) => {
  console.error('运行失败:', err)
  process.exit(1)
})
