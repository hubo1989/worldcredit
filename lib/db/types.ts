// lib/db/types.ts — SQLite/D1 row types (TEXT timestamps, REAL amounts, INTEGER booleans)

export interface UserRow {
  id: string
  email: string
  password_hash: string
  name: string | null
  role: 'admin' | 'member'
  created_at: string
}

export interface BankRow {
  id: string
  name: string
  full_name: string | null
  logo_url: string | null
  country: string
  customer_service_phone: string | null
  website_url: string | null
  is_active: number // 0 | 1
  created_at: string
}

export interface CardProductRow {
  id: string
  country: string
  bank_id: string | null
  bank_name: string
  card_name: string
  card_image_id: string | null
  description_md: string | null
  apply_url: string | null
  rewards_summary: string | null
  currency: string
  payment_due_type: 'fixed' | 'after_billing'
  payment_due_value: number
  annual_fee: number | null
  annual_fee_waiver: string | null
  is_active: number
  created_at: string
}

export interface BenefitRow {
  id: string
  card_product_id: string
  name: string
  description: string | null
  quota: number
  period: 'yearly' | 'monthly' | 'one_time'
  reset_month: number | null
  expiry_date: string | null
  created_at: string
}

export interface PromoRow {
  id: string
  card_product_id: string | null
  bank_id: string | null
  bank_name: string
  title: string
  description: string | null
  discount_type: string | null
  start_date: string | null
  end_date: string | null
  conditions: string | null
  max_uses: number | null
  is_active: number
  created_at: string
}

export interface CardHolderRow {
  id: string
  created_by: string
  managed_by: string
  name: string
  phone: string | null
  email: string | null
  avatar_color: string | null
  created_at: string
}

export interface CreditCardRow {
  id: string
  holder_id: string
  card_product_id: string
  card_number_last4: string | null
  credit_limit: number
  billing_day: number
  status: 'active' | 'frozen' | 'cancelled'
  card_type: 'credit' | 'loan'
  loan_due_day: number | null
  override_billing_day: number | null
  override_due_type: 'fixed' | 'after_billing' | 'fixed_before_billing' | null
  override_due_value: number | null
  created_at: string
}

export interface BillRow {
  id: string
  card_id: string
  bill_month: string
  statement_start: string | null
  statement_end: string | null
  statement_date: string | null
  bill_amount: number
  min_payment: number | null
  due_date: string
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
  created_at: string
}

export interface PaymentRow {
  id: string
  bill_id: string
  amount: number
  paid_at: string
  channel: string | null
  note: string | null
  idempotency_key: string
  created_at: string
}

export interface BenefitUsageRow {
  id: string
  benefit_id: string
  used_at: string
  note: string | null
  created_at: string
}

export interface PromoUsageRow {
  id: string
  promo_id: string
  card_id: string | null
  used_at: string
  note: string | null
  created_at: string
}

export interface SystemSettingRow {
  key: string
  value: string | null // JSON string
  updated_at: string
}

export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export interface ReminderLogRow {
  id: string
  bill_id: string | null
  card_id: string | null
  remind_date: string | null
  remind_type: string
  sent_at: string
}

export interface BillEmailSourceRow {
  id: string
  user_id: string
  email: string
  label: string | null
  is_active: number
  created_at: string
}

export interface RecordAttachmentRow {
  id: string
  record_type: string
  record_id: string
  bucket: string
  storage_path: string
  file_name: string
  file_type: string | null
  file_size: number | null
  uploaded_by: string | null
  created_at: string
}

export interface EmailParseLogRow {
  id: string
  user_id: string
  from_email: string | null
  subject: string | null
  bill_id: string | null
  status: 'success' | 'failed' | 'skipped'
  error_msg: string | null
  raw_ai_response: string | null
  created_at: string
}

export interface UserPreferencesRow {
  id: string
  user_id: string
  display_config: string // JSON string
  reminder_config: string // JSON string
  updated_at: string
}

export interface GmailLedgerEntryRow {
  id: string
  user_id: string
  gmail_message_id: string
  thread_id: string | null
  from_email: string | null
  subject: string | null
  snippet: string | null
  internal_date: string | null
  label_ids: string | null // JSON array string
  raw_text: string | null
  parsed_bill: string | null // JSON string
  created_at: string
}

export interface BillImportDraftRow {
  id: string
  user_id: string
  source_type: string
  source_id: string | null
  card_id: string | null
  status: 'pending' | 'confirmed' | 'discarded'
  draft_data: string // JSON string
  confirmed_bill_id: string | null
  created_at: string
}
