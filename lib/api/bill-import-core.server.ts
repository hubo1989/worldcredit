// lib/api/bill-import-core.server.ts — API 层与共享解析内核（lib/email-core）的接缝。
//
// HUB-154 §3.1 规定 `billDrafts.importAndParseBill` 只做「取件 → 委托解析 → 落草稿」，
// 真正的 PDF 解密/多模态解析由 lib/email-core 提供（HUB-155 交付）。在多模态管道
// 合入前，这里给出两条真实可用的降级路径，而不是把图片/PDF 伪装成解析成功：
//   1) 纯文本 + 已配置 AI Key → lib/email-core/ai.parseBillWithAI；
//   2) 纯文本 + 无 AI Key   → lib/billRecognizer 离线正则，confidence 固定 0.3（HUB-154 §3.3）。
// 图片 / PDF 在内核缺失时明确返回 parse_failed，绝不产出看似可入账的草稿。
//
// HUB-155 合入后只需调用 registerBillImportCoreParser() 指向新管道，API 层无需改动。

import { getDb } from '../db/client'
import { loadAiConfig, parseBillWithAI } from '../email-core/ai'
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

/**
 * 注册 lib/email-core 的多模态管道。生产代码在 HUB-155 合入后于模块加载时调用一次；
 * 测试用 __setBillImportCoreParserForTests 直接注入。
 */
export function registerBillImportCoreParser(parser: BillImportCoreParser | null): void {
  coreParserOverride = parser
}

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

/** 把 email-core 的 BillParseResult 折算成草稿 payload（字段同名，只做补全）。 */
function toStatementPayload(parsed: Record<string, unknown>): BillDraftPayload {
  const payload: BillDraftPayload = {
    is_bill: parsed.is_bill !== false,
    email_kind: (parsed.email_kind as BillDraftPayload['email_kind']) ?? null,
    bank_name: (parsed.bank_name as string | null) ?? null,
    card_last4: (parsed.card_last4 as string | null) ?? null,
    currency: (parsed.currency as string | undefined) ?? 'CNY',
    bill_month: (parsed.bill_month as string | undefined) ?? undefined,
    statement_start: (parsed.statement_start as string | undefined) ?? undefined,
    statement_end: (parsed.statement_end as string | undefined) ?? undefined,
    statement_date: (parsed.statement_date as string | null | undefined) ?? undefined,
    statement_day: (parsed.statement_day as number | null | undefined) ?? null,
    bill_amount: (parsed.bill_amount as number | null | undefined) ?? null,
    min_payment: (parsed.min_payment as number | null | undefined) ?? null,
    credit_limit: (parsed.credit_limit as number | null | undefined) ?? null,
    due_date: (parsed.due_date as string | null | undefined) ?? null,
    due_date_status:
      (parsed.due_date_status as BillDraftPayload['due_date_status']) ?? 'missing',
    holder_hint: (parsed.holder_hint as string | null | undefined) ?? null,
    card_subtotals: parsed.card_subtotals as BillDraftPayload['card_subtotals'],
    items: parsed.items as BillDraftPayload['items'],
    warnings: [],
  }
  if (!payload.bill_month && payload.statement_date) {
    payload.bill_month = payload.statement_date.slice(0, 7)
  }
  if (!payload.bill_month && payload.due_date) {
    payload.bill_month = payload.due_date.slice(0, 7)
  }
  return payload
}

async function parseWithTextLlm(req: BillImportCoreRequest): Promise<BillImportCoreResult> {
  const config = await loadAiConfig(getDb())
  if (!config.apiKey) return emptyResult('none')

  const parsed = (await parseBillWithAI(config, req.rawText ?? '')) as unknown as Record<
    string,
    unknown
  >
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

/**
 * 图片 / PDF 必须走多模态内核；内核未注册时返回 parse_failed 而不是空草稿，
 * 让上层把「解析不了」与「不是账单」区分开。
 */
function unsupportedBinary(req: BillImportCoreRequest): BillImportCoreResult {
  const result = emptyResult('none')
  result.error = `服务端尚未启用${req.sourceType === 'pdf' ? ' PDF' : '图片'}多模态解析，请改用文本粘贴或先由邮箱通道导入`
  return result
}

async function defaultParser(req: BillImportCoreRequest): Promise<BillImportCoreResult> {
  if (req.attachments.length > 0 && req.sourceType !== 'text') {
    return unsupportedBinary(req)
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

// ─── PDF 解密接缝 ────────────────────────────────────────────
// @pdfsmaller/pdf-decrypt + unpdf 属于 HUB-155 的依赖变更范围，本模块不能引入。
// 解密算法由内核注册；未注册时明确返回 unsupported，让 unlockEncryptedDraft
// 抛可读的 400，而不是伪造「解锁成功」。

export type PdfDecryptResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'wrong_password' | 'unsupported' }

export type PdfDecryptor = (
  bytes: Uint8Array,
  password: string,
) => Promise<PdfDecryptResult>

let pdfDecryptorOverride: PdfDecryptor | null = null

/** 生产代码在 HUB-155 合入后指向 lib/email-core/pdf.ts 的 decryptPDF。 */
export function registerPdfDecryptor(decryptor: PdfDecryptor | null): void {
  pdfDecryptorOverride = decryptor
}

export function __setPdfDecryptorForTests(decryptor: PdfDecryptor | null): void {
  pdfDecryptorOverride = decryptor
}

export async function runPdfDecrypt(bytes: Uint8Array, password: string): Promise<PdfDecryptResult> {
  if (!password) return { ok: false, reason: 'wrong_password' }
  if (pdfDecryptorOverride) return pdfDecryptorOverride(bytes, password)
  return { ok: false, reason: 'unsupported' }
}
