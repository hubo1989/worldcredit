// lib/api/billDrafts.server.ts — 统一账单导入草稿箱（server only）。
//
// 方向1（HUB-152 / HUB-154 §3.3）的单轨收口核心：所有非结构化账单来源
// （文本 / 截图 / PDF / 邮件 / iOS Share / 历史邮箱账本）一律先停泊
// `bill_import_drafts`，只有 `confirmBillImportDraft` 能把它变成 `bills` 行。
//
// 两条硬约束贯穿全文：
//   1) 草稿归属一律按 created_by 判定，越权抛 MemberScopeError（HTTP 403）；
//   2) 确认入账时同卡同月已存在账单 → 409 CONFLICT + reason=DUPLICATE_BILL，
//      绝不静默覆盖，也绝不写 bill_amount_override（spec 13 的钉住列）。

import { query, queryOne, execute, uuid, now } from '../db'
import { getWorkerEnv } from '../db/client'
import type { Bill } from '../types'
import { createBill } from './bills.server'
import type { BillItemInput } from './bills.server'
import { MemberScopeError } from './member-scope'
import { RpcDomainError } from './errors'
import { isExactDueDate } from '../email-core/due-date'
import { billStatusRecalcStatement, effectiveBillAmount } from '../utils'
import {
  runBillImportCore,
  runPdfDecrypt,
  type BillImportCoreAttachment,
} from './bill-import-core.server'
import { createPasswordRule } from './passwordVault.server'
import {
  tableColumns,
  hasColumn,
  pickExistingColumns,
  filterUpdatePairs,
} from './schema-columns.server'

export type DraftParseStatus = 'parsing' | 'needs_password' | 'parse_failed' | 'ready'

export type DraftSourceType =
  | 'text'
  | 'image'
  | 'pdf'
  | 'email'
  | 'sms'
  | 'share_ios'
  | 'legacy_ledger'

export type AttributionSource =
  | 'unique_card'
  | 'header_name'
  | 'body_honorific'
  | 'pdf_holder_hint'
  | 'connection_default'
  | 'holder_email'
  | 'conflict'
  | 'unknown'
  | 'manual'

export interface BillDraftItem {
  transaction_date?: string
  description: string
  amount: number
  category?: string
  item_type: 'purchase' | 'refund' | 'fee' | 'interest'
  confidence?: number
  raw_text?: string
}

export interface BillDraftPayload {
  is_bill?: boolean
  email_kind?: 'statement' | 'autopay_scheduled' | 'payment_reminder' | 'other' | null
  bank_name?: string | null
  card_last4?: string | null
  card_id?: string
  holder_hint?: string | null
  /** 原币种代码（CNY / USD / HKD …），UI 按此渲染符号，严禁硬编码 ¥。 */
  currency?: string
  bill_month?: string
  statement_start?: string
  statement_end?: string
  statement_date?: string
  statement_day?: number | null
  bill_amount?: number | null
  min_payment?: number | null
  credit_limit?: number | null
  due_date?: string | null
  due_date_status?: 'exact' | 'ambiguous_or_grace_only' | 'missing' | null
  warnings?: string[]
  candidate_card_ids?: string[]
  card_subtotals?: Array<{
    card_last4: string
    card_name?: string | null
    amount: number
    currency?: string | null
  }>
  items?: BillDraftItem[]
  legacy_ledger?: {
    entry_id: string
    ledger_id: string
    paid_amount: number
    payment_status: string
    payment_date?: string | null
    payment_note?: string | null
  }
  confidence?: number
  raw_text?: string
  /** 关联的全部附件 ID（多图时主图在 file_ref，全量在这里）。 */
  attachment_ids?: string[]
}

export interface DuplicateBillPreview {
  bill_id: string
  bill_month: string
  bill_amount: number
  paid_amount: number
  status: string
  has_override: boolean
}

export interface BillImportDraft {
  id: string
  created_by: string
  card_id: string | null
  /** 0035 新增列；为兼容旧 DTO 形状（HUB-157 的组件 mock）保持可选。 */
  holder_id?: string | null
  matched_account_id?: string | null
  source_type: DraftSourceType
  source_connection_id?: string | null
  source_label?: string | null
  raw_text: string | null
  file_ref: string | null
  parsed_payload: BillDraftPayload
  status: 'draft' | 'confirmed' | 'discarded'
  /** 0035 新增列；缺省视为 ready，兼容迁移前的历史草稿行与旧 DTO mock。 */
  parse_status?: DraftParseStatus
  attribution_source?: AttributionSource | null
  /** 0035 新增列；缺省视为 false（未受信归属 100% 停泊草稿箱）。 */
  attribution_trusted?: boolean
  batch_id?: string | null
  password_hint?: string | null
  error_message?: string | null
  confidence: number | null
  duplicate_bill_preview?: DuplicateBillPreview | null
  created_at: string
  confirmed_at: string | null
  confirmed_bill_id?: string | null
  updated_at?: string | null
}

export interface ImportAndParseBillInput {
  user_id?: string
  source_type: 'text' | 'image' | 'pdf' | 'share_ios'
  raw_text?: string
  attachment_ids?: string[]
  card_id?: string | null
  holder_id?: string | null
  pdf_password?: string
  save_password_to_vault?: boolean
  password_label?: string
  password_hint?: string
  force_save_non_bill?: boolean
  client_request_id?: string
}

export interface ImportAndParseBillResult {
  outcome: 'drafts_created' | 'needs_password' | 'parse_failed' | 'non_bill_warning' | 'duplicate_file'
  drafts: BillImportDraft[]
  message?: string
  deduplicated?: boolean
}

export interface UnlockDraftInput {
  password: string
  save_to_vault?: boolean
  vault_label?: string
  vault_holder_id?: string | null
  vault_bank_id?: string | null
  vault_bank_keyword?: string | null
  vault_hint?: string | null
}

export interface ConfirmDraftOptions {
  conflict_resolution?: 'abort' | 'merge_update'
  quick_create_card?: {
    holder_id: string
    card_product_id: string
    card_number_last4: string
    billing_day: number
    credit_limit?: number
  }
}

export interface UpdateDraftInput {
  card_id?: string | null
  holder_id?: string | null
  parsed_payload?: Partial<BillDraftPayload>
  confidence?: number
}

