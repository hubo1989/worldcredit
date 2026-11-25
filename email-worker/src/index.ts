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
import { parseRawMessage, streamToBytes } from '../../lib/email-core/mime'
import { processEmailDelivery } from './forwarded'
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

    try {
      const owner = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
      if (!owner) {
        log.status = 'skipped'
        log.error_msg = '收件地址未关联有效账户'
        await writeLog(db, log)
        return
      }
      const raw = await streamToBytes(message.raw)
      // Gmail sends this verification mail before forwarding can start.
      if (fromEmail === 'forwarding-noreply@google.com') {
        const links = parseRawMessage(raw).text.match(/https:\/\/[^\s]+/g) ?? []
        const link = links.find(candidate => {
          try {
            const host = new URL(candidate).hostname
            return host === 'google.com' || host.endsWith('.google.com')
          } catch {
            return false
          }
        })
        log.status = 'skipped'
        log.error_msg = link ? `Gmail 转发验证链接: ${link}` : 'Gmail 验证邮件未找到验证链接'
        await writeLog(db, log)
        return
      }

      const outcome = await processEmailDelivery(raw, {
        db, userId, bucket: env.ATTACHMENTS, secret: env.SESSION_SECRET, imagesBinding: env.IMAGES,
      })
      log.bill_id = outcome.billIds[0] ?? null
      log.status = outcome.billIds.length ? 'success' : 'skipped'
      log.error_msg = outcome.reason
      log.raw_ai_response = JSON.stringify({
        nested_count: outcome.nestedCount, bill_ids: outcome.billIds, draft_ids: outcome.draftIds,
      })
      await writeLog(db, log)
      if (outcome.billIds.length) scheduleBillSync(env, ctx, userId)
    } catch {
      log.error_msg = '邮件读取或入库失败'
      await writeLog(db, log)
      console.error('[email-worker] 邮件读取或入库失败')
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
