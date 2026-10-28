/**
 * WorldCredit Email Worker
 *
 * Triggered by Cloudflare Email Routing for mail delivered to the per-user
 * dedicated address only:
 *   - bills+{userId}@20160325.xyz
 *
 * The shared public inbox (bills@20160325.xyz) is intentionally not supported:
 * attribution is derived exclusively from the recipient address.
 *
 * Uses D1 binding directly.
 */

import type { Env, EmailParseLogRow } from '../../lib/email-core/types'
import { parseRawMessage, streamToBytes, extractHeaderDisplayName } from '../../lib/email-core/mime'
import { buildBundleLogPayload, processForwardedBundle } from './forwarded'
import {
  findOrCreateCardForHolder,
  loadHolderScope,
  parkBillAsDraft,
  syncBillingDayFromBill,
  upsertBillForCard,
} from '../../lib/email-core/bills'
import { extractNameFromBody, resolveHolder } from '../../lib/email-core/holders'
import { loadAiConfig, parseBillWithAI } from '../../lib/email-core/ai'
import { scheduleBillSync } from './push'

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const db = env.DB

    const fromEmail = normalizeEmail(message.from ?? null)
    const toHeader = message.to ?? getHeader(message, 'to') ?? ''
    const subject = extractSubject(message)

    // 1. Resolve userId from the dedicated address (bills+{userId}@domain)
    const userId = parseUserId(toHeader)
    if (!userId) {
      console.warn(`[email-worker] Cannot resolve userId from To="${toHeader}" From="${fromEmail ?? ''}"`)
      return
    }

    const log: EmailParseLogRow = {
      user_id: userId, from_email: fromEmail, subject, bill_id: null,
      status: 'failed', error_msg: null, raw_ai_response: null,
    }

    // Gmail 转发验证邮件拦截：提取验证链接存入日志，避免正文丢弃后无法完成验证
    if (fromEmail === 'forwarding-noreply@google.com') {
      const raw = await streamToBytes(message.raw)
      const parsed = parseRawMessage(raw)
      const links = (parsed.text.match(/https:\/\/[^\s]+/g) ?? [])
        .filter(u => u.includes('google'))
      log.status = 'skipped'
      log.error_msg = links.length > 0
        ? `Gmail 转发验证链接: ${links[0]}`
        : 'Gmail 验证邮件但未提取到链接，正文前 500 字: ' + parsed.text.slice(0, 500)
      await writeLog(db, log)
      return
    }

    try {
      // 2. 一次读全原始字节。
      //    直发路径只需要正文，但转发包里的 .eml 附件是 base64，必须先拿到原始字节
      //    才能还原；整封邮件先按 utf-8 解码会不可逆地毁掉附件。正文提取仍在解析器内部完成。
      const raw = await streamToBytes(message.raw)
      const parsedTop = parseRawMessage(raw)
      const emailBody = parsedTop.text

      // 3. Fetch AI config（转发包路径里每封附件也要用它，所以提前到分支之前）
      const aiConfig = await loadAiConfig(db)
      if (!aiConfig.apiKey) {
        throw new Error('AI API Key 未配置（system_settings.ai_api_key）')
      }

      // 4. 转发账单包路径。
      //    用户把多封银行账单转发成一个包时，顶层正文往往只有「见附件」，
      //    真正的账单是包里的 .eml 附件。命中就走附件路径并结束；没命中（返回 null）
      //    说明是普通直发邮件，继续走下面原有逻辑，保证老流程不退化。
      const bundle = await processForwardedBundle({
        db,
        userId,
        top: parsedTop,
        parse: body => parseBillWithAI(aiConfig, body),
      })
      if (bundle) {
        // billsWritten = 0 也算「处理过但没什么可写」，用 skipped 与失败的解析区分开
        log.status = bundle.billsWritten > 0 ? 'success' : 'skipped'
        log.error_msg = bundle.summary
        log.raw_ai_response = buildBundleLogPayload(bundle)
        await writeLog(db, log)
        if (bundle.billsWritten > 0) scheduleBillSync(env, ctx, userId)
        return
      }

      if (!emailBody.trim()) {
        log.status = 'skipped'
        log.error_msg = 'Empty email body'
        await writeLog(db, log)
        return
      }

      // 5. Parse bill with AI
      const aiResult = await parseBillWithAI(aiConfig, emailBody)
      log.raw_ai_response = JSON.stringify(aiResult)

      // 邮件类型门禁：自动扣款通知 / 还款提醒不是新一期账单。Chase 7491 的
      // 2026-10 重复账单就是 "automatic payment scheduled" 通知被当账单建出来的
      //（金额、到期日与 9 月那行完全相同）。AI 没给 email_kind 时退回 is_bill 判定。
      if (aiResult.email_kind && aiResult.email_kind !== 'statement') {
        log.status = 'skipped'
        log.error_msg = `非账单邮件（email_kind=${aiResult.email_kind}），不建账单`
        await writeLog(db, log)
        return
      }

      // 0 元账单（本期已还清）是合法数据：bill_amount 用 == null 判空而不是 falsy，
      // 否则 !0 会把应还 0 元的账单误判成缺字段跳过。due_date 同理——无需还款
      // 就没有还款截止日，金额为 0 时放宽。
      const zeroBill = Number(aiResult.bill_amount) === 0
      if (
        aiResult.is_bill === false ||
        !aiResult.bill_month ||
        aiResult.bill_amount == null || Number.isNaN(Number(aiResult.bill_amount)) ||
        (!zeroBill && !aiResult.due_date)
      ) {
        log.status = 'skipped'
        log.error_msg = 'Not a bill email or missing required fields'
        await writeLog(db, log)
        return
      }

      // 6. Find matching credit_card
      // 持卡人识别 + 找卡/建卡，与转发包路径同口径：
      //   To 头显示名 > 正文称呼 > 默认持卡人，识别出谁就在谁名下找卡；
      //   找不到且（尾号 + 银行名能匹配卡产品）时自动建卡到该持卡人。
      // 建卡前提缺一个都不硬造，否则美国卡会被挂到 CNY 产品上、无尾号邮件每次都造新卡。
      let cardNote = ''
      const scope = await loadHolderScope(db, userId)
      const headerName = extractHeaderDisplayName(toHeader)
      const bodyName = extractNameFromBody(emailBody)
      const resolution = resolveHolder({
        holders: scope.holders,
        defaultHolderId: scope.defaultHolderId,
        headerName,
        bodyName,
      })
      if (!resolution.holderId) {
          log.status = 'failed'
          log.error_msg = '未找到持卡人，无法自动建卡，请先在界面添加持卡人'
          await writeLog(db, log)
          return
      }
      let cardId: string | null = null
      // 归属不可信（回落默认持卡人）时绝不自动建卡：凭猜测把新卡挂到某个人
      // 名下就是 2026-10-16 民生 0872 挂错人的根因。落待确认草稿等人工选卡。
      const trusted = resolution.source === 'header_name' || resolution.source === 'body_honorific'
      const created = await findOrCreateCardForHolder(db, {
        holderId: resolution.holderId,
        cardTail: aiResult.card_last4 ?? null,
        bankName: aiResult.bank_name ?? null,
        currency: aiResult.currency ?? null,
        statementDate: aiResult.statement_date ?? null,
        statementDay: aiResult.statement_day ?? null,
        dueDate: aiResult.due_date ?? null,
        receivedDate: parsedTop.headers.date ?? null,
        allowCreate: trusted,
      })
      if (!created.ok) {
          if (created.needsDraft) {
            await parkBillAsDraft(db, userId, aiResult as unknown as Record<string, unknown>)
            log.status = 'skipped'
            log.error_msg = `${created.reason}｜草稿已保存`
          } else {
            log.status = 'failed'
            log.error_msg = created.reason
          }
          await writeLog(db, log)
          return
      }
      cardId = created.cardId
      cardNote = created.created ? `已自动创建卡片（尾号 ${aiResult.card_last4}，银行「${aiResult.bank_name}」）；` : ''
      const sourceLabel: Record<string, string> = {
        header_name: 'To 头显示名',
        body_honorific: '正文称呼',
        default_holder: '默认持卡人',
      }
     cardNote += `归属依据：${sourceLabel[resolution.source] ?? resolution.source}；`

      // 7. Upsert bill (idempotent: unique on card_id + bill_month)
      // 与附件路径共用 upsertBillForCard：0 元账单的 due_date 兜底、重发邮件不把
      // 已还清账单打回未还款（keepPaidStatus）这些口径必须两条路径一致，直发路径
      // 曾经自带一份内联 SQL，非 0 元重发时会把 paid 覆盖回 unpaid。
      const outcome = await upsertBillForCard(db, cardId, aiResult, { trusted })
      const billId = outcome.billId

      // 每期账单落库后回写卡档账单日（有出账日证据互相印证才动），
      // 解决「账单日只在建卡时写一次、之后永远残留旧值」的问题。
      const billingDayUpdated = await syncBillingDayFromBill(db, cardId, aiResult)
      if (billingDayUpdated) {
        cardNote += '已按本期出账日修正卡档账单日；'
      }

      // 8. Write success log
      log.bill_id = billId
      log.status = 'success'
      if (cardNote) log.error_msg = cardNote + '账单已写入'
      await writeLog(db, log)
      if (outcome.action !== 'preserved' || billingDayUpdated) scheduleBillSync(env, ctx, userId)
    } catch (err) {
      log.status = 'failed'
      log.error_msg = err instanceof Error ? err.message : String(err)
      await writeLog(db, log)
      console.error('[email-worker] Error processing email:', err)
    }
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(email: string | null): string | null {
  return email?.trim().toLowerCase() ?? null
}

function getHeader(message: ForwardableEmailMessage, name: string): string | null {
  try {
    return message.headers.get(name) ?? null
  } catch {
    return null
  }
}

function parseUserId(to: string): string | null {
  // Pattern: bills+{userId}@domain
  const match = to.match(/bills\+([a-f0-9-]{36})@/i)
  return match ? match[1] : null
}

function extractSubject(message: ForwardableEmailMessage): string | null {
  return getHeader(message, 'subject')
}

// ─── Log writer ───────────────────────────────────────────────────────────────

async function writeLog(db: D1Database, log: EmailParseLogRow): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO email_parse_logs (id, user_id, from_email, subject, bill_id, status, error_msg, raw_ai_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), log.user_id, log.from_email, log.subject,
      log.bill_id, log.status, log.error_msg, log.raw_ai_response
    ).run()
  } catch (err) {
    console.error('[email-worker] Failed to write email_parse_logs:', err)
  }
}