/** 单个文本草稿的字符上限；超过说明调用方该走附件通道。 */
export const MAX_RAW_TEXT_CHARS = 20_000
/** 单次导入允许的附件数（图片最多 3 张，PDF 1 份）。 */
export const MAX_IMPORT_ATTACHMENTS = 3
/** 与 /api/attachments/upload 的 draft 硬上限保持一致。 */
export const MAX_DRAFT_ATTACHMENT_BYTES = 10 * 1024 * 1024

const DRAFT_SOURCE_TYPES: DraftSourceType[] = [
  'text',
  'image',
  'pdf',
  'email',
  'sms',
  'share_ios',
  'legacy_ledger',
]

interface DraftRow {
  id: string
  created_by: string
  card_id: string | null
  holder_id?: string | null
  matched_account_id?: string | null
  source_type: string
  source_connection_id?: string | null
  source_label?: string | null
  raw_text: string | null
  file_ref: string | null
  parsed_payload: string
  status: string
  parse_status?: string | null
  attribution_source?: string | null
  attribution_trusted?: number | boolean | null
  batch_id?: string | null
  password_hint?: string | null
  error_message?: string | null
  confidence: number | null
  created_at: string
  confirmed_at: string | null
  confirmed_bill_id?: string | null
  updated_at?: string | null
}

// ─── 行 → DTO ────────────────────────────────────────────────

function parsePayload(raw: string | null | undefined): BillDraftPayload {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as BillDraftPayload
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function rowToDraft(row: DraftRow): BillImportDraft {
  const trustedRaw = row.attribution_trusted
  return {
    id: row.id,
    created_by: row.created_by,
    card_id: row.card_id ?? null,
    holder_id: row.holder_id ?? null,
    matched_account_id: row.matched_account_id ?? null,
    source_type: (DRAFT_SOURCE_TYPES.includes(row.source_type as DraftSourceType)
      ? row.source_type
      : 'text') as DraftSourceType,
    source_connection_id: row.source_connection_id ?? null,
    source_label: row.source_label ?? null,
    raw_text: row.raw_text ?? null,
    file_ref: row.file_ref ?? null,
    parsed_payload: parsePayload(row.parsed_payload),
    status: row.status as BillImportDraft['status'],
    parse_status: ((row.parse_status as DraftParseStatus | null) ?? 'ready') as DraftParseStatus,
    attribution_source: (row.attribution_source as AttributionSource | null) ?? null,
    attribution_trusted: trustedRaw === 1 || trustedRaw === true,
    batch_id: row.batch_id ?? null,
    password_hint: row.password_hint ?? null,
    error_message: row.error_message ?? null,
    confidence: row.confidence ?? null,
    created_at: row.created_at,
    confirmed_at: row.confirmed_at ?? null,
    confirmed_bill_id: row.confirmed_bill_id ?? null,
    updated_at: row.updated_at ?? null,
  }
}

/** 同卡同月已有账单时的对比预览：让 UI 弹「合并更新 / 放弃」而不是静默覆盖。 */
export async function buildDuplicateBillPreview(
  cardId: string | null,
  billMonth: string | null | undefined,
): Promise<DuplicateBillPreview | null> {
  if (!cardId || !billMonth) return null
  const { data } = await queryOne<{
    id: string
    bill_month: string
    bill_amount: number
    bill_amount_override: number | null
    status: string
  }>(
    `SELECT id, bill_month, bill_amount, bill_amount_override, status
     FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1`,
    [cardId, billMonth],
  )
  if (!data) return null
  const { data: paid } = await queryOne<{ paid: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE bill_id = ?',
    [data.id],
  )
  return {
    bill_id: data.id,
    bill_month: data.bill_month,
    bill_amount: effectiveBillAmount({
      bill_amount: data.bill_amount,
      bill_amount_override: data.bill_amount_override,
    }),
    paid_amount: Number(paid?.paid ?? 0),
    status: data.status,
    has_override: data.bill_amount_override != null,
  }
}

async function attachPreview(draft: BillImportDraft): Promise<BillImportDraft> {
  const payload = draft.parsed_payload
  return {
    ...draft,
    duplicate_bill_preview: await buildDuplicateBillPreview(
      draft.card_id,
      payload?.bill_month,
    ),
  }
}

// ─── 读取 ────────────────────────────────────────────────────

export async function getBillImportDraft(id: string): Promise<BillImportDraft> {
  const { data, error } = await queryOne<DraftRow>(
    'SELECT * FROM bill_import_drafts WHERE id = ?',
    [id],
  )
  if (error) throw new Error(error.message)
  if (!data) throw new RpcDomainError('NOT_FOUND', '草稿不存在')
  return attachPreview(rowToDraft(data))
}

/**
 * 按 ID 读取并校验归属。registry 用 `bindUser: 1` 把会话 user id 注入第 2 个参数，
 * 因此客户端只传 draftId，服务端仍能做 fail-closed 归属判定。
 */
export async function getBillImportDraftById(
  draftId: string,
  userId?: string,
): Promise<BillImportDraft> {
  if (typeof draftId !== 'string' || !draftId) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少草稿 ID')
  }
  const draft = await getBillImportDraft(draftId)
  if (userId && draft.created_by !== userId) {
    throw new MemberScopeError('无权访问其他用户的导入草稿')
  }
  return draft
}

export async function getBillImportDrafts(userId?: string): Promise<BillImportDraft[]> {
  if (!userId) return []
  const { data, error } = await query<DraftRow>(
    "SELECT * FROM bill_import_drafts WHERE created_by = ? AND status = 'draft' ORDER BY created_at DESC",
    [userId],
  )
  if (error) throw new Error(error.message)
  const drafts = (data || []).map(rowToDraft)
  return Promise.all(drafts.map(attachPreview))
}

// ─── 附件取件 ────────────────────────────────────────────────

interface LoadedAttachment {
  record: {
    id: string
    record_type: string
    record_id: string
    storage_path: string
    file_name: string
    file_type?: string | null
    file_size?: number | null
    uploaded_by?: string | null
    sha256?: string | null
  }
  bytes: Uint8Array
  sha256: string
}

