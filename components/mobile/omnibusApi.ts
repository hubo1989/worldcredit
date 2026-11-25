// components/mobile/omnibusApi.ts
// 方向 1（HUB-154）客户端冻结契约与 RPC/附件封装。
// 不触碰 lib/api/**，通过 lib/api/rpc-client 的 callRpc 与后端对齐。
import { callRpc, RpcError } from '@/lib/api/rpc-client'
import type { Bill } from '@/lib/types'
import type { BillImportDraft as BaseBillImportDraft } from '@/lib/api/billDrafts'
import { currencySymbol, normalizeCurrencyOrDefault } from '@/lib/fx'

export type DraftParseStatus = 'parsing' | 'needs_password' | 'parse_failed' | 'ready'

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

export interface BillDraftSubtotal {
  card_last4: string
  card_name?: string | null
  amount: number
  currency?: string | null
}

export interface BillDraftLineItem {
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
  attachment_ids?: string[]
  card_subtotals?: BillDraftSubtotal[]
  items?: BillDraftLineItem[]
  legacy_ledger?: {
    entry_id: string
    ledger_id: string
    paid_amount: number
    payment_status: string
    payment_date?: string | null
    payment_note?: string | null
  }
  raw_text?: string
}

export interface DuplicateBillPreview {
  bill_id: string
  bill_month: string
  bill_amount: number
  paid_amount: number
  status: string
  has_override: boolean
}

export interface BillImportDraftOmnibus {
  id: string
  created_by: string
  card_id: string | null
  holder_id?: string | null
  matched_account_id?: string | null
  source_type: 'text' | 'image' | 'pdf' | 'email' | 'sms' | 'share_ios' | 'legacy_ledger'
  source_connection_id?: string | null
  source_label?: string | null
  raw_text: string | null
  file_ref: string | null
  parsed_payload: BillDraftPayload
  status: 'draft' | 'confirmed' | 'discarded'
  parse_status?: DraftParseStatus
  attribution_source?: AttributionSource | null
  attribution_trusted?: boolean
  batch_id?: string | null
  password_hint?: string | null
  error_message?: string | null
  confidence: number | null
  duplicate_bill_preview?: DuplicateBillPreview | null
  created_at: string
  confirmed_at: string | null
  confirmed_bill_id?: string | null
}

export type AnyBillImportDraft = BaseBillImportDraft | BillImportDraftOmnibus

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
  drafts: BillImportDraftOmnibus[]
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

export interface DuplicateBillDetails {
  reason: 'DUPLICATE_BILL'
  existing_bill: {
    id: string
    bill_month: string
    bill_amount: number
    paid_amount?: number
    status: string
    due_date?: string | null
    has_override?: boolean
  }
  draft_bill: {
    bill_month: string
    bill_amount: number
    due_date?: string | null
    currency?: string | null
  }
}

