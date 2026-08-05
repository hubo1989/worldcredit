-- db/schema.sql

-- 用户表（由 InsForge Auth 管理，这里扩展 profile）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE NOT NULL,  -- InsForge Auth 用户 ID
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 持卡人档案
CREATE TABLE IF NOT EXISTS card_holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES users(id),  -- Phase 3: 持卡人独立账号
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

-- 账单明细（LLM 识别或手动录入）
CREATE TABLE IF NOT EXISTS bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  transaction_date DATE,
  post_date DATE,
  description TEXT NOT NULL,
  merchant_name TEXT,
  category TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT,
  item_type TEXT NOT NULL DEFAULT 'purchase'
    CHECK (item_type IN ('purchase', 'refund', 'fee', 'interest', 'payment', 'adjustment', 'other')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'llm', 'import')),
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  raw_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- 权益使用记录
CREATE TABLE IF NOT EXISTS benefit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id UUID NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  used_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 优惠活动定义
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('满减', '折扣', '积分', '返现')),
  start_date DATE,
  end_date DATE,
  conditions TEXT,
  max_uses INT,
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

-- 索引
CREATE INDEX idx_card_holders_managed_by ON card_holders(managed_by);
CREATE INDEX idx_credit_cards_holder ON credit_cards(holder_id);
CREATE INDEX idx_bills_card ON bills(card_id);
CREATE INDEX idx_bills_due_date ON bills(due_date);
CREATE INDEX idx_bill_items_bill ON bill_items(bill_id);
CREATE INDEX idx_bill_items_transaction_date ON bill_items(transaction_date);
CREATE INDEX idx_bill_items_category ON bill_items(category);
CREATE INDEX idx_payments_bill ON payments(bill_id);
CREATE INDEX idx_benefit_usages_benefit ON benefit_usages(benefit_id);
CREATE INDEX idx_promo_usages_promo ON promo_usages(promo_id);

-- ===========================================
-- Row Level Security (RLS)
-- ===========================================

-- 启用 RLS
ALTER TABLE card_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefit_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_usages ENABLE ROW LEVEL SECURITY;

-- card_holders: 管理员只能访问自己管理的持卡人
CREATE POLICY "admin_manage_holders" ON card_holders
  FOR ALL
  USING (managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Phase 3: 持卡人自助访问（取消注释启用）
-- CREATE POLICY "holder_self_access" ON card_holders
--   FOR SELECT
--   USING (auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- credit_cards: 通过 holder_id → card_holders 链式保护
CREATE POLICY "admin_manage_cards" ON credit_cards
  FOR ALL
  USING (holder_id IN (
    SELECT id FROM card_holders WHERE managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (holder_id IN (
    SELECT id FROM card_holders WHERE managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- bills: 通过 card_id → credit_cards → card_holders 链式保护
CREATE POLICY "admin_manage_bills" ON bills
  FOR ALL
  USING (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- bill_items: 通过 bill_id → bills → credit_cards → card_holders 链式保护
CREATE POLICY "admin_manage_bill_items" ON bill_items
  FOR ALL
  USING (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- payments: 通过 bill_id → bills → credit_cards → card_holders 链式保护
CREATE POLICY "admin_manage_payments" ON payments
  FOR ALL
  USING (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- benefits: 通过 card_id → credit_cards → card_holders 链式保护
CREATE POLICY "admin_manage_benefits" ON benefits
  FOR ALL
  USING (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- benefit_usages: 通过 benefit_id → benefits → credit_cards → card_holders 链式保护
CREATE POLICY "admin_manage_benefit_usages" ON benefit_usages
  FOR ALL
  USING (benefit_id IN (
    SELECT ben.id FROM benefits ben
    JOIN credit_cards cc ON ben.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ))
  WITH CHECK (benefit_id IN (
    SELECT ben.id FROM benefits ben
    JOIN credit_cards cc ON ben.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- promos: card_id 可为 null（全行通用），因此需要特殊处理
CREATE POLICY "admin_manage_promos" ON promos
  FOR ALL
  USING (
    card_id IS NULL  -- 全行通用优惠所有管理员可见
    OR card_id IN (
      SELECT cc.id FROM credit_cards cc
      JOIN card_holders ch ON cc.holder_id = ch.id
      WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  )
  WITH CHECK (
    card_id IS NULL
    OR card_id IN (
      SELECT cc.id FROM credit_cards cc
      JOIN card_holders ch ON cc.holder_id = ch.id
      WHERE ch.managed_by IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  );

-- promo_usages: 通过 promo_id → promos 继承访问控制
CREATE POLICY "admin_manage_promo_usages" ON promo_usages
  FOR ALL
  USING (promo_id IN (
    SELECT id FROM promos  -- promos 已有 RLS 保护
  ))
  WITH CHECK (promo_id IN (
    SELECT id FROM promos
  ));