function r2Bucket(): R2Bucket {
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
  if (!bucket) throw new Error('R2 binding "ATTACHMENTS" not found')
  return bucket
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function sniffAttachmentType(
  contentType: string | null | undefined,
  bytes: Uint8Array,
): 'pdf' | 'image' | 'unknown' {
  if (contentType && contentType === 'application/pdf') return 'pdf'
  if (contentType && contentType.startsWith('image/')) return 'image'
  if (bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.slice(0, 5))
    if (head === '%PDF-') return 'pdf'
  }
  if (bytes.length >= 4) {
    const b0 = bytes[0]
    const b1 = bytes[1]
    const b2 = bytes[2]
    const b3 = bytes[3]
    if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image' // PNG
    if (b0 === 0xff && b1 === 0xd8) return 'image' // JPEG
    if (b2 === 0x66 && b3 === 0x74 && b1 === 0x79 && b0 === 0x52) return 'image' // WebP RIFT
  }
  return 'unknown'
}

/**
 * 取附件并做三重校验：归属（uploaded_by / 草稿归属）、大小、类型。
 * 越权一律 MemberScopeError → 403（AC-12）。
 */
async function loadAttachments(
  attachmentIds: string[],
  userId: string,
  expected: 'pdf' | 'image',
): Promise<LoadedAttachment[]> {
  if (attachmentIds.length === 0) return []
  if (attachmentIds.length > MAX_IMPORT_ATTACHMENTS) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      `单次最多导入 ${MAX_IMPORT_ATTACHMENTS} 个附件`,
    )
  }
  const bucket = r2Bucket()
  const out: LoadedAttachment[] = []

  for (const attachmentId of attachmentIds) {
    const { data, error } = await queryOne<LoadedAttachment['record']>(
      'SELECT * FROM record_attachments WHERE id = ?',
      [attachmentId],
    )
    if (error) throw new Error(error.message)
    if (!data) throw new RpcDomainError('NOT_FOUND', '附件不存在')
    if (data.record_type !== 'draft') {
      throw new MemberScopeError('只能引用草稿类型的附件')
    }
    // 草稿附件的归属：上传者本人，或该附件挂在本人草稿上（file_ref / record_id）。
    if (data.uploaded_by !== userId) {
      const { data: owned } = await queryOne<{ id: string }>(
        'SELECT id FROM bill_import_drafts WHERE (id = ? OR file_ref = ?) AND created_by = ? LIMIT 1',
        [data.record_id, data.id, userId],
      )
      if (!owned) throw new MemberScopeError('无权使用其他用户的草稿附件')
    }
    if ((data.file_size ?? 0) > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new RpcDomainError('VALIDATION_FAILED', '单个账单文件不能超过 10MB')
    }

    const obj = await bucket.get(data.storage_path)
    if (!obj) throw new RpcDomainError('NOT_FOUND', '附件文件缺失')
    const bytes = new Uint8Array(await obj.arrayBuffer())
    if (bytes.byteLength > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new RpcDomainError('VALIDATION_FAILED', '单个账单文件不能超过 10MB')
    }
    const sniffed = sniffAttachmentType(data.file_type, bytes)
    if (sniffed !== expected) {
      throw new RpcDomainError(
        'VALIDATION_FAILED',
        expected === 'pdf' ? '附件不是合法 PDF' : '附件不是支持的图片格式',
      )
    }
    out.push({
      record: data,
      bytes,
      sha256: data.sha256 || (await sha256Hex(bytes)),
    })
  }
  return out
}

// ─── 导入 + 解析 ─────────────────────────────────────────────

function assertSourceCurrency(payload: BillDraftPayload): BillDraftPayload {
  const currency = (payload.currency || 'CNY').toUpperCase()
  return { ...payload, currency }
}

async function insertDraftRow(row: Record<string, unknown>): Promise<void> {
  const columns = await tableColumns('bill_import_drafts')
  const pairs = pickExistingColumns(row, columns)
  const placeholders = pairs.map(() => '?').join(', ')
  const { error } = await execute(
    `INSERT INTO bill_import_drafts (${pairs.map(pair => pair.key).join(', ')}) VALUES (${placeholders})`,
    pairs.map(pair => pair.value),
  )
  if (error) throw new Error(error.message)
}

export async function createBillImportDraft(input: {
  /** 允许调用方指定确定性 ID（历史账本迁入用 draft_leg_<entryId> 做幂等键）。 */
  id?: string
  created_by: string
  card_id?: string | null
  holder_id?: string | null
  source_type: DraftSourceType
  raw_text?: string | null
  file_ref?: string | null
  parsed_payload: BillDraftPayload
  confidence?: number | null
  parse_status?: DraftParseStatus
  attribution_source?: AttributionSource | null
  attribution_trusted?: boolean
  batch_id?: string | null
  password_hint?: string | null
  error_message?: string | null
  source_label?: string | null
  source_connection_id?: string | null
  file_sha256?: string | null
  client_request_id?: string | null
}): Promise<BillImportDraft> {
  if (!input.created_by) throw new MemberScopeError('未登录，无法创建草稿')
  const id = input.id || uuid()
  const ts = now()
  await insertDraftRow({
    id,
    created_by: input.created_by,
    card_id: input.card_id ?? null,
    holder_id: input.holder_id ?? null,
    source_type: input.source_type,
    source_label: input.source_label ?? null,
    source_connection_id: input.source_connection_id ?? null,
    raw_text: input.raw_text ?? null,
    file_ref: input.file_ref ?? null,
    parsed_payload: JSON.stringify(input.parsed_payload ?? {}),
    status: 'draft',
    parse_status: input.parse_status ?? 'ready',
    attribution_source: input.attribution_source ?? null,
    attribution_trusted: input.attribution_trusted ?? false,
    batch_id: input.batch_id ?? null,
    password_hint: input.password_hint ?? null,
    error_message: input.error_message ?? null,
    confidence: input.confidence ?? null,
    file_sha256: input.file_sha256 ?? null,
    client_request_id: input.client_request_id ?? null,
    created_at: ts,
    updated_at: ts,
  })
  return getBillImportDraft(id)
}

