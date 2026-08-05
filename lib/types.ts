// lib/types.ts

export interface User {
  id: string
  auth_id: string
  email: string
  name: string
  role: 'admin' | 'member'
  created_at: string
}

export interface CardHolder {
  id: string
  managed_by: string
  auth_user_id?: string
  name: string
  phone?: string
  email?: string
  avatar_color: string
  created_at: string
}

export interface CreditCard {
  id: string
  holder_id: string
  country: string
  bank_name: string
  card_name: string
  card_number_last4?: string
  card_image_id?: string
  credit_limit: number
  currency: string
  billing_day: number
  payment_due_type: 'fixed' | 'after_billing'
  payment_due_value: number
  annual_fee: number
  annual_fee_waiver?: string
  status: 'active' | 'frozen' | 'cancelled'
  created_at: string
}

export interface Bill {
  id: string
  card_id: string
  bill_month: string
  statement_start?: string
  statement_end?: string
  statement_date?: string
  bill_amount: number
  min_payment: number
  due_date: string
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
  created_at: string
}

export interface BillItem {
  id: string
  bill_id: string
  transaction_date?: string
  post_date?: string
  description: string
  merchant_name?: string
  category?: string
  amount: number
  currency?: string
  item_type: 'purchase' | 'refund' | 'fee' | 'interest' | 'payment' | 'adjustment' | 'other'
  source: 'manual' | 'llm' | 'import'
  confidence?: number
  raw_text?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface Payment {
  id: string
  bill_id: string
  amount: number
  paid_at: string
  channel: string
  note?: string
  idempotency_key: string
  created_at: string
}

export interface Benefit {
  id: string
  card_id: string
  name: string
  description?: string
  quota: number
  period: 'yearly' | 'monthly' | 'one_time'
  reset_month?: number
  expiry_date?: string
  created_at: string
}

export interface BenefitUsage {
  id: string
  benefit_id: string
  used_at: string
  note?: string
  created_at: string
}

export interface Promo {
  id: string
  card_id?: string
  bank_name: string
  title: string
  description?: string
  discount_type?: '满减' | '折扣' | '积分' | '返现'
  start_date?: string
  end_date?: string
  conditions?: string
  max_uses?: number
  created_at: string
}

export interface PromoUsage {
  id: string
  promo_id: string
  card_id?: string
  used_at: string
  note?: string
  created_at: string
}
