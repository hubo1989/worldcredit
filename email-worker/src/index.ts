/**
 * WorldCredit Email Worker
 *
 * Triggered by Cloudflare Email Routing for all mail delivered to
 * bills+{userId}@20160325.xyz
 *
 * Flow:
 *   1. Parse userId from the To address (between + and @)
 *   2. Decode the raw MIME message and extract readable text
 *   3. Fetch ai_config (OpenAI key / baseURL / model) from system_settings
 *   4. Call OpenAI to extract bill fields from the email body
 *   5. Look up the matching credit_card row for this user
 *   6. Upsert a bills row (idempotent: unique on card_id + bill_month)
 *   7. Write an email_parse_logs row for audit / debugging
 */

import type { Env, AiConfig, BillParseResult, BillRow, EmailParseLogRow } from './types'
import { InsForgeClient } from './insforge'
import { streamToString, extractTextFromRaw } from './mime'

// ─── Entry point ─────────────────────────────────────────────────────────────

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const db = new InsForgeClient(env.INSFORGE_URL, env.INSFORGE_SERVICE_KEY)

    const fromEmail = message.from ?? null
    // message.to may be undefined in some runtime versions; fall back to headers
    const toHeader = message.to ?? ''
    const subject = extractSubject(message)

    // ── 1. Parse userId from To address ──────────────────────────────────────
    const userId = parseUserId(toHeader)
    if (!userId) {
      console.warn(`[email-worker] Cannot parse userId from To="${toHeader}"; dropping.`)
      return
    }

    const log: EmailParseLogRow = {
      user_id: userId,
      from_email: fromEmail,
      subject,
      bill_id: null,
      status: 'failed',
      error_msg: null,
      raw_ai_response: null,
    }

    try {
      // ── 2. Read raw email body ──────────────────────────────────────────────
      const rawStream = message.raw
      const rawText = await streamToString(rawStream)
      const emailBody = extractTextFromRaw(rawText)

      if (!emailBody.trim()) {
        log.status = 'skipped'
        log.error_msg = 'Empty email body'
        await writeLog(db, log)
        return
      }

      // ── 3. Fetch ai_config from system_settings ────────────────────────────
      const settings = await db.select<{ key: string; value: AiConfig }>(
        'system_settings',
        'key=eq.ai_config&select=key,value'
      )
      if (!settings.length || !settings[0].value?.apiKey) {
        throw new Error('ai_config not found or missing apiKey in system_settings')
      }
      const aiConfig = settings[0].value

      // ── 4. Call OpenAI to parse bill ───────────────────────────────────────
      const aiResult = await parseBillWithAI(aiConfig, emailBody)
      log.raw_ai_response = JSON.stringify(aiResult)

      if (aiResult.is_bill === false || !aiResult.bill_month || !aiResult.due_date || !aiResult.bill_amount) {
        log.status = 'skipped'
        log.error_msg = 'Not a bill email or missing required fields'
        await writeLog(db, log)
        return
      }

      // ── 5. Find matching credit_card ───────────────────────────────────────
      const cardId = await findCardId(db, userId, aiResult.card_last4 ?? null)
      if (!cardId) {
        log.status = 'failed'
        log.error_msg = `暂未匹配到账户中对应的卡片（卡尾号：${aiResult.card_last4 || '未知'}），可点击【同步到本账户】自动建卡并导入账单`
        await writeLog(db, log)
        return
      }

      // ── 6. Upsert bills row ────────────────────────────────────────────────
      const billRow: BillRow = {
        card_id: cardId,
        bill_month: aiResult.bill_month,
        bill_amount: Number(aiResult.bill_amount),
        min_payment: aiResult.min_payment != null ? Number(aiResult.min_payment) : null,
        due_date: aiResult.due_date,
        statement_date: aiResult.statement_date ?? null,
        status: 'unpaid',
      }
      const upserted = await db.upsert<{ id: string }>('bills', billRow as unknown as Record<string, unknown>)
      const billId = upserted[0]?.id ?? null

      // ── 7. Write success log ──────────────────────────────────────────────
      log.status = 'success'
      log.bill_id = billId
      await writeLog(db, log)

      console.info(
        `[email-worker] Parsed bill for user=${userId} card=${cardId} month=${aiResult.bill_month} amount=${aiResult.bill_amount}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[email-worker] Error for user=${userId}:`, msg)
      log.status = 'failed'
      log.error_msg = msg.slice(0, 1000)
      await writeLog(db, log)
    }
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract userId from "bills+<uuid>@20160325.xyz"
 * Returns null if the address does not match the expected pattern.
 */