function extractHolderHint(rawText: string | null): string | null {
  if (!rawText) return null
  const dear = rawText.match(/Dear\s+([A-Za-z][A-Za-z\s.'-]{1,30}),/i)
  if (dear) return dear[1].trim()
  const honorific = rawText.match(/(?:尊敬的|亲爱的)\s*([^\s，,。]{1,12}?)\s*(?:先生|女士|小姐|同学)/)
  if (honorific) return honorific[1].trim()
  return null
}

export async function importAndParseBill(
  input: ImportAndParseBillInput,
): Promise<ImportAndParseBillResult> {
  if (!input || typeof input !== 'object') {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少导入参数')
  }
  const userId = input.user_id
  if (!userId) throw new MemberScopeError('未登录，无法导入账单')
  const sourceType = input.source_type
  if (!['text', 'image', 'pdf', 'share_ios'].includes(sourceType)) {
    throw new RpcDomainError('VALIDATION_FAILED', '不支持的导入来源类型')
  }

  const rawText = input.raw_text ?? null
  if (rawText && rawText.length > MAX_RAW_TEXT_CHARS) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      `文本内容不能超过 ${MAX_RAW_TEXT_CHARS} 个字符，请改用附件上传`,
    )
  }
  const attachmentIds = Array.isArray(input.attachment_ids)
    ? Array.from(new Set(input.attachment_ids.filter((id): id is string => typeof id === 'string' && !!id)))
    : []
  if (!rawText?.trim() && attachmentIds.length === 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '请提供账单文本或附件')
  }

  // 幂等：同一 client_request_id 重放直接返回原草稿（iOS Share Extension 网络重试）。
  const clientRequestId =
    typeof input.client_request_id === 'string' && input.client_request_id.trim()
      ? input.client_request_id.trim().slice(0, 128)
      : null
  if (clientRequestId) {
    const { data } = await queryOne<DraftRow>(
      "SELECT * FROM bill_import_drafts WHERE created_by = ? AND client_request_id = ? AND status = 'draft' LIMIT 1",
      [userId, clientRequestId],
    )
    if (data) {
      return {
        outcome: 'duplicate_file',
        drafts: [await attachPreview(rowToDraft(data))],
        deduplicated: true,
        message: '该请求已导入过，已返回原草稿',
      }
    }
  }

  const expectsBinary = sourceType === 'pdf' || sourceType === 'image' || sourceType === 'share_ios'
  const attachments = expectsBinary
    ? await loadAttachments(attachmentIds, userId, sourceType === 'pdf' ? 'pdf' : 'image')
    : []

  // 同文件去重：同用户已有同 sha256 的未处理草稿时不再重复解析（AC-08）。
  if (attachments.length > 0) {
    const columns = await tableColumns('bill_import_drafts')
    if (hasColumn(columns, 'file_sha256')) {
      const { data } = await queryOne<DraftRow>(
        "SELECT * FROM bill_import_drafts WHERE created_by = ? AND file_sha256 = ? AND status = 'draft' LIMIT 1",
        [userId, attachments[0].sha256],
      )
      if (data) {
        return {
          outcome: 'duplicate_file',
          drafts: [await attachPreview(rowToDraft(data))],
          deduplicated: true,
          message: '该文件已导入过，已返回原草稿',
        }
      }
    }
  }

  const core = await runBillImportCore({
    userId,
    sourceType,
    rawText,
    attachments: attachments.map(
      (item): BillImportCoreAttachment => ({
        attachmentId: item.record.id,
        fileName: item.record.file_name,
        contentType: item.record.file_type || 'application/octet-stream',
        bytes: item.bytes,
        sha256: item.sha256,
      }),
    ),
    pdfPassword: input.pdf_password ?? null,
  })

  const batchId = uuid()
  const basePayload: BillDraftPayload = {
    card_id: input.card_id ?? undefined,
    holder_hint: input.holder_id ? null : extractHolderHint(rawText),
    raw_text: rawText ?? undefined,
  }

  const needsPassword = core.needsPassword
  if (needsPassword) {
    const draft = await createBillImportDraft({
      created_by: userId,
      card_id: input.card_id ?? null,
      holder_id: input.holder_id ?? null,
      source_type: sourceType,
      raw_text: rawText ?? null,
      file_ref: attachments[0]?.record.id ?? null,
      parsed_payload: {
        ...basePayload,
        is_bill: true,
        warnings: ['该 PDF 已加密，请提供密码后继续解析'],
        attachment_ids: attachments.map(item => item.record.id),
      } as BillDraftPayload,
      confidence: null,
      parse_status: 'needs_password',
      attribution_source: input.holder_id ? 'manual' : 'unknown',
      attribution_trusted: !!input.holder_id,
      batch_id: batchId,
      password_hint: core.passwordHint ?? input.password_hint ?? null,
      source_label: attachments[0]?.record.file_name ?? '文本导入',
      file_sha256: attachments[0]?.sha256 ?? null,
      client_request_id: clientRequestId,
    })
    return { outcome: 'needs_password', drafts: [draft], message: '该 PDF 已加密，需要密码' }
  }

  if (core.error && core.statements.length === 0) {
    const draft = await createBillImportDraft({
      created_by: userId,
      card_id: input.card_id ?? null,
      holder_id: input.holder_id ?? null,
      source_type: sourceType,
      raw_text: rawText ?? null,
      file_ref: attachments[0]?.record.id ?? null,
      parsed_payload: {
        ...basePayload,
        is_bill: true,
        attachment_ids: attachments.map(item => item.record.id),
      } as BillDraftPayload,
      confidence: 0,
      parse_status: 'parse_failed',
      attribution_source: input.holder_id ? 'manual' : 'unknown',
      attribution_trusted: !!input.holder_id,
      batch_id: batchId,
      error_message: core.error,
      source_label: attachments[0]?.record.file_name ?? '文本导入',
      file_sha256: attachments[0]?.sha256 ?? null,
      client_request_id: clientRequestId,
    })
    return {
      outcome: 'parse_failed',
      drafts: [draft],
      message: core.error,
    }
  }

  if (!core.isBill && core.statements.length === 0) {
    if (!input.force_save_non_bill) {
      return {
        outcome: 'non_bill_warning',
        drafts: [],
        message: core.nonBillReason ?? '未识别到可入账的账单要素',
      }
    }
    const draft = await createBillImportDraft({
      created_by: userId,
      card_id: input.card_id ?? null,
      holder_id: input.holder_id ?? null,
      source_type: sourceType,
      raw_text: rawText ?? null,
      file_ref: attachments[0]?.record.id ?? null,
      parsed_payload: {
        ...basePayload,
        is_bill: false,
        warnings: [core.nonBillReason ?? '未识别到可入账的账单要素'],
      } as BillDraftPayload,
      confidence: 0,
      parse_status: 'ready',
      attribution_source: input.holder_id ? 'manual' : 'unknown',
      attribution_trusted: !!input.holder_id,
      batch_id: batchId,
      source_label: attachments[0]?.record.file_name ?? '文本导入',
      file_sha256: attachments[0]?.sha256 ?? null,
      client_request_id: clientRequestId,
    })
    return { outcome: 'non_bill_warning', drafts: [draft], message: core.nonBillReason ?? undefined }
  }

  const statements = core.statements.length > 0 ? core.statements : [basePayload]
  const drafts: BillImportDraft[] = []
  for (const statement of statements) {
    const payload = assertSourceCurrency({ ...basePayload, ...statement })
    const confidence =
      typeof statement.confidence === 'number' ? statement.confidence : null
    drafts.push(
      await createBillImportDraft({
        created_by: userId,
        card_id: statement.card_id ?? input.card_id ?? null,
        holder_id: input.holder_id ?? null,
        source_type: sourceType,
        raw_text: rawText ?? null,
        file_ref: attachments[0]?.record.id ?? null,
        parsed_payload: {
          ...payload,
          attachment_ids: attachments.map(item => item.record.id),
        } as BillDraftPayload,
        confidence,
        parse_status: 'ready',
        attribution_source: input.holder_id ? 'manual' : 'unknown',
        attribution_trusted: !!input.holder_id,
        batch_id: batchId,
        source_label: attachments[0]?.record.file_name ?? '文本导入',
        file_sha256: attachments[0]?.sha256 ?? null,
        client_request_id: clientRequestId,
      }),
    )
  }

  // 原位解锁后立即写密码本（HUB-154 §3.2 unlock 契约的导入侧等价路径）。
  if (input.save_password_to_vault && input.pdf_password) {
    await createPasswordRule({
      user_id: userId,
      label: input.password_label?.trim() || '导入时保存的月结单密码',
      password: input.pdf_password,
      holder_id: input.holder_id ?? null,
      hint: input.password_hint ?? null,
    })
  }

  return { outcome: 'drafts_created', drafts }
}

