-- db/schema.sql

-- 用户表（由 Auth 管理，这里扩展 profile）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE NOT NULL,  -- Auth 用户 ID
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 持卡人档案
CREATE TABLE IF NOT EXISTS card_holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  avatar_color TEXT DEFAULT '#1976d2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 信用卡
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id UUID NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'CN',
  bank_name TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_number_last4 TEXT,
  card_image_id TEXT,
  credit_limit NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  billing_day INT NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  payment_due_type TEXT NOT NULL DEFAULT 'after_billing'
    CHECK (payment_due_type IN ('fixed', 'after_billing')),
  payment_due_value INT NOT NULL DEFAULT 20,
  annual_fee NUMERIC DEFAULT 0,
  annual_fee_waiver TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 账单
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  bill_month TEXT NOT NULL,  -- '2026-03'
  statement_start DATE,
  statement_end DATE,
  statement_date DATE,
  bill_amount NUMERIC NOT NULL DEFAULT 0,
  min_payment NUMERIC DEFAULT 0,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(card_id, bill_month)
);

-- 还款记录
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT DEFAULT '手动还款',
  note TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 权益定义
CREATE TABLE IF NOT EXISTS benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quota INT NOT NULL DEFAULT 1,
  period TEXT NOT NULL DEFAULT 'yearly'
    CHECK (period IN ('yearly', 'monthly', 'one_time')),
  reset_month INT CHECK (reset_month BETWEEN 1 AND 12),
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_card_holders_managed_by ON card_holders(managed_by);
CREATE INDEX IF NOT EXISTS idx_credit_cards_holder ON credit_cards(holder_id);
CREATE INDEX IF NOT EXISTS idx_bills_card ON bills(card_id);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(bill_id);
