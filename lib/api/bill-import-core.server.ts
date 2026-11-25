// 将手动导入交给共享账单解析器，并保留无 AI 配置的纯文本兜底。

import { queryOne } from '../db/helpers'
import { getDb, getWorkerEnv } from '../db/client'
import { loadAiConfig, parseBillWithAI } from '../email-core/ai'
import {
  parseMultimodalStatement,
  type StatementFile,
  type StatementParseOutcome,
} from '../email-core/multimodal'
import { decryptPDF, hasPdfHeader, type PdfDecryptResult } from '../email-core/pdf'
import type { ParsedStatementItem } from '../email-core/types'
import { tableColumns } from './schema-columns.server'
import { recognizeBillFromText } from '../billRecognizer'
import type { BillDraftPayload } from './billDrafts.server'

export type BillImportCoreParserKind = 'core' | 'ai_text' | 'offline_text' | 'none'

export interface BillImportCoreAttachment {
  attachmentId: string
  fileName: string
  contentType: string
  bytes: Uint8Array
  sha256: string
}

export interface BillImportCoreRequest {
  userId: string
  sourceType: 'text' | 'image' | 'pdf' | 'share_ios'
  rawText: string | null
  attachments: BillImportCoreAttachment[]
  pdfPassword: string | null
  holderId?: string | null
  cardId?: string | null
  /** 上一次解析失败的原因，供内核决定是否值得重试。 */
  previousError?: string | null
}

export interface BillImportCoreResult {
  /** 单币种月结单长度为 1；双币种按币种拆分，严禁跨币种求和。 */
  statements: BillDraftPayload[]
  isBill: boolean
  nonBillReason: string | null
  needsPassword: boolean
  passwordHint: string | null
  error: string | null
  parser: BillImportCoreParserKind
}

export type BillImportCoreParser = (req: BillImportCoreRequest) => Promise<BillImportCoreResult>

let coreParserOverride: BillImportCoreParser | null = null

export function __setBillImportCoreParserForTests(parser: BillImportCoreParser | null): void {
  coreParserOverride = parser
}

/** 无 AI Key 时的离线兜底置信度（HUB-154 §3.3 冻结值）。 */
export const OFFLINE_TEXT_FALLBACK_CONFIDENCE = 0.3

function emptyResult(parser: BillImportCoreParserKind): BillImportCoreResult {
  return {
    statements: [],
    isBill: false,
    nonBillReason: null,
    needsPassword: false,
    passwordHint: null,
    error: null,
    parser,
  }
}

/** 把 email-core 的解析项折算成草稿 payload（字段同名，只做补全）。 */
function toStatementPayload(parsed: ParsedStatementItem): BillDraftPayload {
  return {
    ...parsed,
    bank_name: parsed.bank_name ?? null,
    card_last4: parsed.card_last4 ?? null,
    bill_month: parsed.bill_month ?? parsed.statement_date?.slice(0, 7) ?? parsed.due_date?.slice(0, 7),
    statement_date: parsed.statement_date ?? undefined,
    bill_amount: parsed.bill_amount ?? null,
    due_date_status: parsed.due_date_status ?? 'missing',
    items: parsed.items?.map(item => ({ ...item, item_type: item.item_type ?? 'purchase' })),
    warnings: parsed.warnings ?? [],
  }
}

async function parseWithTextLlm(req: BillImportCoreRequest): Promise<BillImportCoreResult> {
  const config = await loadAiConfig(getDb())
  if (!config.apiKey) return emptyResult('none')

  const parsed = await parseBillWithAI(config, req.rawText ?? '')
  const payload = toStatementPayload(parsed)
  const result = emptyResult('ai_text')
  result.statements = [payload]
  result.isBill = payload.is_bill !== false
  result.nonBillReason = payload.is_bill === false ? '未识别到可入账的账单要素' : null
  return result
}

function parseWithOfflineRecognizer(req: BillImportCoreRequest): BillImportCoreResult {
  const payload = recognizeBillFromText(req.rawText ?? '') as unknown as BillDraftPayload
  const result = emptyResult('offline_text')
  result.statements = [
    {
      ...payload,
      is_bill: true,
      confidence: OFFLINE_TEXT_FALLBACK_CONFIDENCE,
      warnings: [
        '服务端未配置 AI 解析，本次为离线规则粗提，请逐项核对后再入账',
      ],
    },
  ]
  result.isBill = true
  return result
}

function toStatementFile(att: BillImportCoreAttachment): StatementFile {
  return {
    bytes: att.bytes,
    contentType: att.contentType,
    filename: att.fileName,
  }
}