// ─── 更新 / 丢弃 ─────────────────────────────────────────────

export async function updateBillImportDraft(
  draftId: string,
  updates: UpdateDraftInput,
  userId?: string,
): Promise<BillImportDraft> {
  const draft = await getBillImportDraftById(draftId, userId)
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少草稿更新参数')
  }
  const pairs: Array<{ column: string; value: unknown }> = []

  if (updates.card_id !== undefined) {
    if (updates.card_id) {
      const { data } = await queryOne<{ id: string }>(
        'SELECT id FROM credit_cards WHERE id = ?',
        [updates.card_id],
      )
      if (!data) throw new RpcDomainError('VALIDATION_FAILED', '所选信用卡不存在')
    }
    pairs.push({ column: 'card_id', value: updates.card_id })
  }
  if (updates.holder_id !== undefined) {
    pairs.push({ column: 'holder_id', value: updates.holder_id })
    if (updates.holder_id) {
      pairs.push({ column: 'attribution_source', value: 'manual' })
      pairs.push({ column: 'attribution_trusted', value: true })
    }
  }
  if (updates.parsed_payload !== undefined) {
    const merged: BillDraftPayload = { ...draft.parsed_payload, ...updates.parsed_payload }
    pairs.push({ column: 'parsed_payload', value: JSON.stringify(merged) })
    // 人工改过字段即视为可入账，清掉历史解析错误。
    pairs.push({ column: 'error_message', value: null })
  }
  if (updates.confidence !== undefined) {
    pairs.push({ column: 'confidence', value: updates.confidence })
  }
  pairs.push({ column: 'updated_at', value: now() })

  const filtered = await filterUpdatePairs('bill_import_drafts', pairs)
  if (!filtered) {
    throw new RpcDomainError('VALIDATION_FAILED', '没有需要更新的字段')
  }
  const { error } = await execute(
    `UPDATE bill_import_drafts SET ${filtered.sets.join(', ')} WHERE id = ?`,
    [...filtered.params, draftId],
  )
  if (error) throw new Error(error.message)
  return getBillImportDraft(draftId)
}

async function maybeCleanupAttachment(fileRef: string | null): Promise<void> {
  if (!fileRef) return
  // 仅当没有其它草稿共享同一原件时才删 R2 对象与附件行。
  const { data: others } = await query<{ id: string }>(
    "SELECT id FROM bill_import_drafts WHERE file_ref = ? AND status != 'discarded' LIMIT 1",
    [fileRef],
  )
  if (others && others.length > 0) return
  const { data: record } = await queryOne<{
    id: string
    storage_path: string
  }>('SELECT id, storage_path FROM record_attachments WHERE id = ?', [fileRef])
  if (!record) return
  try {
    const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
    if (bucket) await bucket.delete(record.storage_path)
  } catch {
    // R2 删除失败不阻断业务：孤儿文件由 cron 清理。
  }
  await execute('DELETE FROM record_attachments WHERE id = ?', [record.id])
}

export async function discardBillImportDraft(draftId: string, userId?: string): Promise<void> {
  const draft = await getBillImportDraftById(draftId, userId)
  if (draft.status !== 'draft') {
    throw new RpcDomainError('CONFLICT', '只能丢弃草稿状态的账单')
  }
  const filtered = await filterUpdatePairs('bill_import_drafts', [
    { column: 'status', value: 'discarded' },
    { column: 'updated_at', value: now() },
  ])
  if (!filtered) throw new Error('草稿表缺少可写列')
  const { error } = await execute(
    `UPDATE bill_import_drafts SET ${filtered.sets.join(', ')} WHERE id = ?`,
    [...filtered.params, draftId],
  )
  if (error) throw new Error(error.message)
  await maybeCleanupAttachment(draft.file_ref)
}

export async function batchDiscardBillDrafts(
  draftIds: string[],
  userId?: string,
): Promise<{ discarded_count: number }> {
  if (!Array.isArray(draftIds)) {
    throw new RpcDomainError('VALIDATION_FAILED', '参数必须是草稿 ID 数组')
  }
  if (draftIds.length > 200) {
    throw new RpcDomainError('VALIDATION_FAILED', '单次最多丢弃 200 条草稿')
  }
  let discarded = 0
  // 逐条走 discardBillImportDraft：每条都独立做归属校验，任一越权即整体 403。
  for (const draftId of Array.from(new Set(draftIds))) {
    if (typeof draftId !== 'string' || !draftId) {
      throw new RpcDomainError('VALIDATION_FAILED', '草稿 ID 必须是非空字符串')
    }
    await discardBillImportDraft(draftId, userId)
    discarded++
  }
  return { discarded_count: discarded }
}

