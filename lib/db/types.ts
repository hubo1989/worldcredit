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
  name_override: string | null
  annual_fee_override: number | null
  /** Civil date (YYYY-MM-DD), null when unknown. Never a timestamp. */
  issued_on: string | null
  /** Civil date (YYYY-MM-DD), null when unknown. Never a timestamp. */
  activated_on: string | null
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
  /** 用户手填的金额（优先级高于一切导入来源）。非空时即为「人工钉住」。 */
  bill_amount_override?: number
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

// ---------------------------------------------------------------------------
// Opportunity ledger rows (migrations/d1/0013). Amounts are integer minor
// units; *_minor columns never hold REAL values. JSON columns hold strings
// validated by json_valid at the database level.
// ---------------------------------------------------------------------------

export interface OpportunityDefinitionRow {
  id: string
  kind: 'benefit' | 'promo' | 'private_reward'
  legacy_benefit_id: string | null
  legacy_promo_id: string | null
  visibility: 'shared' | 'private'
  private_holder_id: string | null
  status: 'active' | 'archived'
  terminated_at: string | null
  termination_reason: string | null
  revision: number
  created_by: string | null // null only for legacy-wrapped definitions
  created_at: string
}

export interface OpportunityRuleVersionRow {
  id: string
  definition_id: string
  version: number
  effective_from: string
  effective_until_before: string | null
  rules_json: string
  verification: 'unverified' | 'user_confirmed' | 'official_verified'
  source_url: string | null
  source_excerpt: string | null
  checked_at: string | null
  checked_by: string | null
  published_at: string
}

export interface OpportunityAccountRow {
  id: string
  definition_id: string
  holder_id: string
  scope_kind: 'card' | 'holder'
  scope_key: string
  eligibility: 'unknown' | 'confirmed' | 'ineligible'
  eligibility_note: string | null
  eligibility_confirmed_by: string | null
  eligibility_confirmed_at: string | null
  eligible_from_on: string | null
  status: 'active' | 'archived'
  revision: number
  created_by: string
  created_at: string
}

export interface OpportunityAccountCardRow {
  account_id: string
  definition_id: string
  holder_id: string
  card_id: string
  retired_at: string | null
}

export interface OpportunityCycleRow {
  id: string
  account_id: string
  version_id: string
  version_as_of_on: string
  cycle_key: string
  allocation_kind: 'regular' | 'grant'
  activation_state: 'active' | 'pending_claim' | 'voided'
  period_start_on: string
  period_end_before: string | null
  usable_start_on: string
  usable_end_before: string | null
  time_zone: string
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  workflow_json: string
  opening_used_count: number
  opening_used_minor: number
  used_count: number
  used_minor: number
  reserved_count: number
  reserved_minor: number
  balance_verified: 0 | 1
  verified_by: string | null
  verified_at: string | null
  opening_as_of_on: string | null
  revision: number
  created_at: string
}

export interface OpportunityCommandRow {
  id: string
  actor_user_id: string
  request_key: string
  request_hash: string
  command_type: string
  result_json: string | null
  created_at: string
}

export interface OpportunityWriteCheckRow {
  command_id: string
  ok: number // always 1; CHECK(ok=1)
}

export interface OpportunityUsageRow {
  id: string
  account_id: string
  cycle_id: string
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  note: string | null
  status: 'active' | 'voided'
  revision: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export interface OpportunityEventRow {
  id: string
  command_id: string
  entity_kind: 'account' | 'usage' | 'cycle' | 'task' | 'fulfillment' | 'legacy'
  entity_id: string
  event_type: string
  account_id: string | null
  cycle_id: string | null
  delta_opening_count: number
  delta_opening_minor: number
  delta_used_count: number
  delta_used_minor: number
  delta_reserved_count: number
  delta_reserved_minor: number
  before_json: string | null
  after_json: string | null
  reason: string | null
  created_at: string
}

export interface OpportunityLegacyLinkRow {
  source_table: 'benefit_usages' | 'promo_usages'
  source_id: string
  target_usage_id: string
  included_in_opening: 0 | 1
  offset_opening_count: number
  offset_opening_minor: number
  assigned_by: string
  reason: string
  assigned_at: string
}

export interface OpportunityUserStateRow {
  user_id: string
  account_id: string
  followed: 0 | 1
  revision: number
  updated_at: string
}