export interface StatementPasswordRuleDto {
  id: string
  user_id: string
  label: string
  holder_id: string | null
  bank_id: string | null
  bank_keyword: string | null
  hint: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface CreatePasswordRuleInput {
  label: string
  password: string
  holder_id?: string | null
  bank_id?: string | null
  bank_keyword?: string | null
  hint?: string | null
}

export interface UpdatePasswordRuleInput {
  label?: string
  password?: string
  holder_id?: string | null
  bank_id?: string | null
  bank_keyword?: string | null
  hint?: string | null
}

export interface GmailConnectionItem {
  id: string
  email: string
  display_label: string | null
  default_holder_id: string | null
  attribution_mode: 'auto_then_default' | 'force_default_unless_conflict'
  sync_enabled: boolean
  status: 'active' | 'error' | 'revoked'
  last_sync_at: string | null
  last_sync_summary: string | null
  last_error: string | null
  created_at: string
}

export interface UpdateGmailConnectionInput {
  display_label?: string | null
  default_holder_id?: string | null
  attribution_mode?: 'auto_then_default' | 'force_default_unless_conflict'
  sync_enabled?: boolean
}

export interface GmailSyncSummaryItem {
  scanned: number
  written: number
  drafted: number
  skipped: number
  failed: number
  errors: string[]
  remaining: number
}

export interface UserImportPreferences {
  auto_commit_trusted_email: boolean
}

type RpcFn<A extends unknown[], R> = (...args: A) => Promise<R>

export function importAndParseBill(input: ImportAndParseBillInput): Promise<ImportAndParseBillResult> {
  return callRpc<RpcFn<[ImportAndParseBillInput], ImportAndParseBillResult>>(
    'billDrafts',
    'importAndParseBill',
    input
  )
}

export function unlockEncryptedDraft(
  draftId: string,
  input: UnlockDraftInput
): Promise<{ drafts: BillImportDraftOmnibus[]; vault_rule_saved: boolean }> {
  return callRpc<RpcFn<[string, UnlockDraftInput], { drafts: BillImportDraftOmnibus[]; vault_rule_saved: boolean }>>(
    'billDrafts',
    'unlockEncryptedDraft',
    draftId,
    input
  )
}

export function retryParseDraft(
  draftId: string,
  opts?: { manual_mode?: boolean }
): Promise<BillImportDraftOmnibus> {
  return callRpc<RpcFn<[string, { manual_mode?: boolean }?], BillImportDraftOmnibus>>(
    'billDrafts',
    'retryParseDraft',
    draftId,
    opts
  )
}

export function getBillImportDraftById(draftId: string): Promise<BillImportDraftOmnibus> {
  return callRpc<RpcFn<[string], BillImportDraftOmnibus>>('billDrafts', 'getBillImportDraftById', draftId)
}

export function confirmBillImportDraftWithOptions(
  draftId: string,
  opts?: ConfirmDraftOptions
): Promise<Bill> {
  return callRpc<RpcFn<[string, ConfirmDraftOptions?], Bill>>(
    'billDrafts',
    'confirmBillImportDraft',
    draftId,
    opts
  )
}

export function batchDiscardBillDrafts(draftIds: string[]): Promise<{ discarded_count: number }> {
  return callRpc<RpcFn<[string[]], { discarded_count: number }>>(
    'billDrafts',
    'batchDiscardBillDrafts',
    draftIds
  )
}

export function listPasswordRules(): Promise<StatementPasswordRuleDto[]> {
  return callRpc<RpcFn<[], StatementPasswordRuleDto[]>>('passwordVault', 'listPasswordRules')
}

export function createPasswordRule(input: CreatePasswordRuleInput): Promise<StatementPasswordRuleDto> {
  return callRpc<RpcFn<[CreatePasswordRuleInput], StatementPasswordRuleDto>>(
    'passwordVault',
    'createPasswordRule',
    input
  )
}

export function updatePasswordRule(
  ruleId: string,
  input: UpdatePasswordRuleInput
): Promise<StatementPasswordRuleDto> {
  return callRpc<RpcFn<[string, UpdatePasswordRuleInput], StatementPasswordRuleDto>>(
    'passwordVault',
    'updatePasswordRule',
    ruleId,
    input
  )
}

export function deletePasswordRule(ruleId: string): Promise<{ ok: true }> {
  return callRpc<RpcFn<[string], { ok: true }>>('passwordVault', 'deletePasswordRule', ruleId)
}

export function getGmailConnections(): Promise<GmailConnectionItem[]> {
  return callRpc<RpcFn<[], GmailConnectionItem[]>>('gmail', 'getGmailConnections')
}

export function updateGmailConnection(
  connectionId: string,
  input: UpdateGmailConnectionInput
): Promise<GmailConnectionItem> {
  return callRpc<RpcFn<[string, UpdateGmailConnectionInput], GmailConnectionItem>>(
    'gmail',
    'updateGmailConnection',
    connectionId,
    input
  )
}

export function syncGmailConnection(opts?: {
  connectionId?: string
  maxMessages?: number
}): Promise<GmailSyncSummaryItem> {
  return callRpc<RpcFn<[{ connectionId?: string; maxMessages?: number }?], GmailSyncSummaryItem>>(
    'gmail',
    'syncGmailConnection',
    opts
  )
}

export function disconnectGmailConnection(opts?: { connectionId?: string }): Promise<{ ok: true }> {
  return callRpc<RpcFn<[{ connectionId?: string }?], { ok: true }>>(
    'gmail',
    'disconnectGmailConnection',
    opts
  )
}

export function updateMyHolderAliases(holderId: string, aliases: string[]): Promise<{ ok: true }> {
  return callRpc<RpcFn<[string, string[]], { ok: true }>>(
    'holders',
    'updateMyHolderAliases',
    holderId,
    aliases
  )
}

export function getUserImportPreferences(): Promise<UserImportPreferences> {
  return callRpc<RpcFn<[], UserImportPreferences>>('preferences', 'getUserImportPreferences')
}

export function updateUserImportPreferences(
  config: Partial<UserImportPreferences>
): Promise<UserImportPreferences> {
  return callRpc<RpcFn<[Partial<UserImportPreferences>], UserImportPreferences>>(
    'preferences',
    'updateUserImportPreferences',
    config
  )
}

export function migrateLegacyLedgerToDrafts(): Promise<{ migrated_count: number }> {
  return callRpc<RpcFn<[], { migrated_count: number }>>(
    'gmail-ledger',
    'migrateLegacyLedgerToDrafts'
  )
}

export function formatDraftAmount(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  const code = normalizeCurrencyOrDefault(currency, 'CNY')
  return `${currencySymbol(code)}${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

export function getDraftCurrencySymbol(currency?: string | null): string {
  return currencySymbol(normalizeCurrencyOrDefault(currency, 'CNY'))
}

export function getDraftAttachmentPreviewUrl(fileRef: string): string {
  return `/api/attachments/${encodeURIComponent(fileRef)}`
}

export function createClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function extractDuplicateBillDetails(err: unknown): DuplicateBillDetails | null {
  const details =
    err instanceof RpcError
      ? err.details
      : typeof err === 'object' && err !== null && 'details' in err
        ? (err as { details?: unknown }).details
        : undefined
  if (!details || typeof details !== 'object') return null
  const record = details as Record<string, unknown>
  if (record.reason !== 'DUPLICATE_BILL' || !record.existing_bill) return null
  return record as unknown as DuplicateBillDetails
}

const BANK_PASSWORD_HINTS: Array<{ keywords: string[]; hint: string }> = [
  {
    keywords: ['建设', 'ccb', '中信', 'citic', '交通', 'bankcomm', '广发', 'cgb', '平安', 'pingan'],
    hint: '通常为持卡人身份证号后 6 位或查询密码',
  },
  {
    keywords: ['汇丰', 'hsbc', '恒生', 'hangseng', '东亚', 'bea', '中银香港', 'bochk'],
    hint: '通常为香港身份证/护照号部分字符或出生日期（DDMMYYYY）',
  },
  {
    keywords: ['招商', 'cmb', '工商', 'icbc', '中国银行', 'boc', '农业', 'abc', '浦发', 'spdb', '兴业', 'cib'],
    hint: '通常为身份证号后 6 位或生日格式（如 YYYYMMDD / MMDD）',
  },
]

export function suggestBankPasswordHint(bankOrContext?: string | null): string | null {
  const text = (bankOrContext || '').trim().toLowerCase()
  if (!text) return null
  for (const item of BANK_PASSWORD_HINTS) {
    if (item.keywords.some(kw => text.includes(kw))) {
      return item.hint
    }
  }
  return null
}

export function formatAttributionLabel(source?: AttributionSource | null): string | null {
  switch (source) {
    case 'unique_card':
      return '唯一卡片匹配'
    case 'header_name':
      return '邮件称呼匹配'
    case 'body_honorific':
      return '正文姓名匹配'
    case 'pdf_holder_hint':
      return 'PDF 持卡人匹配'
    case 'connection_default':
      return '邮箱默认归属'
    case 'holder_email':
      return '持卡人邮箱匹配'
    case 'conflict':
      return '多卡同尾号冲突，请人工确认'
    case 'unknown':
      return '未自动识别持卡人'
    case 'manual':
      return '手动指定'
    default:
      return null
  }
}

export function isDraftCompleteForConfirm(
  draft: Pick<BillImportDraftOmnibus, 'card_id' | 'parse_status' | 'parsed_payload'>
): boolean {
  if (draft.parse_status && draft.parse_status !== 'ready') return false
  if (!draft.card_id) return false
  const p = draft.parsed_payload
  if (p.bill_amount == null || !Number.isFinite(Number(p.bill_amount))) return false
  if (!p.bill_month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.bill_month)) return false
  if (Number(p.bill_amount) > 0 && !p.due_date) return false
  return true
}