// ─── 重试 / 解锁 ─────────────────────────────────────────────

export async function retryParseDraft(
  draftId: string,
  opts?: { manual_mode?: boolean; pdf_password?: string },
  userId?: string,
): Promise<BillImportDraft> {
  const draft = await getBillImportDraftById(draftId, userId)
  if (draft.status !== 'draft') {
    throw new RpcDomainError('CONFLICT', '只能重试草稿状态的账单')
  }

  if (opts?.manual_mode) {
    return updateBillImportDraft(draftId, { parsed_payload: { is_bill: true } }, userId)
  }

  let attachments: LoadedAttachment[] = []
  if (draft.file_ref) {
    const expected = draft.source_type === 'pdf' ? 'pdf' : 'image'
    attachments = await loadAttachments([draft.file_ref], userId ?? draft.created_by, expected)
  }

  const core = await runBillImportCore({
    userId: userId ?? draft.created_by,
    sourceType: draft.source_type === 'email' || draft.source_type === 'legacy_ledger' || draft.source_type === 'sms'
      ? 'text'
      : draft.source_type,
    rawText: draft.raw_text,
    attachments: attachments.map(
      (item): BillImportCoreAttachment => ({
        attachmentId: item.record.id,
        fileName: item.record.file_name,
        contentType: item.record.file_type || 'application/octet-stream',
        bytes: item.bytes,
        sha256: item.sha256,
      }),
    ),
    pdfPassword: opts?.pdf_password ?? null,
    previousError: draft.error_message ?? null,
  })

  const pairs: Array<{ column: string; value: unknown }> = []

  if (core.needsPassword) {
    pairs.push({ column: 'parse_status', value: 'needs_password' })
    if (core.passwordHint) pairs.push({ column: 'password_hint', value: core.passwordHint })
    pairs.push({ column: 'error_message', value: null })
  } else if (core.error && core.statements.length === 0) {
    pairs.push({ column: 'parse_status', value: 'parse_failed' })
    pairs.push({ column: 'error_message', value: core.error })
  } else {
    const statements = core.statements
    if (statements.length > 0) {
      pairs.push({
        column: 'parsed_payload',
        value: JSON.stringify(
          assertSourceCurrency({
            ...draft.parsed_payload,
            ...statements[0],
            attachment_ids: attachments.map(item => item.record.id),
          }),
        ),
      })
      pairs.push({
        column: 'confidence',
        value:
          typeof statements[0].confidence === 'number' ? statements[0].confidence : draft.confidence,
      })
    }
    pairs.push({ column: 'parse_status', value: 'ready' })
    pairs.push({ column: 'error_message', value: null })
  }
  pairs.push({ column: 'updated_at', value: now() })

  const filtered = await filterUpdatePairs('bill_import_drafts', pairs)
  if (!filtered) throw new Error('草稿表缺少可写列')
  const { error } = await execute(
    `UPDATE bill_import_drafts SET ${filtered.sets.join(', ')} WHERE id = ?`,
    [...filtered.params, draftId],
  )
  if (error) throw new Error(error.message)
  return getBillImportDraft(draftId)
}

/**
 * 加密 PDF 原位解锁（AC-03）：脱密后直接覆盖 R2 原对象，后续 Web/iOS 预览免二次输密。
 * 解密本身由 lib/email-core 的 PDF 管道提供（HUB-155），这里只编排。
 */
export async function unlockEncryptedDraft(
  draftId: string,
  input: UnlockDraftInput,
  userId?: string,
): Promise<{ drafts: BillImportDraft[]; vault_rule_saved: boolean }> {
  const draft = await getBillImportDraftById(draftId, userId)
  if (!input || typeof input !== 'object') {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少解锁参数')
  }
  const password = typeof input.password === 'string' ? input.password : ''
  if (!password) {
    throw new RpcDomainError('VALIDATION_FAILED', '请输入 PDF 密码')
  }
  if (draft.parse_status !== 'needs_password') {
    throw new RpcDomainError('CONFLICT', '该草稿不需要解锁')
  }
  if (!draft.file_ref) {
    throw new RpcDomainError('VALIDATION_FAILED', '该草稿没有可解锁的原始附件')
  }

  const [attachment] = await loadAttachments([draft.file_ref], userId ?? draft.created_by, 'pdf')
  const decrypted = await runPdfDecrypt(attachment.bytes, password)
  if (!decrypted.ok) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      decrypted.reason === 'wrong_password' ? '密码错误，请重试' : '该 PDF 加密方式暂不支持解锁',
      { reason: decrypted.reason },
    )
  }

  // 原位覆盖：同一个 storage_path，后续读取不再需要密码。
  const bucket = r2Bucket()
  await bucket.put(attachment.record.storage_path, decrypted.bytes, {
    httpMetadata: { contentType: 'application/pdf' },
  })

  let vaultRuleSaved = false
  if (input.save_to_vault) {
    await createPasswordRule({
      user_id: userId ?? draft.created_by,
      label: input.vault_label?.trim() || '解锁时保存的月结单密码',
      password,
      holder_id: input.vault_holder_id ?? draft.holder_id ?? null,
      bank_id: input.vault_bank_id ?? null,
      bank_keyword: input.vault_bank_keyword ?? null,
      hint: input.vault_hint ?? null,
    })
    vaultRuleSaved = true
  }

  const updated = await retryParseDraft(draftId, { pdf_password: password }, userId)
  return { drafts: [updated], vault_rule_saved: vaultRuleSaved }
}

// ─── 确认入账 ────────────────────────────────────────────────

function resolveEffectiveAmount(row: {
  bill_amount: number
  bill_amount_override?: number | null
}): number {
  return effectiveBillAmount(row)
}