async function parseWithMultimodalCore(
  req: BillImportCoreRequest,
): Promise<BillImportCoreResult> {
  const db = getDb()
  const env = getWorkerEnv() as { SESSION_SECRET?: string; IMAGES?: Pick<ImagesBinding, 'input'> }
  const pdf = req.attachments.find(att => hasPdfHeader(att.bytes) || att.contentType === 'application/pdf')
  const context = [req.rawText, ...req.attachments.map(att => att.fileName)].filter(Boolean).join('\n')

  const result = emptyResult('core')
  let outcome: StatementParseOutcome
  try {
    // A pre-0034 database still supports manual passwords.
    const secret = pdf && env.SESSION_SECRET && (await tableColumns('statement_password_vault')).has('user_id')
      ? env.SESSION_SECRET : undefined
    const { data: card, error: cardError } = secret && req.cardId
      ? await queryOne<{ holder_id: string; bank_id: string | null }>(
        `SELECT cc.holder_id, cp.bank_id FROM credit_cards cc
         LEFT JOIN card_products cp ON cp.id = cc.card_product_id WHERE cc.id = ?`,
        [req.cardId],
      )
      : { data: null, error: null }
    if (cardError) throw new Error(cardError.message)
    const { data: bank, error: bankError } = secret && !card?.bank_id && context
      ? await queryOne<{ id: string }>(
        `SELECT id FROM banks WHERE instr(?, lower(name)) > 0
         OR (trim(COALESCE(short_name, '')) <> '' AND instr(?, lower(short_name)) > 0)
         ORDER BY length(name) DESC, id LIMIT 1`,
        [context.toLowerCase(), context.toLowerCase()],
      )
      : { data: null, error: null }
    if (bankError) throw new Error(bankError.message)

    outcome = await parseMultimodalStatement({
      config: await loadAiConfig(db),
      userId: req.userId,
      db,
      secret,
      adhocPassword: req.pdfPassword,
      holderId: req.holderId ?? card?.holder_id,
      bankId: card?.bank_id ?? bank?.id,
      context,
      text: req.rawText,
      pdf: pdf && toStatementFile(pdf),
      images: pdf ? undefined : req.attachments.map(toStatementFile),
      imagesBinding: env.IMAGES,
    })
  } catch {
    result.error = '账单解析失败，请稍后重试'
    return result
  }

  if (outcome.status === 'needs_password') {
    result.needsPassword = true
    result.passwordHint = outcome.suggestedHint
    return result
  }
  if (outcome.status === 'parse_failed') {
    result.error = outcome.error
    return result
  }
  result.isBill = outcome.envelope.is_bill
  if (!result.isBill) {
    result.nonBillReason = outcome.envelope.non_bill_reason ?? '未识别到可入账的账单要素'
    return result
  }
  result.statements = outcome.envelope.statements.map(toStatementPayload)
  return result
}

async function defaultParser(req: BillImportCoreRequest): Promise<BillImportCoreResult> {
  if (req.attachments.length > 0 && req.sourceType !== 'text') {
    return parseWithMultimodalCore(req)
  }
  if (!req.rawText || !req.rawText.trim()) {
    const result = emptyResult('none')
    result.error = '没有可解析的文本内容'
    return result
  }
  try {
    const llm = await parseWithTextLlm(req)
    if (llm.parser !== 'none') return llm
  } catch (err) {
    // AI 调用失败（网络/额度/鉴权）不阻断导入：退回离线规则，并把原因写进草稿。
    const offline = parseWithOfflineRecognizer(req)
    offline.error = err instanceof Error ? err.message : String(err)
    return offline
  }
  return parseWithOfflineRecognizer(req)
}

export async function runBillImportCore(req: BillImportCoreRequest): Promise<BillImportCoreResult> {
  const parser = coreParserOverride ?? defaultParser
  return parser(req)
}

export type PdfDecryptor = (
  bytes: Uint8Array,
  password: string,
) => Promise<PdfDecryptResult>

let pdfDecryptorOverride: PdfDecryptor | null = null

export function __setPdfDecryptorForTests(decryptor: PdfDecryptor | null): void {
  pdfDecryptorOverride = decryptor
}

export async function runPdfDecrypt(bytes: Uint8Array, password: string): Promise<PdfDecryptResult> {
  if (!password) return { ok: false, reason: 'wrong_password' }
  if (pdfDecryptorOverride) return pdfDecryptorOverride(bytes, password)
  return decryptPDF(bytes, password)
}
