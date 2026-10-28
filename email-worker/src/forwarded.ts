/**
 * 「转发账单包」处理入口。
 *
 * 场景：用户把多封银行账单转发成一个包，真正的账单是包里的 .eml 附件。
 * 顶层邮件正文往往只有「见附件」几个字，对现有直发解析毫无价值；
 * 所以这条路径：读顶层字节 -> 取 .eml 附件 -> 每封当一个独立账单 -> 按持卡人落库。
 *
 * 附件持久化（R2）本轮不做：只在 email_parse_logs.raw_ai_response 里留下每条
 * 账单的解析结果和归属依据，便于排查。
 */

import type { AiConfig, BillParseResult, EmailParseLogRow, ForwardedBundleOutcome, ParsedRawMessage } from '../../lib/email-core/types'
import {
  extractNestedBillMessages,
  loadHolderScope,
  persistNestedBills,
  type HolderScope,
} from '../../lib/email-core/bills'
import { isEmlAttachment } from '../../lib/email-core/holders'

export interface ForwardedBundleParams {
  db: D1Database
  /** 该用户最早的持卡人，用于识别不出具体人时兜底。 */
  userId: string
  /** 顶层转发邮件（已按字节解析）。 */
  top: ParsedRawMessage
  parse: (text: string) => Promise<BillParseResult>
}

/** 把 outcome 揉成一行人类可读的说明，写进 email_parse_logs.error_msg。 */
function buildSummary(outcome: Omit<ForwardedBundleOutcome, 'summary' | 'billsWritten' | 'written'>, writtenCount: number): string {
  const parts = [
    '转发包：附件 ' + outcome.attachmentCount + ' 个（账单邮件 ' + outcome.nestedCount + ' 封）',
    '已写入账单 ' + writtenCount + ' 条',
  ]
  if (outcome.unsupported.length) parts.push('未解析 ' + outcome.unsupported.length + ' 个非邮件附件')
  if (outcome.skipped.length) {
    const detail = outcome.skipped.slice(0, 5).map(s => s.label + '（' + s.reason + '）').join('；')
    parts.push('跳过 ' + outcome.skipped.length + ' 封：' + detail)
  }
  return parts.join('；')
}

/**
 * 处理一个转发账单包。
 * 返回 null 表示「这不是一个带账单附件的转发包」，调用方可以按原逻辑继续（例如直发邮件）。
 */
export async function processForwardedBundle(params: ForwardedBundleParams): Promise<ForwardedBundleOutcome | null> {
  const { db, userId, top, parse } = params

  const attachments = top.attachments
  const emlCount = attachments.filter(isEmlAttachment).length
  if (!emlCount) return null

  const scope: HolderScope = await loadHolderScope(db, userId)
  const messages = extractNestedBillMessages(attachments)
  const result = await persistNestedBills(db, scope, messages, parse)

  const partial: Omit<ForwardedBundleOutcome, 'summary' | 'billsWritten' | 'written'> = {
    attachmentCount: attachments.length,
    nestedCount: messages.length,
    skipped: result.skipped,
    unsupported: attachments.filter(a => !isEmlAttachment(a)).map(a => a.filename || a.contentType),
  }

  return {
    ...partial,
    billsWritten: result.written.length,
    written: result.written,
    summary: buildSummary(partial, result.written.length),
  }
}

/** 把转发包的明细结果序列化进日志字段（不建表，复用现有 raw_ai_response 列）。 */
export function buildBundleLogPayload(outcome: ForwardedBundleOutcome): string {
  return JSON.stringify({
    source: 'forwarded_bundle',
    attachmentCount: outcome.attachmentCount,
    nestedCount: outcome.nestedCount,
    billsWritten: outcome.billsWritten,
    unsupported: outcome.unsupported,
    skipped: outcome.skipped,
    written: outcome.written.map(w => ({
      holder: w.holderName,
      holderId: w.holderId,
      cardId: w.cardId,
      billId: w.billId,
      // 归属依据必须留痕：识别不出具体人时会回落默认持卡人，这一点不能藏起来
      matchSource: w.matchSource,
      billMonth: w.aiResult.bill_month ?? null,
      cardLast4: w.aiResult.card_last4 ?? null,
      billAmount: w.aiResult.bill_amount ?? null,
    })),
  })
}

export type { AiConfig, EmailParseLogRow }