async function applyLegacyLedgerPayment(params: {
  draft: BillImportDraft
  billId: string
}): Promise<void> {
  const legacy = params.draft.parsed_payload?.legacy_ledger
  if (params.draft.source_type !== 'legacy_ledger' || !legacy) return
  const paidAmount = Number(legacy.paid_amount || 0)
  if (!(paidAmount > 0)) return

  const { data: billRow } = await queryOne<{ bill_amount: number; bill_amount_override: number | null }>(
    'SELECT bill_amount, bill_amount_override FROM bills WHERE id = ?',
    [params.billId],
  )
  const effective = billRow ? resolveEffectiveAmount(billRow) : 0
  // 0022 的 PAYMENT_EXCEEDS_REMAINING 触发器按「生效金额 + 0.01」设上界，
  // 历史已还金额可能略高于账单金额，这里截断到账单金额以免整笔迁入失败。
  const amount = Math.max(0, Math.min(paidAmount, effective > 0 ? effective : paidAmount))
  if (!(amount > 0)) return

  const { error } = await execute(
    `INSERT OR IGNORE INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.billId,
      amount,
      legacy.payment_date || now().slice(0, 10),
      '历史邮箱账本迁入',
      legacy.payment_note || null,
      `legacy_ledger_pay:${legacy.ledger_id}`,
    ],
  )
  if (error) throw new Error(error.message)

  const recalc = billStatusRecalcStatement(params.billId)
  await execute(recalc.sql, recalc.params)

  await execute('UPDATE gmail_ledger_entries SET matched_bill_id = ? WHERE id = ?', [
    params.billId,
    legacy.entry_id,
  ])
}

export async function confirmBillImportDraft(
  draftId: string,
  opts?: ConfirmDraftOptions,
  userId?: string,
): Promise<Bill> {
  const draft = await getBillImportDraftById(draftId, userId)
  if (draft.status !== 'draft') {
    throw new RpcDomainError('CONFLICT', '只能确认草稿状态的账单')
  }

  const payload = draft.parsed_payload
  if (payload?.is_bill === false) {
    throw new RpcDomainError('VALIDATION_FAILED', '该草稿不是可入账的账单，请先补全信息')
  }
  if (!payload?.bill_amount || payload.bill_amount <= 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '账单金额缺失，请补全后再确认入账')
  }
  if (!payload.bill_month) {
    throw new RpcDomainError('VALIDATION_FAILED', '账单月份缺失，请补全后再确认入账')
  }
  if (!payload.due_date || !isExactDueDate(payload.due_date)) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      '还款日缺失或不精确，请补全确切的还款截止日后再确认入账',
    )
  }

  let cardId = draft.card_id
  if (opts?.quick_create_card) {
    const quick = opts.quick_create_card
    if (!quick?.holder_id || !quick.card_product_id || !quick.card_number_last4) {
      throw new RpcDomainError('VALIDATION_FAILED', '快捷建卡缺少必要信息')
    }
    const billingDay = Number(quick.billing_day)
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
      throw new RpcDomainError('VALIDATION_FAILED', '账单日必须是 1–31 的整数')
    }
    const newCardId = uuid()
    const { error } = await execute(
      `INSERT INTO credit_cards
         (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'credit')`,
      [
        newCardId,
        quick.holder_id,
        quick.card_product_id,
        quick.card_number_last4,
        Number(quick.credit_limit) || 0,
        billingDay,
      ],
    )
    if (error) throw new Error(error.message)
    cardId = newCardId
  }
  if (!cardId) {
    throw new RpcDomainError('VALIDATION_FAILED', '请先选择信用卡')
  }

  const existing = await buildDuplicateBillPreview(cardId, payload.bill_month)
  if (existing && opts?.conflict_resolution !== 'merge_update') {
    throw new RpcDomainError(
      'CONFLICT',
      `该信用卡在 ${payload.bill_month} 已存在账单`,
      {
        reason: 'DUPLICATE_BILL',
        existing_bill: existing,
        draft_bill: {
          bill_month: payload.bill_month,
          bill_amount: payload.bill_amount,
          min_payment: payload.min_payment ?? 0,
          due_date: payload.due_date,
          statement_date: payload.statement_date ?? null,
        },
      },
    )
  }

  const items: BillItemInput[] = (payload.items || []).map(item => ({
    transaction_date: item.transaction_date,
    description: item.description,
    amount: item.amount,
    category: item.category,
    item_type: item.item_type || 'purchase',
    source: 'llm' as const,
    confidence: item.confidence,
    raw_text: item.raw_text,
    metadata: { draft_id: draftId, import_source: draft.source_type },
  }))

  let billId: string
  if (existing) {
    // 合并更新：只写导入列，绝不触碰 *_override（spec 13 的钉住语义），
    // 还款状态由 payments 重算保护（keepPaidStatus 的同口径实现）。
    const { error } = await execute(
      `UPDATE bills SET statement_start = ?, statement_end = ?, statement_date = ?,
              bill_amount = ?, min_payment = ?, due_date = ?
       WHERE id = ?`,
      [
        payload.statement_start || null,
        payload.statement_end || null,
        payload.statement_date || null,
        payload.bill_amount,
        payload.min_payment ?? 0,
        payload.due_date,
        existing.bill_id,
      ],
    )
    if (error) throw new Error(error.message)
    billId = existing.bill_id
  } else {
    const bill = await createBill({
      card_id: cardId,
      bill_month: payload.bill_month,
      statement_start: payload.statement_start,
      statement_end: payload.statement_end,
      statement_date: payload.statement_date,
      bill_amount: payload.bill_amount,
      min_payment: payload.min_payment || 0,
      due_date: payload.due_date,
      status: 'unpaid',
      items,
    })
    billId = bill.id
  }

  const confirmPairs: Array<{ column: string; value: unknown }> = [
    { column: 'status', value: 'confirmed' },
    { column: 'confirmed_at', value: now() },
  ]
  if (cardId !== draft.card_id) confirmPairs.push({ column: 'card_id', value: cardId })
  confirmPairs.push({ column: 'confirmed_bill_id', value: billId })
  confirmPairs.push({ column: 'updated_at', value: now() })
  const confirmFiltered = await filterUpdatePairs('bill_import_drafts', confirmPairs)
  if (!confirmFiltered) throw new Error('草稿表缺少可写列')
  const { error: confirmError } = await execute(
    `UPDATE bill_import_drafts SET ${confirmFiltered.sets.join(', ')} WHERE id = ?`,
    [...confirmFiltered.params, draftId],
  )
  if (confirmError) throw new Error(confirmError.message)

  await applyLegacyLedgerPayment({ draft, billId })

  // 附件挂到正式账单上，草稿箱清空后原件仍可预览（HUB-154 §1.4）。
  if (draft.file_ref) {
    await execute(
      "UPDATE record_attachments SET record_type = 'bill', record_id = ? WHERE id = ? AND record_type = 'draft'",
      [billId, draft.file_ref],
    )
  }

  const { data: bill } = await queryOne<Bill>('SELECT * FROM bills WHERE id = ?', [billId])
  if (!bill) throw new Error('账单确认失败')
  return bill
}

export async function checkDuplicateBill(cardId: string, billMonth: string): Promise<Bill | null> {
  const { data } = await queryOne<Bill>(
    'SELECT * FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1',
    [cardId, billMonth],
  )
  return data
}

// ─── 历史邮箱账本 → 草稿箱（AC-09） ───────────────────────────

interface LegacyLedgerRow {
  id: string
  ledger_id: string
  bank: string
  account_tail: string | null
  currency: string | null
  statement_amount: number
  minimum_payment: number | null
  due_date: string | null
  statement_date: string | null
  subject: string | null
  evidence: string | null
  cardholder_name: string | null
  is_overpayment: number | boolean | null
  amount_direction: string | null
  manually_priced: number | boolean | null
  paid_amount: number | null
  payment_status: string | null
  payment_date: string | null
  payment_note: string | null
  matched_card_id: string | null
  matched_bill_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function flag(value: unknown): boolean {
  return value === 1 || value === true
}

/**
 * 把历史 `gmail_ledger_entries` 里「未关联正式账单」的条目幂等转入草稿箱。
 * 与 0036 迁移同一套分流规则（已关联归档 / 溢缴款与附属卡噪音跳过 / 同卡同期
 * 去重保留已还最高的一条），区别是这里按用户执行、可重复调用（AC-09）。
 */
export async function migrateLegacyLedgerToDrafts(
  userId?: string,
): Promise<{ migrated: number; skipped: number }> {
  if (!userId) throw new MemberScopeError('未登录，无法迁移历史邮箱账本')

  const columns = await tableColumns('gmail_ledger_entries')
  const hasMigrationColumns =
    hasColumn(columns, 'migration_status') && hasColumn(columns, 'migrated_draft_id')

  const { data, error } = await query<LegacyLedgerRow>(
    'SELECT * FROM gmail_ledger_entries WHERE created_by = ? AND matched_bill_id IS NULL',
    [userId],
  )
  if (error) throw new Error(error.message)
  const rows = (data || []).filter(row => {
    if (!hasMigrationColumns) return true
    const status = (row as LegacyLedgerRow & { migration_status?: string | null }).migration_status
    return !status
  })

  // 1) 噪音：溢缴款 / 贷方余额 / 无账期附属卡明细（人工补录的保留）
  const priced = rows.filter(row => Number(row.statement_amount || 0) > 0)
  const signal = priced.filter(row => {
    if (flag(row.is_overpayment)) return false
    if ((row.amount_direction || '') === 'credit') return false
    if (!flag(row.manually_priced) && !row.due_date && !row.statement_date) return false
    return true
  })

  // 2) 同卡同期同金额去重：保留已还金额最高、最新的一条
  const groups = new Map<string, LegacyLedgerRow[]>()
  for (const row of signal) {
    const key = JSON.stringify([
      row.bank,
      row.account_tail || '',
      row.due_date || row.statement_date || '',
      row.statement_amount,
    ])
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  const keep: LegacyLedgerRow[] = []
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => {
      const paidDiff = Number(b.paid_amount || 0) - Number(a.paid_amount || 0)
      if (paidDiff !== 0) return paidDiff
      return String(b.updated_at).localeCompare(String(a.updated_at))
    })
    keep.push(bucket[0])
  }

  // 3) 无金额条目同样要进草稿箱（原 UI 的「待补金额」），但单独成组
  const unpriced = rows.filter(row => Number(row.statement_amount || 0) <= 0)

  let migrated = 0
  const draftIds: string[] = []
  for (const row of [...keep, ...unpriced]) {
    const draftId = `draft_leg_${row.id}`
    const { data: existing } = await queryOne<{ id: string }>(
      'SELECT id FROM bill_import_drafts WHERE id = ?',
      [draftId],
    )
    if (existing) {
      draftIds.push(row.id)
      continue
    }
    const amount = Number(row.statement_amount || 0)
    const payload: BillDraftPayload = {
      is_bill: true,
      bank_name: row.bank,
      card_last4: row.account_tail,
      currency: row.currency || 'CNY',
      bill_amount: amount > 0 ? amount : null,
      min_payment: Number(row.minimum_payment || 0) > 0 ? Number(row.minimum_payment) : null,
      due_date: row.due_date,
      due_date_status: row.due_date ? 'exact' : 'missing',
      statement_date: row.statement_date ?? undefined,
      bill_month: (row.statement_date || row.due_date || '').slice(0, 7) || undefined,
      holder_hint: row.cardholder_name,
      warnings: [
        ...(amount <= 0 ? ['原邮件无金额，请补录后确认入账'] : []),
        ...(!row.due_date ? ['缺少确切还款截止日，请补全后确认入账'] : []),
      ],
      legacy_ledger: {
        entry_id: row.id,
        ledger_id: row.ledger_id,
        paid_amount: Number(row.paid_amount || 0),
        payment_status: row.payment_status || '未还款',
        payment_date: row.payment_date,
        payment_note: row.payment_note,
      },
      raw_text: row.evidence || row.subject || undefined,
    }
    await createBillImportDraft({
      id: draftId,
      created_by: userId,
      card_id: row.matched_card_id,
      source_type: 'legacy_ledger',
      source_label: '历史邮箱账本迁入',
      raw_text: row.evidence || row.subject || null,
      parsed_payload: payload,
      confidence: amount > 0 && row.due_date ? 0.8 : 0.4,
      parse_status: 'ready',
      attribution_source: 'unknown',
      attribution_trusted: false,
      client_request_id: `legacy_ledger:${row.id}`,
    })
    migrated++
    draftIds.push(row.id)
  }

  // 4) 回写迁移标记（列不存在时静默跳过：0036 落地后自动生效）
  if (hasMigrationColumns) {
    for (const entryId of draftIds) {
      await execute(
        "UPDATE gmail_ledger_entries SET migration_status = 'migrated_to_draft', migrated_draft_id = ? WHERE id = ? AND matched_bill_id IS NULL",
        [`draft_leg_${entryId}`, entryId],
      )
    }
    const skippedIds = rows
      .filter(row => !draftIds.includes(row.id))
      .map(row => row.id)
    for (const entryId of skippedIds) {
      await execute(
        "UPDATE gmail_ledger_entries SET migration_status = 'skipped_noise' WHERE id = ? AND matched_bill_id IS NULL",
        [entryId],
      )
    }
  }

  return { migrated, skipped: rows.length - draftIds.length }
}
