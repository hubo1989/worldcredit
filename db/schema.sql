-- db/schema.sql

-- ============================================
-- 平台基础数据（管理员维护）
-- ============================================

-- 银行目录（维护支持的银行列表）
CREATE TABLE IF NOT EXISTS banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  full_name TEXT,
  logo_url TEXT,
  country TEXT NOT NULL DEFAULT 'CN',
  customer_service_phone TEXT,
  website_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 信用卡产品目录
CREATE TABLE IF NOT EXISTS card_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL DEFAULT 'CN',
  bank_id UUID REFERENCES banks(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL, -- 冗余字段或处理旧数据
  card_name TEXT NOT NULL,
  card_image_id TEXT,
  description_md TEXT, -- Markdown 格式的卡片介绍
  apply_url TEXT, -- 在线申请链接
  rewards_summary TEXT, -- 积分/返现规则摘要
  currency TEXT NOT NULL DEFAULT 'CNY',
  payment_due_type TEXT NOT NULL DEFAULT 'after_billing'
    CHECK (payment_due_type IN ('fixed', 'after_billing')),
  payment_due_value INT NOT NULL DEFAULT 20,
  annual_fee NUMERIC DEFAULT 0,
  annual_fee_waiver TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 卡产品权益
CREATE TABLE IF NOT EXISTS benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_product_id UUID NOT NULL REFERENCES card_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quota INT NOT NULL DEFAULT 1,
  period TEXT NOT NULL DEFAULT 'yearly'
    CHECK (period IN ('yearly', 'monthly', 'one_time')),
  reset_month INT CHECK (reset_month BETWEEN 1 AND 12),
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 优惠活动
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_product_id UUID REFERENCES card_products(id) ON DELETE SET NULL,
  bank_id UUID REFERENCES banks(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('满减', '折扣', '积分', '返现')),
  start_date DATE,
  end_date DATE,
  conditions TEXT,
  max_uses INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 用户数据
-- ============================================

-- 持卡人档案
CREATE TABLE IF NOT EXISTS card_holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL,  -- InsForge Auth user.id
  name TEXT NOT NULL,
  phone TEXT,
  avatar_color TEXT DEFAULT '#1976d2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用户持有的信用卡
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id UUID NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  card_product_id UUID NOT NULL REFERENCES card_products(id) ON DELETE RESTRICT,
  card_number_last4 TEXT,
  credit_limit NUMERIC NOT NULL DEFAULT 0,
  billing_day INT NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
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

-- 权益使用记录
CREATE TABLE IF NOT EXISTS benefit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id UUID NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  used_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 优惠使用记录
CREATE TABLE IF NOT EXISTS promo_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES promos(id) ON DELETE CASCADE,
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  used_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 系统配置
-- ============================================

-- 系统设置表（KV 存储）
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_banks_name ON banks(name);
CREATE INDEX IF NOT EXISTS idx_card_products_bank_id ON card_products(bank_id);
CREATE INDEX IF NOT EXISTS idx_card_products_bank ON card_products(bank_name);
CREATE INDEX IF NOT EXISTS idx_benefits_product ON benefits(card_product_id);
CREATE INDEX IF NOT EXISTS idx_promos_product ON promos(card_product_id);
CREATE INDEX IF NOT EXISTS idx_card_holders_created_by ON card_holders(created_by);
CREATE INDEX IF NOT EXISTS idx_credit_cards_holder ON credit_cards(holder_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_product ON credit_cards(card_product_id);
CREATE INDEX IF NOT EXISTS idx_bills_card ON bills(card_id);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_benefit_usages_benefit ON benefit_usages(benefit_id);
CREATE INDEX IF NOT EXISTS idx_promo_usages_promo ON promo_usages(promo_id);

-- ============================================
-- PWA Push Notifications
-- ============================================

-- push_subscriptions: 存储用户 Web Push 订阅
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- reminder_logs: 记录已发送提醒，防重复
CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
  remind_type TEXT NOT NULL,  -- '3days' | '1day' | 'due_day'
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bill_id, remind_type)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_bill ON reminder_logs(bill_id);
