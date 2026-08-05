/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  /** InsForge (Supabase-compatible) base URL, e.g. https://dr7vjx28.us-east.insforge.app */
  INSFORGE_URL: string
  /** InsForge service_role JWT — bypasses Row-Level Security. Set via `wrangler secret put` */
  INSFORGE_SERVICE_KEY: string
}

// ─── InsForge REST helpers ────────────────────────────────────────────────────

export interface AiConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface SystemSetting {
  key: string
  value: AiConfig | Record<string, unknown>
}

export interface CreditCard {
  id: string
  holder_id: string
  card_last4: string | null
  credit_limit: number
  card_product_id: string | null
}

export interface CardHolder {
  id: string
  created_by: string // user UUID
}

// ─── AI parsing result ────────────────────────────────────────────────────────

export interface BillParseResult {
  is_bill?: false
  bank_name?: string
  card_last4?: string | null
  bill_amount?: number
  min_payment?: number | null
  due_date?: string        // YYYY-MM-DD
  bill_month?: string      // YYYY-MM
  statement_date?: string | null
  currency?: string
  confidence?: number
}

// ─── DB row shapes for upsert ─────────────────────────────────────────────────

export interface BillRow {
  card_id: string
  bill_month: string
  bill_amount: number
  min_payment: number | null
  due_date: string
  statement_date: string | null
  status: 'unpaid'
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
