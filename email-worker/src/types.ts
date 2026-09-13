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
