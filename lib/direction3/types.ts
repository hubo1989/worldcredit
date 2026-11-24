import type { FxSum } from '@/lib/fx'
import type { Bill, Payment } from '@/lib/types'

export const SPEND_CATEGORIES = [
  'dining',
  'shopping',
  'transport',
  'travel',
  'utilities',
  'entertainment',
  'medical',
  'education',
  'fees_interest',
  'other',
] as const

export type SpendCategory = (typeof SPEND_CATEGORIES)[number]

export const SPEND_CATEGORY_LABELS: Record<SpendCategory | 'uncategorized', string> = {
  dining: '餐饮美食',
  shopping: '日常购物',
  transport: '交通出行',
  travel: '旅行住宿',
  utilities: '生活缴费',
  entertainment: '娱乐订阅',
  medical: '医疗健康',
  education: '教育培训',
  fees_interest: '金融/费用',
  other: '其他',
  uncategorized: '未分类',
}

export type BillItemType =
  | 'purchase'
  | 'refund'
  | 'fee'
  | 'interest'
  | 'installment'
  | 'adjustment'

export type BillItemSource =
  | 'manual'
  | 'csv'
  | 'text'
  | 'llm'
  | 'email'
  | 'sms'
  | 'image'
  | 'pdf'

export interface BillItem {
  id: string
  bill_id: string
  card_id?: string | null
  card_tail?: string | null
  transaction_date?: string | null
  post_date?: string | null
  description: string
  merchant_name?: string | null
  category?: SpendCategory | null
  amount: number
  currency: string
  item_type: BillItemType
  source: BillItemSource
  confidence?: number | null
  raw_text?: string | null
  metadata?: string | null
  updated_at?: string
  created_at: string
}

export interface BillItemInput {
  bill_id?: string
  card_id?: string | null
  card_tail?: string | null
  transaction_date?: string | null
  post_date?: string | null
  description: string
  merchant_name?: string | null
  category?: SpendCategory | null
  amount: number
  currency?: string
  item_type?: BillItemType
  source?: BillItemSource
  confidence?: number | null
  raw_text?: string | null
  metadata?: string | null
}

export interface MerchantCategoryRule {
  id: string
  user_id: string
  normalized_merchant: string
  display_merchant: string
  category: SpendCategory
  updated_at: string
  created_at: string
}

export type InstallmentPlanType = 'purchase' | 'bill' | 'cash'
export type InstallmentFeeMode =
  | 'equal_principal_fee'
  | 'interest_free'
  | 'equal_installment_apr'
export type InstallmentFeeChargeMode = 'per_period' | 'upfront'
export type InstallmentBillingMode = 'included_in_statement' | 'independent'
export type InstallmentStatus = 'active' | 'completed' | 'early_settled' | 'cancelled'

export interface InstallmentPlan {
  id: string
  card_id: string
  source_bill_id?: string | null
  source_item_id?: string | null
  title: string
  plan_type: InstallmentPlanType
  currency: string
  principal_amount: number
  total_periods: number
  paid_periods: number
  fee_mode: InstallmentFeeMode
  fee_charge_mode: InstallmentFeeChargeMode
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
  apr?: number | null
  start_month: string
  due_day: number
  due_month_offset: 0 | 1
  billing_mode: InstallmentBillingMode
  status: InstallmentStatus
  early_settled_at?: string | null
  early_settled_amount?: number | null
  note?: string | null
  created_at: string
  updated_at: string
}

export interface InstallmentPeriod {
  period_index: number
  bill_month: string
  due_date: string
  principal: number
  fee: number
  total: number
  remaining_principal_after: number
  is_paid: boolean
  covered_by_statement?: boolean
}

export interface InstallmentPlanWithSummary extends InstallmentPlan {
  remaining_periods?: number
  unbilled_principal?: number
  next_due_date?: string | null
  next_period_amount?: number | null
  next_period_principal?: number | null
  next_period_fee?: number | null
  card_name?: string
  bank_name?: string
  holder_id?: string
  holder_name?: string
  schedule?: InstallmentPeriod[]
}

export interface CreateInstallmentInput {
  card_id: string
  source_bill_id?: string | null
  source_item_id?: string | null
  title: string
  plan_type: InstallmentPlanType
  currency: string
  principal_amount: number
  total_periods: number
  paid_periods?: number
  fee_mode: InstallmentFeeMode
  fee_charge_mode?: InstallmentFeeChargeMode
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
  apr?: number | null
  start_month: string
  due_day: number
  due_month_offset?: 0 | 1
  billing_mode?: InstallmentBillingMode
  note?: string | null
}

export interface UpdateInstallmentPatch {
  title?: string
  paid_periods?: number
  due_day?: number
  due_month_offset?: 0 | 1
  billing_mode?: InstallmentBillingMode
  status?: InstallmentStatus
  note?: string | null
}

