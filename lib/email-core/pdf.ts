import { decryptPDF as unlockSupportedPdf, isEncrypted } from '@pdfsmaller/pdf-decrypt'
import { PDFDocument } from 'pdf-lib'
import { getDocumentProxy } from './unpdf-runtime.mjs'
import { MAX_ATTACHMENT_BYTES } from './mime'
import { decryptVaultPassword } from './vault-crypto'
import { decryptLegacyPdf } from './pdf-legacy'

const MAX_TEXT = 16_000
const VISION_THRESHOLD = 4 * 1024 * 1024
const MAX_VAULT_RULES = 8

interface PdfOptions {
  db?: D1Database
  userId: string
  secret?: string
  adhocPassword?: string | null
  holderId?: string | null
  bankId?: string | null
  context?: string
}

interface VaultRule {
  id: string
  password_ciphertext: string
  hint: string | null
}

export type PdfDecryptResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'wrong_password' | 'unsupported' }

export type PreparedStatementPdf =
  | { status: 'ready'; bytes: Uint8Array; text: string | null; visionBytes: Uint8Array | null }
  | { status: 'needs_password'; suggestedHint: string | null }
  | { status: 'parse_failed'; error: string }

export function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45
}

async function readEncryption(bytes: Uint8Array): Promise<boolean> {
  try {
    return (await isEncrypted(bytes)).encrypted
  } catch {
    // The dependency's probe also validates the encryption revision.
    return (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted
  }
}

/** Public adapter for the API unlock action. Library errors are never returned to callers. */
export async function decryptPDF(bytes: Uint8Array, password: string): Promise<PdfDecryptResult> {
  if (!hasPdfHeader(bytes) || bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'unsupported' }
  try {
    if (!(await readEncryption(bytes))) return { ok: true, bytes }
    return await unlockEncryptedPdf(bytes, password)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
}

async function unlockEncryptedPdf(bytes: Uint8Array, password: string): Promise<PdfDecryptResult> {
  try {
    return { ok: true, bytes: await unlockSupportedPdf(bytes, password) }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Incorrect password')) {
      return { ok: false, reason: 'wrong_password' }
    }
    return decryptLegacyPdf(bytes, password)
  }
}

function loadVaultRules(db: D1Database, options: PdfOptions): Promise<D1Result<VaultRule>> {
  return db.prepare(
    `WITH owned_rules AS (
       SELECT id, password_ciphertext, hint, holder_id, bank_id, bank_keyword, last_used_at, use_count, created_at
       FROM statement_password_vault
       WHERE user_id = ? AND (holder_id = ? OR holder_id IS NULL)
     ), ranked AS (
       SELECT *, CASE
         WHEN (bank_id = ? OR (trim(COALESCE(bank_keyword, '')) <> ''
           AND instr(?, lower(trim(bank_keyword))) > 0)) THEN CASE WHEN holder_id IS NULL THEN 3 ELSE 1 END
         WHEN bank_id IS NULL AND trim(COALESCE(bank_keyword, '')) = '' THEN CASE WHEN holder_id IS NULL THEN 4 ELSE 2 END
         ELSE 5 END AS priority
       FROM owned_rules
     )
     SELECT id, password_ciphertext, hint FROM ranked WHERE priority < 5
     ORDER BY priority, last_used_at DESC, use_count DESC, created_at ASC, id ASC LIMIT ?`,
  ).bind(options.userId, options.holderId ?? null, options.bankId ?? null,
    (options.context ?? '').toLowerCase(), MAX_VAULT_RULES).all<VaultRule>()
}

function defaultPasswordHint(context: string): string | null {
  return /建设银行|\bccb\b|汇丰|\bhsbc\b|中银|中国银行|\bboc\b/i.test(context)
    ? '请查看银行邮件中的月结单密码说明'
    : null
}

async function unlockWithVault(bytes: Uint8Array, options: PdfOptions): Promise<
  { status: 'unlocked'; bytes: Uint8Array } | Exclude<PreparedStatementPdf, { status: 'ready' }>
> {
  const rules = options.db && options.secret ? (await loadVaultRules(options.db, options)).results : []
  const attempted = new Set<string>()
  if (options.adhocPassword) {
    attempted.add(options.adhocPassword)
    const result = await unlockEncryptedPdf(bytes, options.adhocPassword)
    if (result.ok) return { status: 'unlocked', bytes: result.bytes }
    if (result.reason === 'unsupported') return { status: 'parse_failed', error: '暂不支持此 PDF 的加密方式' }
  }
  for (const rule of rules) {
    let password: string
    try {
      password = await decryptVaultPassword(rule.password_ciphertext, options.secret!, options.userId)
    } catch {
      continue
    }
    if (attempted.has(password)) continue
    attempted.add(password)
    const result = await unlockEncryptedPdf(bytes, password)
    if (!result.ok) {
      if (result.reason === 'unsupported') return { status: 'parse_failed', error: '暂不支持此 PDF 的加密方式' }
      continue
    }
    await options.db!.prepare(
      `UPDATE statement_password_vault SET use_count = use_count + 1,
       last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND user_id = ?`,
    ).bind(rule.id, options.userId).run()
    return { status: 'unlocked', bytes: result.bytes }
  }
  return {
    status: 'needs_password',
    suggestedHint: rules.find(rule => rule.hint)?.hint ?? defaultPasswordHint(options.context ?? ''),
  }
}

export function isExtractedPdfTextUsable(text: string): boolean {
  // PDF text can mix ordinary whitespace, control characters and unmapped glyphs.
  const compact = text.replace(/\s/g, '')
  const bad = [...compact].filter(char => {
    const code = char.charCodeAt(0)
    return code === 0xfffd || code < 32 || (code >= 127 && code < 160) || (code >= 0xe000 && code <= 0xf8ff)
  }).length
  return compact.length >= 80 && bad / compact.length < 0.1 && /\d/.test(compact)
}

async function extractPdfPages(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // PDF.js can transfer ownership of its input buffer.
  const doc = await getDocumentProxy(bytes.slice(), { useSystemFonts: false, disableFontFace: true })
  try {
    const chunks: string[] = []
    const firstPages = Array.from({ length: Math.min(doc.numPages, 6) }, (_, index) => index + 1)
    if (doc.numPages > 6) firstPages.push(doc.numPages)
    const firstPageBudget = doc.numPages > 6 ? Math.floor(MAX_TEXT * 0.8) : MAX_TEXT
    let length = 0
    for (const number of firstPages) {
      const budget = number > 6 ? MAX_TEXT - length : firstPageBudget - length
      if (budget <= 1) continue
      const page = await doc.getPage(number)
      try {
        const content = await page.getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')
          .join('').trim().slice(0, budget - 1)
        chunks.push(text)
        length += text.length + 1
      } finally {
        page.cleanup()
      }
    }
    return { text: chunks.join('\n'), pageCount: doc.numPages }
  } finally {
    await doc.loadingTask.destroy()
  }
}

async function visionPdf(bytes: Uint8Array, pageCount?: number): Promise<Uint8Array> {
  if (bytes.length <= VISION_THRESHOLD || (pageCount !== undefined && pageCount <= 5)) return bytes
  const source = await PDFDocument.load(bytes, { updateMetadata: false })
  if (source.getPageCount() <= 5) return bytes
  const target = await PDFDocument.create()
  const pages = await target.copyPages(source, [0, 1, 2, 3, source.getPageCount() - 1])
  for (const page of pages) target.addPage(page)
  return target.save()
}

export async function prepareStatementPdf(input: Uint8Array, options: PdfOptions): Promise<PreparedStatementPdf> {
  if (!hasPdfHeader(input) || input.length > MAX_ATTACHMENT_BYTES) {
    return { status: 'parse_failed', error: 'PDF 格式无效或超过大小上限' }
  }
  try {
    let bytes = input
    if (await readEncryption(input)) {
      const result = await unlockWithVault(input, options)
      if (result.status !== 'unlocked') return result
      bytes = result.bytes
    }
    const extracted = await extractPdfPages(bytes).catch(() => null)
    if (extracted && isExtractedPdfTextUsable(extracted.text)) {
      return { status: 'ready', bytes, text: extracted.text, visionBytes: null }
    }
    return { status: 'ready', bytes, text: null, visionBytes: await visionPdf(bytes, extracted?.pageCount) }
  } catch {
    return { status: 'parse_failed', error: '无法读取 PDF 账单' }
  }
}