function parseUserId(to: string): string | null {
  // Handle "Display Name <bills+uuid@domain>" format
  const angleMatch = to.match(/<([^>]+)>/)
  const addr = angleMatch ? angleMatch[1] : to.trim()
  const m = addr.match(/\+([^@]+)@/)
  if (!m) return null
  const candidate = m[1]
  // Basic UUID validation (8-4-4-4-12)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    return null
  }
  return candidate
}

/**
 * Try to extract Subject from the ForwardableEmailMessage.
 * The Workers Email API exposes headers via message.headers (Headers object).
 */
function extractSubject(message: ForwardableEmailMessage): string | null {
  try {
    return message.headers.get('subject') ?? null
  } catch {
    return null
  }
}

// ─── OpenAI bill parser ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是银行账单解析助手。从以下邮件内容中提取信用卡账单信息，以 JSON 格式返回：
{
  "bank_name": "发卡行名称",
  "card_last4": "卡号后四位（如无则null）",
  "bill_amount": 账单总金额（数字）,
  "min_payment": 最低还款额（数字，如无则null）,
  "due_date": "还款截止日 YYYY-MM-DD",
  "bill_month": "账单月份 YYYY-MM",
  "statement_date": "账单日 YYYY-MM-DD（如无则null）",
  "currency": "货币代码如CNY/USD",
  "confidence": 0-1之间的置信度
}
如果不是账单邮件，返回 {"is_bill": false}
只返回 JSON，不要任何解释文字。`

async function parseBillWithAI(config: AiConfig, emailBody: string): Promise<BillParseResult> {
  const endpoint = config.baseURL.replace(/\/$/, '') + '/chat/completions'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: emailBody },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 500)}`)
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>
  }
  const content = json.choices?.[0]?.message?.content ?? '{}'
  return JSON.parse(content) as BillParseResult
}

// ─── Card lookup ──────────────────────────────────────────────────────────────

/**
 * Find the credit_card id for a given user.
 *
 * Strategy:
 *   1. Fetch all card_holders where created_by = userId
 *   2. Fetch all credit_cards where holder_id IN (those holder ids)
 *   3. If card_last4 is available, prefer the matching card; else take the only card
 *      (if multiple cards and no last4, return null so we don't guess wrong)
 */
async function findCardId(
  db: InsForgeClient,
  userId: string,
  cardLast4: string | null
): Promise<string | null> {
  // Step 1 – holders for this user
  const holders = await db.select<{ id: string }>(
    'card_holders',
    `created_by=eq.${encodeURIComponent(userId)}&select=id`
  )
  if (!holders.length) return null

  const holderIds = holders.map(h => h.id)

  // Step 2 – credit_cards for these holders
  // PostgREST: holder_id=in.(uuid1,uuid2,...)
  const inList = holderIds.map(id => encodeURIComponent(id)).join(',')
  const cards = await db.select<{ id: string; card_last4: string | null }>(
    'credit_cards',
    `holder_id=in.(${inList})&select=id,card_last4`
  )
  if (!cards.length) return null

  // Step 3 – match by last4
  if (cardLast4) {
    const match = cards.find(c => c.card_last4 === cardLast4)
    if (match) return match.id
    // If we have a last4 from AI but no card matches, still fall through to single-card case
  }

  // If exactly one card, use it
  if (cards.length === 1) return cards[0].id

  // Multiple cards, no last4 match → ambiguous
  return null
}

// ─── Log writer ───────────────────────────────────────────────────────────────

async function writeLog(db: InsForgeClient, log: EmailParseLogRow): Promise<void> {
  try {
    await db.insert('email_parse_logs', log as unknown as Record<string, unknown>)
  } catch (err) {
    // Log writing failure should never crash the worker
    console.error('[email-worker] Failed to write email_parse_logs:', err)
  }
}
