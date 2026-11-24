import { loadAiConfig } from './ai'
import {
  extractNestedBillMessages, loadHolderScope, resolveBillAttribution, syncBillingDayFromBill,
  syncCreditLimitFromBill, upsertBillForCard, type BillAttributionInput, type HolderScope,
} from './bills'
import { isExactDueDate } from './due-date'
import { extractNameFromBody, isEmlAttachment } from './holders'
import { decodeMimeHeaderValue, extractHeaderDisplayName } from './mime'
import { normalizeStatementEnvelope, parseMultimodalStatement, sniffStatementImage, type StatementParseOutcome } from './multimodal'
import { hasPdfHeader } from './pdf'
import type { AttributionResolution, BillParseResult, NestedBillMessage, ParsedRawMessage, ParsedStatementItem, RawAttachment } from './types'

export interface EmailIngestOptions {
  db: D1Database
  userId: string
  top: ParsedRawMessage
  bucket?: R2Bucket | null
  imagesBinding?: Pick<ImagesBinding, 'input'>
  secret?: string
  /** Stable for retries of one delivery. Scope is further constrained by userId. */
  deliveryId: string
  connection?: {
    id: string
    email: string
    label: string | null
    defaultHolderId: string | null
    attributionMode: BillAttributionInput['attributionMode']
  }
  parseText?: (text: string) => Promise<BillParseResult>
}

export interface EmailIngestResult {
  billIds: string[]
  draftIds: string[]
  nestedCount: number
  billingDayChanged: boolean
  confidence: number | null
  reason: string | null
}

function binaries(attachments: RawAttachment[]): RawAttachment[] {
  return attachments.filter(file => hasPdfHeader(file.bytes) ||
    (file.contentType === 'application/pdf' && !isEmlAttachment(file)) ||
    ((file.filename || !file.contentId) && sniffStatementImage(file.bytes) && (!file.contentId || file.bytes.length >= 16_384)))
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

async function identity(...values: Array<string | number>): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(values)))
}

function safeName(filename: string): string {
  return filename.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(-120) || 'statement'
}

interface StorageContext {
  base: EmailIngestOptions
  groupKey: string
  recordId: string
  recordType: 'draft' | 'bill'
  files: RawAttachment[]
  preparedPdf?: Uint8Array
}

