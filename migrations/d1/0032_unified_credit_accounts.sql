-- 0032: 多卡统一信用账户模型与保守回填 (E5 Phase 1+2)
--
-- 1. 新建 credit_accounts（信用账户表）与 bill_card_subtotals（账单分卡小计表）
-- 2. credit_cards 挂载 account_id，bills 挂载 account_id 与 UNIQUE(account_id, bill_month)
-- 3. bills.card_id 维持 NOT NULL 锚点卡语义（零破坏既有 5 张外键子表与 9 个同步/防超还触发器）
-- 4. 四家常用合并出账银行（招商、民生、上海、北京）预设 statement_mode='merged', quota_mode='shared'
-- 5. 存量卡片保守回填：同月碰撞绝不合并/不删改，不同持卡人（如民生 0872 与 9765）绝不跨人合并
-- 6. 注册 credit_accounts 与 bill_card_subtotals 的 sync_changes 增量同步触发器

-- ============================================
-- 1. 新增表结构
-- ============================================

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  account_tail TEXT,
  statement_mode TEXT NOT NULL DEFAULT 'independent' CHECK (statement_mode IN ('merged', 'independent')),
  quota_mode TEXT NOT NULL DEFAULT 'independent' CHECK (quota_mode IN ('shared', 'independent')),
  shared_credit_limit REAL,
  billing_day INTEGER CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
  due_type TEXT DEFAULT 'after_billing' CHECK (due_type IS NULL OR due_type IN ('fixed', 'after_billing', 'fixed_before_billing')),
  due_value INTEGER DEFAULT 20,
  primary_card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_holder_bank
  ON credit_accounts(holder_id, bank_id, bank_name, currency);
CREATE INDEX IF NOT EXISTS idx_credit_accounts_primary_card
  ON credit_accounts(primary_card_id);

