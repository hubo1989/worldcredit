/**
 * WorldCredit Email Worker
 *
 * Triggered by Cloudflare Email Routing for mail delivered to:
 *   - bills+{userId}@20160325.xyz
 *   - bills@20160325.xyz, with From/Reply-To matched against bill_email_sources
 *
 * Uses D1 binding directly (no InsForge REST client).
 */

import type { Env, AiConfig, BillParseResult, BillRow, EmailParseLogRow } from './types'
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
    const senderCandidates = extractSenderCandidates(message, fromEmail)

    // 1. Resolve userId
    const userId = parseUserId(toHeader) ?? await findUserIdBySourceEmail(db, senderCandidates)
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

      // 3. Fetch ai_config
      const setting = await db.prepare(
        "SELECT value FROM system_settings WHERE key = 'ai_config'"
      ).first<{ value: string | AiConfig }>()
      if (!setting) throw new Error('ai_config not found in system_settings')
      const raw = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      const aiConfig = raw as AiConfig
      if (!aiConfig.apiKey) throw new Error('ai_config missing apiKey')

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

function extractSenderCandidates(message: ForwardableEmailMessage, primaryFrom: string | null): string[] {
  const candidates = new Set<string>()
  if (primaryFrom) candidates.add(primaryFrom)
  for (const headerName of ['reply-to', 'x-sender', 'return-path', 'sender']) {
    const normalized = normalizeEmail(getHeader(message, headerName))
    if (normalized) candidates.add(normalized)
  }
  return Array.from(candidates)
}

async function findUserIdBySourceEmail(db: D1Database, emails: string[]): Promise<string | null> {
  for (const email of emails) {
    const rows = await db.prepare(
      'SELECT user_id FROM bill_email_sources WHERE email = ? AND is_active = 1 LIMIT 2'
    ).bind(email).all<{ user_id: string }>()
    const results = rows.results || []
    if (results.length === 1) return results[0].user_id
    if (results.length > 1) {
      console.warn(`[email-worker] Ambiguous source email for ${email}`)
      return null
    }
  }
  return null
}

function extractSubject(message: ForwardableEmailMessage): string | null {
  return getHeader(message, 'subject')
}

// ─── OpenAI bill parser ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是银行账单解析助手。从邮件内容中提取信用卡账单信息，以 JSON 格式返回：
{"is_bill":true,"bank_name":"","card_last4":"","bill_amount":0,"min_payment":null,"due_date":"YYYY-MM-DD","bill_month":"YYYY-MM","statement_date":null,"currency":"CNY","confidence":0.9}
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

async function findCardId(db: D1Database, userId: string, cardLast4: string | null): Promise<string | null> {
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

  if (cardLast4) {
    const match = results.find(c => c.card_number_last4 === cardLast4)
    if (match) return match.id
  }
  if (results.length === 1) return results[0].id
  return null
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