async function prepareAttachments(context: StorageContext): Promise<{
  ids: string[]; originalHash: string | null; inserts: D1PreparedStatement[]
}> {
  const { base, groupKey, recordId, recordType, files, preparedPdf } = context
  const ids: string[] = []
  const inserts: D1PreparedStatement[] = []
  let originalHash: string | null = null
  for (const [index, file] of files.entries()) {
    const hash = await sha256(file.bytes)
    originalHash ??= hash
    if (!base.bucket) continue
    const id = 'mail_file_' + await identity(groupKey, recordType, recordId, index, hash)
    ids.push(id)
    const alreadyStored = await base.db.prepare('SELECT id FROM record_attachments WHERE id = ?').bind(id).first()
    if (alreadyStored) continue
    const bytes = preparedPdf && hasPdfHeader(file.bytes) ? preparedPdf : file.bytes
    const mime = hasPdfHeader(file.bytes) ? 'application/pdf' : sniffStatementImage(file.bytes) ?? 'application/octet-stream'
    const prefix = recordType === 'draft' ? `draft-files/${base.userId}/${recordId}` : `bill/${recordId}`
    const key = `${prefix}/${id}-${safeName(file.filename)}`
    await base.bucket.put(key, bytes as Uint8Array<ArrayBuffer>, { httpMetadata: { contentType: mime } })
    inserts.push(base.db.prepare(
      `INSERT INTO record_attachments (id, record_type, record_id, bucket, storage_path, file_name, file_type,
        file_size, uploaded_by, sha256) VALUES (?, ?, ?, 'record-attachments', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, recordType, recordId, key, file.filename || 'statement', mime, bytes.length, base.userId,
      bytes === file.bytes ? hash : await sha256(bytes)))
  }
  return { ids, originalHash, inserts }
}

interface DraftInput {
  base: EmailIngestOptions
  groupKey: string
  text: string
  files: RawAttachment[]
  entries: Array<{ statement?: ParsedStatementItem; attribution?: AttributionResolution; reason: string }>
  outcome: StatementParseOutcome
}

async function parkEmailDrafts(input: DraftInput): Promise<string[]> {
  const { base, groupKey, text, files, entries, outcome } = input
  const ids = entries.map((_, index) => `draft_mail_${groupKey}_${index}`)
  const first = await base.db.prepare('SELECT id FROM bill_import_drafts WHERE id = ?').bind(ids[0]).first()
  if (first) return ids
  const filesToStore = await prepareAttachments({
    base, groupKey, recordId: ids[0], recordType: 'draft', files,
    preparedPdf: outcome.status === 'needs_password' ? undefined : outcome.preparedPdf,
  })
  const statements = entries.map(({ statement, attribution, reason }, index) => {
    const payload = {
      ...statement,
      warnings: [...(statement?.warnings ?? []), reason],
      candidate_card_ids: attribution?.candidateCardIds ?? [],
      attachment_ids: filesToStore.ids,
    }
    return base.db.prepare(
      `INSERT INTO bill_import_drafts (
         id, created_by, card_id, matched_account_id, source_type, raw_text, file_ref, parsed_payload, confidence,
         parse_status, holder_id, attribution_source, attribution_trusted, source_connection_id, source_label,
         batch_id, file_sha256, password_hint, error_message, updated_at
       ) VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO NOTHING`,
    ).bind(ids[index], base.userId, attribution?.cardId ?? null, attribution?.accountId ?? null,
      text.slice(0, 2000) || null, filesToStore.ids[0] ?? null, JSON.stringify(payload), statement?.confidence ?? null,
      outcome.status, attribution?.holderId ?? null, attribution?.source ?? 'unknown', attribution?.trusted ? 1 : 0,
      base.connection?.id ?? null, base.connection?.label ?? base.connection?.email ?? '邮件转发',
      entries.length > 1 ? groupKey : null, filesToStore.originalHash,
      outcome.status === 'needs_password' ? outcome.suggestedHint : null,
      outcome.status === 'parse_failed' ? outcome.error : null)
  })
  if (outcome.status === 'needs_password') {
    statements.push(base.db.prepare(
      `INSERT INTO notification_history (id, user_id, notification_key, category, title, body, target_url, status)
       VALUES (?, ?, ?, 'system', '账单附件需要密码', '请在草稿箱解锁银行月结单。', ?, 'sent')
       ON CONFLICT(user_id, notification_key) DO NOTHING`,
    ).bind(crypto.randomUUID(), base.userId, `statement_password:${ids[0]}`, `/bills?draftId=${ids[0]}`))
  }
  await base.db.batch([...filesToStore.inserts, ...statements])
  return ids
}

function mayAutoCommit(statement: ParsedStatementItem, attribution: AttributionResolution): string | null {
  if (!statement.is_bill || statement.email_kind !== 'statement') return '未识别为正式月结单'
  if ((statement.confidence ?? 0) < 0.85) return '识别置信度不足，请核对'
  if (!Number.isFinite(statement.bill_amount) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(statement.bill_month ?? '') ||
      (statement.bill_amount !== 0 && (statement.due_date_status !== 'exact' || !isExactDueDate(statement.due_date)))) {
    return '缺少应还金额、账期或确切还款日，请补全'
  }
  if (!statement.currency) return '缺少账单币种，请核对'
  if (!attribution.trusted || !attribution.cardId) {
    return attribution.source === 'conflict' ? '持卡人或卡片归属冲突，请选择正确的卡片' : '未匹配到已存在的卡片，请确认'
  }
  return null
}

async function importPreference(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT import_config FROM user_preferences WHERE user_id = ?')
    .bind(userId).first<{ import_config: string }>()
  try {
    return !row || JSON.parse(row.import_config)?.auto_commit_trusted_email !== false
  } catch {
    return false
  }
}

interface AttachmentGroup {
  message: NestedBillMessage
  files: RawAttachment[]
  position: string
  multipleDocuments: boolean
}

function messageGroups(top: ParsedRawMessage): { groups: AttachmentGroup[]; nestedCount: number } {
  const nested = extractNestedBillMessages(top.attachments)
  const topFiles = binaries(top.attachments)
  const root: NestedBillMessage = {
    label: '', subject: decodeMimeHeaderValue(top.headers.subject), from: top.headers.from,
    to: top.headers.to, date: top.headers.date, text: top.text, attachments: top.attachments,
    headerName: extractHeaderDisplayName(top.headers.to), bodyName: extractNameFromBody(top.text),
  }
  const messages = nested.length && !topFiles.length ? nested : [root, ...nested]
  const groups = messages.flatMap((message, index): AttachmentGroup[] => {
    const files = binaries(message.attachments)
    const pdfs = files.filter(file => hasPdfHeader(file.bytes) || file.contentType === 'application/pdf')
    const images = files.filter(file => !pdfs.includes(file))
    const units = [...pdfs.map(pdf => [pdf]), ...(images.length ? [images] : [])]
    if (!units.length) units.push([])
    return units.map((files, fileIndex) => ({
      message, files, position: `${index}:${fileIndex}`, multipleDocuments: units.length > 1,
    }))
  })
  return { groups, nestedCount: nested.length }
}

async function guessedBankId(db: D1Database, context: string): Promise<string | null> {
  const bank = await db.prepare(
    `SELECT id FROM banks WHERE instr(?, lower(name)) > 0
       OR (trim(COALESCE(short_name, '')) <> '' AND instr(?, lower(short_name)) > 0)
     ORDER BY length(name) DESC, id LIMIT 1`,
  ).bind(context.toLowerCase(), context.toLowerCase()).first<{ id: string }>()
  return bank?.id ?? null
}

async function parseGroup(
  base: EmailIngestOptions, group: AttachmentGroup, scope: HolderScope, config: Awaited<ReturnType<typeof loadAiConfig>>,
): Promise<StatementParseOutcome> {
  const { message, files } = group
  if (!files.length && base.parseText) {
    return { status: 'ready', envelope: normalizeStatementEnvelope(await base.parseText(message.text)) }
  }
  const pdf = files.find(file => hasPdfHeader(file.bytes) || file.contentType === 'application/pdf')
  const context = [message.from, message.subject, ...files.map(file => file.filename), message.text].filter(Boolean).join('\n')
  const holder = pdf && base.secret ? await resolveBillAttribution(base.db, {
    userId: base.userId, statement: { is_bill: true }, headerName: message.headerName,
    bodyName: message.bodyName, recipient: message.to ?? base.connection?.email,
    defaultHolderId: base.connection?.defaultHolderId, attributionMode: base.connection?.attributionMode,
  }, scope) : null
  return parseMultimodalStatement({
    config, userId: base.userId, db: base.db, secret: base.secret, holderId: holder?.holderId,
    bankId: pdf && base.secret ? await guessedBankId(base.db, context) : undefined, context,
    text: message.text, fromEmail: message.from, subject: message.subject, pdf,
    images: pdf ? undefined : files, imagesBinding: base.imagesBinding,
  })
}

/** Shared Email Routing and Gmail ingestion. Only verified existing card/account targets can be auto-posted. */
export async function ingestStatementEmail(base: EmailIngestOptions): Promise<EmailIngestResult> {
  const { groups, nestedCount } = messageGroups(base.top)
  const result: EmailIngestResult = { billIds: [], draftIds: [], nestedCount, billingDayChanged: false, confidence: null, reason: null }
  const [scope, autoCommit, config] = await Promise.all([
    loadHolderScope(base.db, base.userId), importPreference(base.db, base.userId), loadAiConfig(base.db),
  ])
  for (const group of groups) {
    const { message, files } = group
    if (!files.length && !message.text.trim()) continue
    const groupKey = await identity(base.userId, base.deliveryId, group.position)
    const outcome = await parseGroup(base, group, scope, config)
    let entries: DraftInput['entries']
    if (outcome.status === 'ready') {
      if (!outcome.envelope.is_bill) {
        result.reason ??= '非账单邮件'
        continue
      }
      entries = []
      for (const statement of outcome.envelope.statements) {
        const attribution = await resolveBillAttribution(base.db, {
          userId: base.userId, statement, headerName: message.headerName, bodyName: message.bodyName,
          recipient: [message.to, base.connection?.email].filter(Boolean).join(', '),
          defaultHolderId: base.connection?.defaultHolderId, attributionMode: base.connection?.attributionMode,
        }, scope)
        result.confidence ??= statement.confidence ?? null
        let reason = !autoCommit ? '已关闭可信邮件自动入账'
          : group.multipleDocuments || outcome.envelope.statements.length > 1 ? '一封邮件含多份账单或多个币种，请分别核对'
          : mayAutoCommit(statement, attribution)
        if (!reason && attribution.cardId) {
          const posted = await upsertBillForCard(base.db, attribution.cardId, statement, { trusted: true, protectExisting: true })
          if (posted.action === 'preserved') {
            reason = posted.reason ?? '已有账单存在冲突，请确认'
          } else {
            const stored = await prepareAttachments({
              base, files, groupKey, recordId: posted.billId, recordType: 'bill', preparedPdf: outcome.preparedPdf,
            })
            if (stored.inserts.length) await base.db.batch(stored.inserts)
            const changed = await syncBillingDayFromBill(base.db, attribution.cardId, statement)
            result.billingDayChanged ||= changed
            await syncCreditLimitFromBill(base.db, attribution.cardId, statement)
            result.billIds.push(posted.billId)
            continue
          }
        }
        entries.push({ statement, attribution, reason: reason ?? '请确认账单字段' })
      }
    } else {
      entries = [{ reason: outcome.status === 'needs_password' ? 'PDF 需要密码' : outcome.error }]
    }
    if (entries.length) {
      result.reason ??= entries[0].reason
      result.draftIds.push(...await parkEmailDrafts({
        base, groupKey, text: message.text, files, entries, outcome,
      }))
    }
  }
  return result
}