CREATE TABLE IF NOT EXISTS bill_card_subtotals (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  card_tail TEXT NOT NULL,
  subtotal_amount REAL NOT NULL,
  currency TEXT DEFAULT 'CNY',
  source TEXT DEFAULT 'email' CHECK (source IN ('email', 'manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(bill_id, card_tail)
);

CREATE INDEX IF NOT EXISTS idx_bill_card_subtotals_bill ON bill_card_subtotals(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_card_subtotals_card ON bill_card_subtotals(card_id);

-- ============================================
-- 2. 扩展已有表字段
-- ============================================

ALTER TABLE credit_cards ADD COLUMN account_id TEXT REFERENCES credit_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_credit_cards_account ON credit_cards(account_id);

ALTER TABLE bills ADD COLUMN account_id TEXT REFERENCES credit_accounts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_bills_account ON bills(account_id);

ALTER TABLE bill_items ADD COLUMN card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL;
ALTER TABLE bill_items ADD COLUMN card_tail TEXT;
CREATE INDEX IF NOT EXISTS idx_bill_items_card ON bill_items(card_id);

ALTER TABLE bill_import_drafts ADD COLUMN matched_account_id TEXT REFERENCES credit_accounts(id) ON DELETE SET NULL;
ALTER TABLE bill_import_drafts ADD COLUMN card_subtotals_json TEXT;

-- ============================================
-- 3. 预设首批四家合并账单银行
-- ============================================

UPDATE banks
SET statement_mode = 'merged', quota_mode = 'shared'
WHERE name IN ('招商银行', '中国民生银行', '民生银行', '上海银行', '北京银行')
   OR name LIKE '%招商%'
   OR name LIKE '%民生%'
   OR name LIKE '%上海银行%'
   OR name LIKE '%北京银行%';

-- ============================================
-- 4. 存量卡片与账单保守回填 (Backfill)
-- ============================================

-- 4.1 回填无同月账单碰撞的合并账户 (statement_mode='merged')
WITH candidate_cards AS (
  SELECT
    cc.id AS card_id,
    cc.holder_id,
    COALESCE(cp.bank_id, cp.bank_name, 'UNKNOWN') AS bank_key,
    cp.bank_id,
    COALESCE(cp.bank_name, '未知银行') AS bank_name,
    COALESCE(cp.currency, 'CNY') AS currency,
    cc.billing_day,
    COALESCE(cc.credit_limit_override, cc.credit_limit, 0) AS effective_credit_limit,
    cc.status AS card_status,
    COALESCE(cc.override_due_type, cp.payment_due_type, 'after_billing') AS due_type,
    COALESCE(cc.override_due_value, cp.payment_due_value, 20) AS due_value,
    cc.created_at,
    (SELECT COUNT(*) FROM bills bi WHERE bi.card_id = cc.id) AS bill_count
  FROM credit_cards cc
  LEFT JOIN card_products cp ON cc.card_product_id = cp.id
  LEFT JOIN banks b ON cp.bank_id = b.id
  WHERE cc.account_id IS NULL
    AND cc.card_type != 'loan'
    AND (cc.account_mode_override IS NULL OR cc.account_mode_override != 'single')
    AND (
      COALESCE(b.statement_mode, 'independent') = 'merged'
      OR COALESCE(cp.bank_name, '') LIKE '%招商%'
      OR COALESCE(cp.bank_name, '') LIKE '%民生%'
      OR COALESCE(cp.bank_name, '') LIKE '%上海银行%'
      OR COALESCE(cp.bank_name, '') LIKE '%北京银行%'
      OR cc.account_mode_override = 'multi'
    )
),
group_collision AS (
  SELECT c1.holder_id, c1.bank_key, c1.currency
  FROM bills b1
  JOIN bills b2 ON b1.bill_month = b2.bill_month AND b1.card_id != b2.card_id
  JOIN candidate_cards c1 ON b1.card_id = c1.card_id
  JOIN candidate_cards c2 ON b2.card_id = c2.card_id
  WHERE c1.holder_id = c2.holder_id
    AND c1.bank_key = c2.bank_key
    AND c1.currency = c2.currency
  GROUP BY c1.holder_id, c1.bank_key, c1.currency
),
valid_merged_cards AS (
  SELECT c.*
  FROM candidate_cards c
  WHERE NOT EXISTS (
    SELECT 1 FROM group_collision gc
    WHERE gc.holder_id = c.holder_id
      AND gc.bank_key = c.bank_key
      AND gc.currency = c.currency
  )
),
ranked_merged_cards AS (
  SELECT v.*,
    ROW_NUMBER() OVER (
      PARTITION BY v.holder_id, v.bank_key, v.currency
      ORDER BY (CASE WHEN v.card_status = 'active' THEN 0 ELSE 1 END), v.bill_count DESC, v.created_at ASC
    ) AS rk,
    MAX(v.effective_credit_limit) OVER (
      PARTITION BY v.holder_id, v.bank_key, v.currency
    ) AS pool_limit
  FROM valid_merged_cards v
)
INSERT OR IGNORE INTO credit_accounts (
  id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, shared_credit_limit,
  billing_day, due_type, due_value, primary_card_id, status
)
SELECT
  'acc_m_' || card_id,
  holder_id, bank_id, bank_name, currency, 'merged', 'shared', pool_limit,
  billing_day, due_type, due_value, card_id, 'active'
FROM ranked_merged_cards
WHERE rk = 1;

-- 4.2 更新合并账户卡片的 account_id
WITH candidate_cards AS (
  SELECT
    cc.id AS card_id,
    cc.holder_id,
    COALESCE(cp.bank_id, cp.bank_name, 'UNKNOWN') AS bank_key,
    COALESCE(cp.currency, 'CNY') AS currency,
    cc.status AS card_status,
    cc.created_at,
    (SELECT COUNT(*) FROM bills bi WHERE bi.card_id = cc.id) AS bill_count
  FROM credit_cards cc
  LEFT JOIN card_products cp ON cc.card_product_id = cp.id
  LEFT JOIN banks b ON cp.bank_id = b.id
  WHERE cc.account_id IS NULL
    AND cc.card_type != 'loan'
    AND (cc.account_mode_override IS NULL OR cc.account_mode_override != 'single')
    AND (
      COALESCE(b.statement_mode, 'independent') = 'merged'
      OR COALESCE(cp.bank_name, '') LIKE '%招商%'
      OR COALESCE(cp.bank_name, '') LIKE '%民生%'
      OR COALESCE(cp.bank_name, '') LIKE '%上海银行%'
      OR COALESCE(cp.bank_name, '') LIKE '%北京银行%'
      OR cc.account_mode_override = 'multi'
    )
),
group_collision AS (
  SELECT c1.holder_id, c1.bank_key, c1.currency
  FROM bills b1
  JOIN bills b2 ON b1.bill_month = b2.bill_month AND b1.card_id != b2.card_id
  JOIN candidate_cards c1 ON b1.card_id = c1.card_id
  JOIN candidate_cards c2 ON b2.card_id = c2.card_id
  WHERE c1.holder_id = c2.holder_id AND c1.bank_key = c2.bank_key AND c1.currency = c2.currency
  GROUP BY c1.holder_id, c1.bank_key, c1.currency
),
valid_merged_cards AS (
  SELECT c.*
  FROM candidate_cards c
  WHERE NOT EXISTS (
    SELECT 1 FROM group_collision gc
    WHERE gc.holder_id = c.holder_id AND gc.bank_key = c.bank_key AND gc.currency = c.currency
  )
),
primary_map AS (
  SELECT v.card_id,
    FIRST_VALUE('acc_m_' || v.card_id) OVER (
      PARTITION BY v.holder_id, v.bank_key, v.currency
      ORDER BY (CASE WHEN v.card_status = 'active' THEN 0 ELSE 1 END), v.bill_count DESC, v.created_at ASC
    ) AS target_account_id
  FROM valid_merged_cards v
)
UPDATE credit_cards
SET account_id = (SELECT target_account_id FROM primary_map WHERE primary_map.card_id = credit_cards.id)
WHERE id IN (SELECT card_id FROM primary_map);

-- 4.3 剩余卡片（独立出账卡、贷款卡、明确单卡覆盖、以及发生同月碰撞的卡组）各自生成独立账户
INSERT OR IGNORE INTO credit_accounts (
  id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, shared_credit_limit,
  billing_day, due_type, due_value, primary_card_id, status
)
SELECT
  'acc_i_' || cc.id,
  cc.holder_id,
  cp.bank_id,
  COALESCE(cp.bank_name, '未知银行'),
  COALESCE(cp.currency, 'CNY'),
  'independent',
  COALESCE(b.quota_mode, 'independent'),
  NULL,
  cc.billing_day,
  COALESCE(cc.override_due_type, cp.payment_due_type, 'after_billing'),
  COALESCE(cc.override_due_value, cp.payment_due_value, 20),
  cc.id,
  'active'
FROM credit_cards cc
LEFT JOIN card_products cp ON cc.card_product_id = cp.id
LEFT JOIN banks b ON cp.bank_id = b.id
WHERE cc.account_id IS NULL;

UPDATE credit_cards
SET account_id = 'acc_i_' || id
WHERE account_id IS NULL;

-- 4.4 回填历史 bills.account_id 并对齐合并账户的 bills.card_id（锚点卡语义）
UPDATE bills
SET account_id = (SELECT account_id FROM credit_cards WHERE credit_cards.id = bills.card_id)
WHERE account_id IS NULL;

UPDATE bills
SET card_id = (SELECT primary_card_id FROM credit_accounts ca WHERE ca.id = bills.account_id)
WHERE bills.account_id IN (SELECT id FROM credit_accounts WHERE statement_mode = 'merged');

-- 4.5 建立唯一索引：每信用账户每出账月最多 1 条权威账单
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_account_month
  ON bills(account_id, bill_month)
  WHERE account_id IS NOT NULL;

-- ============================================
-- 5. 离线同步 (sync_changes) 触发器
-- ============================================

-- credit_accounts
CREATE TRIGGER IF NOT EXISTS trg_credit_accounts_insert AFTER INSERT ON credit_accounts BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_accounts', NEW.id, 'upsert'
  FROM card_holders ch WHERE ch.id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_accounts_update AFTER UPDATE ON credit_accounts BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_accounts', NEW.id, 'upsert'
  FROM card_holders ch WHERE ch.id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_accounts_delete AFTER DELETE ON credit_accounts BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_accounts', OLD.id, 'delete'
  FROM card_holders ch WHERE ch.id = OLD.holder_id;
END;

-- bill_card_subtotals
CREATE TRIGGER IF NOT EXISTS trg_bill_card_subtotals_insert AFTER INSERT ON bill_card_subtotals BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_card_subtotals', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = NEW.bill_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_card_subtotals_update AFTER UPDATE ON bill_card_subtotals BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_card_subtotals', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = NEW.bill_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_card_subtotals_delete AFTER DELETE ON bill_card_subtotals BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_card_subtotals', OLD.id, 'delete'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = OLD.bill_id;
END;

-- 将存量回填生成的 credit_accounts 写入 sync_changes
INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT ch.managed_by, 'credit_accounts', ca.id, 'upsert'
FROM credit_accounts ca
JOIN card_holders ch ON ch.id = ca.holder_id
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes sc
  WHERE sc.tbl = 'credit_accounts' AND sc.row_id = ca.id
);