export interface PaymentFxLockFields {
  settled_currency?: string | null
  settled_amount?: number | null
  locked_fx_rate?: number | null
}

export type PaymentWithFx = Payment & PaymentFxLockFields

export type BillDetailWithItems = Bill & {
  items?: BillItem[]
  payments?: PaymentWithFx[]
}

export interface CategoryBreakdownItem {
  category: string
  category_label?: string
  amount: number
  percentage: number
  item_count?: number
  by_currency?: Record<string, number>
  fx_converted?: boolean
  fx_unconverted_currencies?: string[]
  meta_covered_bills?: number
  meta_total_bills?: number
  meta_unallocated_refunds?: Record<string, number>
}

export interface CategoryBreakdownNormalized {
  items: CategoryBreakdownItem[]
  covered_bills: number
  total_bills: number
  fx_converted: boolean
  fx_unconverted_currencies: string[]
  unallocated_refunds_by_currency: Record<string, number>
}

export interface CategoryDrilldownItem {
  id: string
  bill_id: string
  bill_month?: string
  card_id?: string | null
  card_name?: string
  bank_name?: string
  transaction_date?: string | null
  post_date?: string | null
  description: string
  merchant_name?: string | null
  category?: SpendCategory | null
  amount: number
  currency: string
  item_type: BillItemType
}

export type CashflowHorizonDays = 30 | 60 | 90

export interface CashflowTimelineItem {
  id: string
  source_type: 'bill' | 'installment' | 'payable'
  source_id: string
  title: string
  subtitle?: string
  holder_id?: string | null
  holder_name?: string | null
  card_id?: string | null
  due_date: string
  days_until_due: number
  currency: string
  amount: number
  period_index?: number
  total_periods?: number
}

export interface CashflowBucket {
  key: string
  label: string
  bill: number
  installment: number
  payable: number
  total: number
  by_currency: Record<string, { bill: number; installment: number; payable: number; total: number }>
}

export interface CashflowCurrencyReserve {
  bill: number
  installment: number
  payable: number
  total: number
}

export interface CashflowForecastResult {
  horizon_days: CashflowHorizonDays
  as_of_date: string
  display_currency: string
  overdue_alert: {
    count: number
    by_currency: Record<string, number>
    total_converted: number
    fx_converted: boolean
    unconverted_currencies?: string[]
    items: CashflowTimelineItem[]
  }
  reserves_by_currency: Record<string, CashflowCurrencyReserve>
  converted_summary: FxSum
  buckets: CashflowBucket[]
  timeline: CashflowTimelineItem[]
}

export type FamilyExportType =
  | 'bills'
  | 'payments'
  | 'bill_items'
  | 'installments'
  | 'benefit_usages'
  | 'promo_usages'
  | 'opportunity_usages'

export interface FamilyExportRequest {
  type: FamilyExportType
  scope: 'family' | 'holder'
  holder_id?: string
  card_id?: string
  bank_name?: string
  start_date?: string
  end_date?: string
  display_currency?: string
}

export interface StatementReportRequest {
  mode: 'monthly' | 'annual'
  period: string // YYYY-MM or YYYY
  scope: 'family' | 'holder'
  holder_id?: string
  card_id?: string
  display_currency?: string
}

export interface StatementCurrencyRow {
  currency: string
  billed: number
  paid: number
  locked_settled_amount?: number
  locked_settled_currency?: string
  remaining: number
  installment_unbilled: number
  payable_due: number
  overdue_count: number
}

export interface StatementCardRow {
  holder_id: string
  holder_name: string
  bank_name: string
  card_id: string
  card_name: string
  card_tail?: string
  currency: string
  billed: number
  paid: number
  remaining: number
  status: string
  fx_note?: string
}

export interface FamilyStatementReport {
  mode: 'monthly' | 'annual'
  period: string
  period_start: string
  period_end: string
  scope: 'family' | 'holder'
  scope_label: string
  display_currency: string
  generated_at: string
  fx_converted: boolean
  fx_unconverted_currencies: string[]
  currency_summary: StatementCurrencyRow[]
  converted_totals: {
    billed: number
    paid: number
    remaining: number
    installment_unbilled: number
    payable_due: number
    overdue_count: number
  }
  card_rows: StatementCardRow[]
  category_breakdown: CategoryBreakdownItem[]
  installment_summary?: Array<{
    holder_name?: string
    bank_name?: string
    card_name?: string
    title: string
    currency: string
    paid_periods: number
    total_periods: number
    unbilled_principal: number
    status: string
  }>
  payable_summary?: Array<{
    name: string
    holder_name?: string
    currency: string
    amount: number
    paid_amount: number
    due_date?: string
    status: string
  }>
  monthly_breakdown?: Array<{
    month: string
    by_currency: Record<string, { billed: number; paid: number; remaining: number }>
    converted_billed: number
    converted_paid: number
    converted_remaining: number
  }>
}
