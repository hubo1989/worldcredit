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

import type { Env, AiConfig, BillParseResult, EmailParseLogRow } from './types'
import { parseRawMessage, streamToBytes } from './mime'
import { buildBundleLogPayload, processForwardedBundle } from './forwarded'
import {
  findOrCreateCardForHolder,
  loadHolderScope,
  parkBillAsDraft,
  syncBillingDayFromBill,
  upsertBillForCard,
} from './bills'
import { extractHeaderDisplayName } from './mime'
import { extractNameFromBody, resolveHolder } from './holders'
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
      if (outcome.action !== 'preserved') scheduleBillSync(env, ctx, userId)
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

/**
 * Read the LLM endpoint from system_settings.
 *
 * The admin console writes three independent keys (ai_api_key / ai_base_url /
 * ai_model) via updateSystemSettings, which is the same shape the app's AI
 * features read. Older builds of this worker read a single 'ai_config' blob
 * that nothing ever wrote, so bill parsing could never authenticate. We read
 * the product's keys first and keep 'ai_config' as a fallback for any
 * deployment that still stores that shape.
 */
async function loadAiConfig(db: D1Database): Promise<AiConfig> {
  const rows = await db.prepare(
    "SELECT key, value FROM system_settings WHERE key IN ('ai_api_key', 'ai_base_url', 'ai_model', 'ai_config')"
  ).all<{ key: string; value: string }>()

  const settings = new Map<string, unknown>()
  for (const row of rows.results || []) {
    try {
      settings.set(row.key, JSON.parse(row.value))
    } catch {
      settings.set(row.key, row.value)
    }
  }

  const legacy = settings.get('ai_config')
  const legacyConfig =
    legacy && typeof legacy === 'object' ? (legacy as Partial<AiConfig>) : undefined

  const pick = (key: string, legacyValue?: string): string => {
    const value = settings.get(key)
    return (typeof value === 'string' && value) || legacyValue || ''
  }

  return {
    apiKey: pick('ai_api_key', legacyConfig?.apiKey),
    baseURL: pick('ai_base_url', legacyConfig?.baseURL) || 'https://api.openai.com/v1',
    model: pick('ai_model', legacyConfig?.model) || 'gpt-4o',
  }
}

// ─── OpenAI bill parser ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是银行账单解析助手。从邮件内容中提取信用卡账单信息，以 JSON 格式返回：
{"is_bill":true,"email_kind":"statement","bank_name":"","card_last4":"","bill_amount":0,"min_payment":null,"due_date":"YYYY-MM-DD","bill_month":"YYYY-MM","statement_date":null,"statement_day":null,"currency":"CNY","confidence":0.9}
字段 card_last4 请填邮件中出现的"卡号/账户结尾"完整数字，不要截断：
- 大陆/香港卡通常是末 4 位，如 "1234"
- American Express 的账户结尾是 5 位，如 "93001"，请原样填 5 位
- 如邮件明确给出更长结尾（如 6 位 "671006"），也请原样填写
不要把它补零或改写。若邮件中没有出现任何卡号/账户结尾，填 null。
email_kind 是邮件类型，按实际内容选：
- "statement"：本期账单/电子对账单（含本期应还金额和还款日）
- "autopay_scheduled"：自动还款/扣款计划通知（如 "automatic payment scheduled"）
- "payment_reminder"：还款提醒/催缴通知
- "other"：营销或其他
只有 email_kind 是 "statement" 时 is_bill 才为 true；自动扣款通知、还款提醒即使提到金额和还款日，也不是新一期账单，is_bill 必须为 false（它们对应的那期账单已由真正的账单邮件建过，再解析会造出重复账单）。
statement_date 只在邮件明确给出本期出账日/Statement Date（完整日期）时填写。注意：自动扣款通知里的 "Statement balance as of Oct 16" 不是出账日，不要填进 statement_date。
statement_day 只在邮件正文明确写出「账单日」及其数值（如「账单日 09」「账单日：每月21日」「Statement day: 22」）时填 1-31 的整数。不要从账期起止日期、还款日或 statement_date 推算；没有就填 null。
如果不是账单邮件，返回 {"is_bill": false}
只返回 JSON。`

async function parseBillWithAI(config: AiConfig, emailBody: string): Promise<BillParseResult> {
  const endpoint = config.baseURL.replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model, temperature: 0,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: emailBody }],
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 500)}`)
  }
  const json = await res.json() as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as BillParseResult
}

// ─── Card lookup ──────────────────────────────────────────────────────────────

/**
 * Match a parsed bill to one of the user's cards.
 *
 * Card tails are compared on the full stored value (4 digits for CN/HK cards,
 * 5-6 for American Express), so an Amex account matches on its real ending
 * (93001) instead of a value truncated to 9300.
 *
 * Deliberately no last-4 fallback: 671006 and 71006 are different Amex
 * accounts that share the suffix 1006, so falling back to four digits would
 * silently attach one account's bill to the other. An unmatched tail is worth
 * more than a wrong one, so this returns null and the caller logs the miss.
 */
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
