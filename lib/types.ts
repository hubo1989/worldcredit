/**
 * 银行目录
 */
export interface Bank {
  id: string
  name: string
  full_name?: string
  logo_url?: string
  country: string
  customer_service_phone?: string
  website_url?: string
  is_active: boolean
  created_at: string
}

/**
 * 信用卡产品目录
 */
export interface CardProduct {
  id: string
  country: string
  bank_id?: string
  bank_name: string
  card_name: string
  card_image_id?: string
  description_md?: string
  apply_url?: string
  rewards_summary?: string
  currency: string
  payment_due_type: 'fixed' | 'after_billing' | 'fixed_before_billing'
  payment_due_value: number
  annual_fee?: number
  annual_fee_waiver?: string
  is_active: boolean
  created_at: string
}

/**
 * 卡产品权益
 */
export interface Benefit {
  id: string
  card_product_id: string
  name: string
  description?: string
  quota: number
  period: 'yearly' | 'monthly' | 'one_time'
  reset_month?: number
  expiry_date?: string
  created_at: string
}

/**
 * 优惠活动
 */
export interface Promo {
  id: string
  card_product_id?: string
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

/**
 * 持卡人档案
 */
export interface CardHolder {
  id: string
  created_by: string // InsForge Auth user.id
  name: string
  phone?: string
  avatar_color: string
  created_at: string
}

/**
 * 用户持有的信用卡
 */
export interface CreditCard {
  id: string
  holder_id: string
  card_product_id: string
  card_number_last4?: string
  credit_limit: number
  billing_day: number
  status: 'active' | 'frozen' | 'cancelled'
  /** 卡类型：信用卡 / 贷款类 */
  card_type: 'credit' | 'loan'
  /** 贷款类专用：每月固定还款日（1-31） */
  loan_due_day?: number
  /** 覆盖卡产品默认账单日（NULL = 使用卡产品默认值） */
  override_billing_day?: number
  /** 覆盖还款规则类型 */
  override_due_type?: 'fixed' | 'after_billing' | 'fixed_before_billing' | null
  /** 覆盖还款规则值 */
  override_due_value?: number | null
  created_at: string
}

/**
 * 账单
 */
export interface Bill {
  id: string
  card_id: string
  bill_month: string // '2026-03'
  statement_start?: string
  statement_end?: string
  statement_date?: string
  bill_amount: number
  min_payment?: number
  due_date: string
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
  created_at: string
}

/**
 * 还款记录
 */
export interface Payment {
  id: string
  bill_id: string
  amount: number
  paid_at: string
  channel?: string
  note?: string
  idempotency_key: string
  created_at: string
}

/**
 * 权益使用记录
 */
export interface BenefitUsage {
  id: string
  benefit_id: string
  used_at: string
  note?: string
  created_at: string
}

/**
 * 优惠使用记录
 */
export interface PromoUsage {
  id: string
  promo_id: string
  card_id?: string
  used_at: string
  note?: string
  created_at: string
}

/**
 * PWA Web Push 订阅
 */
export interface PushSubscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

/**
 * 提醒发送日志
 */
export interface ReminderLog {
  id: string
  bill_id?: string
  card_id?: string
  remind_date?: string
  remind_type: '3days' | '1day' | 'due_day' | 'loan_3days' | 'loan_1day' | 'loan_due_day'
  sent_at: string
}

/**
 * 邮件解析日志（账单自动录入审计）
 */
export interface EmailParseLog {
  id: string
  user_id: string
  from_email?: string
  subject?: string
  bill_id?: string
  status: 'success' | 'failed' | 'skipped'
  error_msg?: string
  raw_ai_response?: string
  created_at: string
}
