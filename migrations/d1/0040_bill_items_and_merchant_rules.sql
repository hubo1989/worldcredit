-- 0040_bill_items_and_merchant_rules.sql
-- 1. 重建 bill_items：扩展 item_type 枚举（新增 installment / adjustment）、
--    强制非 adjustment 条目 amount >= 0（防 refund 双重负号）、补充标准 10 类 CHECK 与复合索引。
-- 2. 新建 merchant_category_rules：用户级商户自动分类记忆规则表。

CREATE TABLE bill_items_v2 (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  card_tail TEXT,
  transaction_date TEXT,
  post_date TEXT,
  description TEXT NOT NULL,
  merchant_name TEXT,
  category TEXT CHECK (
    category IS NULL OR category IN (
      'dining', 'shopping', 'transport', 'travel', 'utilities',
      'entertainment', 'medical', 'education', 'fees_interest', 'other'
    )
  ),
  amount REAL NOT NULL DEFAULT 0 CHECK (item_type = 'adjustment' OR amount >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  item_type TEXT NOT NULL DEFAULT 'purchase' CHECK (
    item_type IN ('purchase', 'refund', 'fee', 'interest', 'installment', 'adjustment')
  ),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (
    source IN ('manual', 'csv', 'text', 'llm', 'email', 'sms', 'image', 'pdf')
  ),
  confidence REAL,
  raw_text TEXT,
  metadata TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO bill_items_v2 (
  id, bill_id, card_id, card_tail, transaction_date, post_date,
  description, merchant_name, category, amount, currency,
  item_type, source, confidence, raw_text, metadata, updated_at, created_at
)
SELECT
  id, bill_id, card_id, card_tail, transaction_date, post_date,
  description, merchant_name,
  CASE WHEN category IN (
    'dining', 'shopping', 'transport', 'travel', 'utilities',
    'entertainment', 'medical', 'education', 'fees_interest', 'other'
  ) THEN category ELSE NULL END,
  CASE WHEN item_type = 'adjustment' THEN amount ELSE ABS(amount) END,
  COALESCE(NULLIF(TRIM(currency), ''), 'CNY'),
  CASE WHEN item_type IN ('purchase', 'refund', 'fee', 'interest', 'installment', 'adjustment')
    THEN item_type ELSE 'purchase' END,
  CASE WHEN source IN ('manual', 'csv', 'text', 'llm', 'email', 'sms', 'image', 'pdf')
    THEN source ELSE 'manual' END,
  confidence, raw_text, metadata,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
FROM bill_items;

DROP TABLE bill_items;
ALTER TABLE bill_items_v2 RENAME TO bill_items;

CREATE INDEX IF NOT EXISTS idx_bill_items_bill
  ON bill_items(bill_id, transaction_date DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_bill_items_card
  ON bill_items(card_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_category
  ON bill_items(bill_id, category);

CREATE TABLE IF NOT EXISTS merchant_category_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_merchant TEXT NOT NULL,
  display_merchant TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'dining', 'shopping', 'transport', 'travel', 'utilities',
      'entertainment', 'medical', 'education', 'fees_interest', 'other'
    )
  ),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(user_id, normalized_merchant)
);

CREATE INDEX IF NOT EXISTS idx_merchant_category_rules_user
  ON merchant_category_rules(user_id);
