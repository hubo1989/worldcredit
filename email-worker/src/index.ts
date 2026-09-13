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
 * Uses D1 binding directly (no InsForge REST client).
 */

import type { Env, AiConfig, BillParseResult, EmailParseLogRow } from './types'
import { streamToString, extractTextFromRaw } from './mime'

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
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

    try {
      // 2. Read email body
      const rawText = await streamToString(message.raw)
      const emailBody = extractTextFromRaw(rawText)
      if (!emailBody.trim()) {
        log.status = 'skipped'
        log.error_msg = 'Empty email body'
        await writeLog(db, log)
        return
      }

      // 3. Fetch AI config
      const aiConfig = await loadAiConfig(db)
      if (!aiConfig.apiKey) {
        throw new Error('AI API Key 未配置（system_settings.ai_api_key）')
      }

      // 4. Parse bill with AI
      const aiResult = await parseBillWithAI(aiConfig, emailBody)
      log.raw_ai_response = JSON.stringify(aiResult)

      if (aiResult.is_bill === false || !aiResult.bill_month || !aiResult.due_date || !aiResult.bill_amount) {
        log.status = 'skipped'
        log.error_msg = 'Not a bill email or missing required fields'
        await writeLog(db, log)
        return
      }

      // 5. Find matching credit_card
      const cardId = await findCardId(db, userId, aiResult.card_last4 ?? null)
      if (!cardId) {
        log.status = 'failed'
        log.error_msg = `未匹配到卡片（尾号：${aiResult.card_last4 || '未知'}）`
        await writeLog(db, log)
        return
      }

      // 6. Upsert bill (idempotent: unique on card_id + bill_month)
      const existing = await db.prepare(
        'SELECT id FROM bills WHERE card_id = ? AND bill_month = ?'
      ).bind(cardId, aiResult.bill_month).first<{ id: string }>()

      let billId: string
      if (existing) {
        billId = existing.id
        await db.prepare(
          'UPDATE bills SET bill_amount = ?, min_payment = ?, due_date = ?, statement_date = ?, status = ? WHERE id = ?'
        ).bind(
          Number(aiResult.bill_amount),
          aiResult.min_payment != null ? Number(aiResult.min_payment) : null,
          aiResult.due_date, aiResult.statement_date ?? null, 'unpaid', billId
        ).run()
      } else {
        billId = crypto.randomUUID()
        await db.prepare(
          'INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, statement_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          billId, cardId, aiResult.bill_month, Number(aiResult.bill_amount),
          aiResult.min_payment != null ? Number(aiResult.min_payment) : null,
          aiResult.due_date, aiResult.statement_date ?? null, 'unpaid'
        ).run()
      }

      // 7. Write success log
      log.bill_id = billId
      log.status = 'success'
      await writeLog(db, log)
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
{"is_bill":true,"bank_name":"","card_last4":"","bill_amount":0,"min_payment":null,"due_date":"YYYY-MM-DD","bill_month":"YYYY-MM","statement_date":null,"currency":"CNY","confidence":0.9}
字段 card_last4 请填邮件中出现的"卡号/账户结尾"完整数字，不要截断：
- 大陆/香港卡通常是末 4 位，如 "1234"
- American Express 的账户结尾是 5 位，如 "93001"，请原样填 5 位
- 如邮件明确给出更长结尾（如 6 位 "671006"），也请原样填写
不要把它补零或改写。若邮件中没有出现任何卡号/账户结尾，填 null。
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
async function findCardId(db: D1Database, userId: string, cardTail: string | null): Promise<string | null> {
  const holders = await db.prepare(
    'SELECT id FROM card_holders WHERE created_by = ?'
  ).bind(userId).all<{ id: string }>()
  const holderIds = (holders.results || []).map(h => h.id)
  if (!holderIds.length) return null

  const placeholders = holderIds.map(() => '?').join(',')
  const cards = await db.prepare(
    `SELECT id, card_number_last4 FROM credit_cards WHERE holder_id IN (${placeholders})`
  ).bind(...holderIds).all<{ id: string; card_number_last4: string | null }>()
  const results = cards.results || []
  if (!results.length) return null

  const wanted = normalizeCardTail(cardTail)
  if (wanted) {
    const match = results.find(c => normalizeCardTail(c.card_number_last4) === wanted)
    if (match) return match.id
  }
  if (results.length === 1) return results[0].id
  return null
}

/** Card tails are digits only; keep leading zeros (Amex accounts like 01004). */
function normalizeCardTail(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
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
