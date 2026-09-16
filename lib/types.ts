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
  discount_type?: string
  start_date?: string
  end_date?: string
  conditions?: string
  max_uses?: number
  /** 结构化使用规则（前端示例数据/展示用，云端可空） */
  rules?: { category: string; quota: string; channel: string }
  created_at: string
}

/**
 * 用户角色（应用层邮箱判定的逻辑角色，非数据库字段）
 */
export type UserRole = 'admin' | 'member'

/**
 * 应用层用户（由 InsForge Auth 的 UserSchema 派生，见 lib/permissions.ts 的 toUser）
 */
export interface User {
  id: string
  auth_id: string
  email: string
  name: string
  role: UserRole
  created_at: string
}

/**
 * 持卡人档案
 */
export interface CardHolder {
  id: string
  created_by: string
  auth_user_id?: string | null
  managed_by?: string
  name: string
  phone?: string
  email?: string
  avatar_color: string
  aliases?: string[]
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
  override_billing_day?: number | null
  /** 覆盖还款规则类型 */
  override_due_type?: 'fixed' | 'after_billing' | 'fixed_before_billing' | null
  /** 覆盖还款规则值 */
  override_due_value?: number | null
  /** 卡片名称覆盖（NULL = 使用卡产品默认名称） */
  name_override?: string | null
  /** 年费覆盖（NULL = 使用卡产品默认年费） */
  annual_fee_override?: number | null
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
  /** 用户手填的金额（优先级高于一切导入来源）。非空时即为「人工钉住」。 */
  bill_amount_override?: number
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

/**
 * 通用记录附件 metadata。文件保存在 InsForge Storage。
 */
export interface RecordAttachment {
  id: string
  record_type: string
  record_id: string
  bucket: string
  storage_path: string
  file_name: string
  file_type?: string
  file_size?: number
  public_url?: string
  uploaded_by?: string
  created_at: string
}

/**
 * 用户自定义显示偏好设置
 */
export interface UserDisplayConfig {
  privacy_mode: boolean
  show_min_payment: boolean
  show_statement_date: boolean
  show_annual_fee: boolean
  show_card_last4: boolean
  default_currency: string
}

/**
 * 用户自定义提醒规则与通道设置
 */
export interface UserReminderConfig {
  remind_days_before: number[]
  quiet_hours_start?: string
  quiet_hours_end?: string
  enabled_channels: ('web_push' | 'email' | 'webhook')[]
  custom_reminder_email?: string
}

/**
 * 用户全局个性化配置
 */
export interface UserPreferences {
  id?: string
  user_id: string
  display_config: UserDisplayConfig
  reminder_config: UserReminderConfig
  updated_at?: string
}

/* ============================================================
 * AI 助手相关类型
 * ============================================================ */

/**
 * AI 助手页面模式（驱动空状态/加载/错误/对话视图切换）
 */
export type AiPageMode = 'empty' | 'loading' | 'error' | 'conversation'

/**
 * AI 单条对话消息
 */
export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  created_at: number
  error?: boolean
}

/**
 * AI 助手欢迎横幅所需的真实个性化上下文
 */
export interface AiWelcomeContext {
  /** 用于问候语的持卡人姓名（优先取第一个持卡人，否则用兜底文案） */
  holderName?: string
  /** 当前用户名下活跃卡数量 */
  cardCount: number
  /** 未结清账单数 */
  pendingBills: number
  /** 已逾期账单数 */
  overdueCount: number
  /** 未来 7 天内到期账单数 */
  dueSoonCount: number
  /** 剩余应还总额（CNY） */
  totalRemaining: number
}

/**
 * 场景化快捷问题分组
 */
export interface ScenarioGroup {
  /** 分组唯一标识，如 'bills' */
  id: string
  /** 分组标题，如 "查账单" */
  title: string
  /** 图标 emoji 或 MUI icon 名 */
  emoji: string
  /** 该分组下的快捷问题列表 */
  questions: string[]
}
