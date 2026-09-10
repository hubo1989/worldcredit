-- WorldCredit D1 (SQLite) initial schema
-- Migrated from Postgres/InsForge. Single-admin model: no RLS, ownership enforced in application layer.
-- SQLite notes: gen_random_uuid() replaced by application-generated crypto.randomUUID().
-- TIMESTAMPTZ -> TEXT (ISO 8601). NUMERIC -> REAL. JSONB -> TEXT (JSON string).

PRAGMA foreign_keys = ON;

-- ============================================
-- Users & Auth (replaces InsForge Auth)
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Platform catalog data (admin maintained)
-- ============================================

CREATE TABLE IF NOT EXISTS banks (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  full_name TEXT,
  logo_url TEXT,
  country TEXT NOT NULL DEFAULT 'CN',
  customer_service_phone TEXT,
  website_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_products (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL DEFAULT 'CN',
  bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_image_id TEXT,
  description_md TEXT,
  apply_url TEXT,
  rewards_summary TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  payment_due_type TEXT NOT NULL DEFAULT 'after_billing' CHECK (payment_due_type IN ('fixed', 'after_billing')),
  payment_due_value INTEGER NOT NULL DEFAULT 20,
  annual_fee REAL DEFAULT 0,
  annual_fee_waiver TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS benefits (
  id TEXT PRIMARY KEY,
  card_product_id TEXT NOT NULL REFERENCES card_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quota INTEGER NOT NULL DEFAULT 1,
  period TEXT NOT NULL DEFAULT 'yearly' CHECK (period IN ('yearly', 'monthly', 'one_time')),
  reset_month INTEGER CHECK (reset_month BETWEEN 1 AND 12),
  expiry_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  card_product_id TEXT REFERENCES card_products(id) ON DELETE SET NULL,
  bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('满减', '折扣', '积分', '返现')),
  start_date TEXT,
  end_date TEXT,
  conditions TEXT,
  max_uses INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- User data
-- ============================================

CREATE TABLE IF NOT EXISTS card_holders (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  managed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  aliases TEXT DEFAULT NULL,
  avatar_color TEXT DEFAULT '#1976d2',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  card_product_id TEXT NOT NULL REFERENCES card_products(id) ON DELETE RESTRICT,
  card_number_last4 TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'cancelled')),
  card_type TEXT NOT NULL DEFAULT 'credit' CHECK (card_type IN ('credit', 'loan')),
  loan_due_day INTEGER CHECK (loan_due_day BETWEEN 1 AND 31),
  override_billing_day INTEGER CHECK (override_billing_day BETWEEN 1 AND 31),
  override_due_type TEXT CHECK (override_due_type IN ('fixed', 'after_billing', 'fixed_before_billing')),
  override_due_value INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  bill_month TEXT NOT NULL,
  statement_start TEXT,
  statement_end TEXT,
  statement_date TEXT,
  bill_amount REAL NOT NULL DEFAULT 0,
  min_payment REAL DEFAULT 0,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, bill_month)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL DEFAULT (date('now')),
  channel TEXT DEFAULT '手动还款',
  note TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS benefit_usages (
  id TEXT PRIMARY KEY,
  benefit_id TEXT NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (date('now')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promo_usages (
  id TEXT PRIMARY KEY,
  promo_id TEXT NOT NULL REFERENCES promos(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  used_at TEXT NOT NULL DEFAULT (date('now')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bill_items (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  transaction_date TEXT,
  post_date TEXT,
  description TEXT NOT NULL,
  merchant_name TEXT,
  category TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  item_type TEXT NOT NULL DEFAULT 'purchase' CHECK (item_type IN ('purchase', 'refund', 'fee', 'interest')),
  source TEXT NOT NULL DEFAULT 'manual',
  confidence REAL,
  raw_text TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

-- ============================================
-- System config
-- ============================================

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT, -- JSON string
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- PWA Push Notifications
-- ============================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminder_logs (
  id TEXT PRIMARY KEY,
  bill_id TEXT REFERENCES bills(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE CASCADE,
  remind_date TEXT,
  remind_type TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, remind_type),
  UNIQUE(card_id, remind_type, remind_date)
);

-- ============================================
-- Bill Email Sources
-- ============================================

CREATE TABLE IF NOT EXISTS bill_email_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, email)
);

-- ============================================
-- Record Attachments (R2)
-- ============================================

CREATE TABLE IF NOT EXISTS record_attachments (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'record-attachments',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bucket, storage_path)
);

-- ============================================
-- Email parse logs
-- ============================================

CREATE TABLE IF NOT EXISTS email_parse_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_email TEXT,
  subject TEXT,
  bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_msg TEXT,
  raw_ai_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- User preferences
-- ============================================

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  display_config TEXT NOT NULL DEFAULT '{"privacy_mode":false,"show_min_payment":true,"show_statement_date":true,"show_annual_fee":true,"show_card_last4":true,"default_currency":"CNY"}',
  reminder_config TEXT NOT NULL DEFAULT '{"remind_days_before":[3,1,0],"quiet_hours_start":"22:00","quiet_hours_end":"08:00","enabled_channels":["web_push"]}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Gmail ledger (from InsForge migrations)
-- ============================================

CREATE TABLE IF NOT EXISTS gmail_ledger_entries (
  id TEXT PRIMARY KEY,
  ledger_id TEXT UNIQUE NOT NULL,
  bank TEXT NOT NULL,
  account_tail TEXT,
  kind TEXT NOT NULL DEFAULT '信用卡',
  region TEXT DEFAULT '国内/中国',
  currency TEXT DEFAULT 'CNY',
  statement_amount REAL DEFAULT 0,
  statement_amount_raw TEXT,
  minimum_payment REAL DEFAULT 0,
  minimum_payment_raw TEXT,
  due_date TEXT,
  statement_date TEXT,
  subject TEXT,
  source TEXT,
  message_id TEXT,
  thread_id TEXT,
  evidence TEXT,
  attachment_path TEXT,
  paid_amount REAL DEFAULT 0,
  remaining_amount REAL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT '未还款' CHECK (payment_status IN ('未还款', '部分还款', '已还清')),
  payment_note TEXT,
  payment_date TEXT,
  last_payment_update TEXT,
  matched_card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  matched_bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bill_import_drafts (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  card_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'text',
  raw_text TEXT,
  file_ref TEXT,
  parsed_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'discarded')),
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bill_import_drafts_user ON bill_import_drafts(created_by, created_at DESC);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_gmail_ledger_bank ON gmail_ledger_entries(bank);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_due_date ON gmail_ledger_entries(due_date);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_payment_status ON gmail_ledger_entries(payment_status);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_matched_bill ON gmail_ledger_entries(matched_bill_id);
ALTER TABLE gmail_ledger_entries ADD COLUMN created_by TEXT;
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_created_by ON gmail_ledger_entries(created_by);
CREATE INDEX idx_banks_name ON banks(name);
CREATE INDEX idx_card_products_bank_id ON card_products(bank_id);
CREATE INDEX idx_card_products_bank ON card_products(bank_name);
CREATE INDEX idx_benefits_product ON benefits(card_product_id);
CREATE INDEX idx_promos_product ON promos(card_product_id);
CREATE INDEX idx_card_holders_created_by ON card_holders(created_by);
CREATE INDEX idx_card_holders_managed_by ON card_holders(managed_by);
CREATE INDEX idx_card_holders_email ON card_holders(email) WHERE email IS NOT NULL;
CREATE INDEX idx_credit_cards_holder ON credit_cards(holder_id);
CREATE INDEX idx_credit_cards_product ON credit_cards(card_product_id);
CREATE INDEX idx_bills_card ON bills(card_id);
CREATE INDEX idx_bills_due_date ON bills(due_date);
CREATE INDEX idx_payments_bill ON payments(bill_id);
CREATE INDEX idx_benefit_usages_benefit ON benefit_usages(benefit_id);
CREATE INDEX idx_promo_usages_promo ON promo_usages(promo_id);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_reminder_logs_bill ON reminder_logs(bill_id);
CREATE INDEX idx_bill_email_sources_user ON bill_email_sources(user_id, created_at DESC);
CREATE INDEX idx_bill_email_sources_email ON bill_email_sources(email) WHERE is_active = 1;
CREATE INDEX idx_record_attachments_record ON record_attachments(record_type, record_id, created_at DESC);
CREATE INDEX idx_email_parse_logs_user ON email_parse_logs(user_id, created_at DESC);
CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

-- ============================================
-- Notification preferences & history (from Postgres migrations)
-- ============================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  bill_due_enabled INTEGER NOT NULL DEFAULT 1,
  overdue_enabled INTEGER NOT NULL DEFAULT 1,
  due_days_before INTEGER NOT NULL DEFAULT 3,
  notify_time TEXT NOT NULL DEFAULT '09:00',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  UNIQUE(user_id, notification_key)
);

CREATE INDEX idx_notification_history_user ON notification_history(user_id, sent_at DESC);
