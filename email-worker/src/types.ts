export interface Env {
  DB: D1Database
}

export interface AiConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface BillParseResult {
  is_bill: boolean
  bank_name?: string
  /** Card/account ending as printed in the mail: 4 digits, or 5-6 for Amex. */
  card_last4?: string | null
  bill_amount?: number
  min_payment?: number | null
  due_date?: string
  bill_month?: string
  statement_date?: string | null
  currency?: string
  confidence?: number
}

export interface BillRow {
  id?: string
  card_id: string
  bill_month: string
  bill_amount: number
  min_payment: number | null
  due_date: string
  statement_date: string | null
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
}

export interface EmailParseLogRow {
  user_id: string
  from_email: string | null
  subject: string | null
  bill_id: string | null
  status: 'success' | 'failed' | 'skipped'
  error_msg: string | null
  raw_ai_response: string | null
}

// ─── 原始 MIME 解析 ───────────────────────────────────────────────────────────

/** 从原始邮件里解出的附件（字节已按 Content-Transfer-Encoding 还原）。 */
export interface RawAttachment {
  /** 附件文件名；邮件没给名字时是空串。 */
  filename: string
  contentType: string
  bytes: Uint8Array
  /** Content-ID，暂时不用，保留给将来对齐内嵌图片/账单。 */
  contentId: string | null
}

/** 顶层邮件头（未解码原文），供上层解 RFC 2047 与判债主用。 */
export interface RawHeaders {
  from: string | null
  to: string | null
  subject: string | null
  date: string | null
  charset: string | null
  contentType: string
  encoding: string
}

export interface ParsedRawMessage {
  headers: RawHeaders
  /** text/plain 优先，没有才退回去标签后的 text/html，已截断到 8000 字。 */
  text: string
  attachments: RawAttachment[]
}

// ─── 转发账单包 ───────────────────────────────────────────────────────────────

/** 持卡人识别结果的来源，用于如实记录「这个账单凭什么是这个人的」。 */
export type HolderMatchSource = 'header_name' | 'body_honorific' | 'default_holder' | 'unknown'

/** 一封嵌套账单邮件解析后的中间结果，尚未落库。 */
export interface NestedBillMessage {
  /** 附件文件名或编号，仅用于日志定位。 */
  label: string
  subject: string | null
  from: string | null
  /** 嵌套邮件的 To 头原文。 */
  to: string | null
  text: string
  /** 从 To 头里解出的显示名（如「张改菊 女士」），取不到为 null。 */
  headerName: string | null
  /** 从正文称呼里解出的名字（如「高敏」），取不到为 null。 */
  bodyName: string | null
}

/** 一条待写入 bills 的记录：已绑定到具体持卡人与卡片。 */
export interface HolderScopedBill {
  holderId: string
  holderName: string
  cardId: string
  billId: string
  aiResult: BillParseResult
  /** 记录这条账单的归属依据，便于排查「为什么算到他头上」。 */
  matchSource: HolderMatchSource
}

export interface ForwardedBundleOutcome {
  /** 顶层流里解析出的附件总数。 */
  attachmentCount: number
  /** 只统计 .eml 附件，它们才是账单本体。 */
  nestedCount: number
  /** 被跳过、没有加进 bills 的嵌套附件及原因。 */
  skipped: Array<{ label: string; reason: string }>
  /** 非 .eml 附件（如 PDF），本轮不解析。 */
  unsupported: string[]
  /** 已识别持卡人并写入或更新账单的数量。 */
  billsWritten: number
  /** 每条账单的持卡人、卡片与归属依据，写进日志便于排查「为什么算到他头上」。 */
  written: HolderScopedBill[]
  /** 汇总写入 email_parse_logs.error_msg 的说明文本。 */
  summary: string
}
