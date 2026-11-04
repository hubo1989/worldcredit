-- 0030：固定支出支持多周期（每月 / 每 X 月 / 每年）与自定义分类持久化。
--
-- 兼容性约束：
--   1. 旧记录默认 cycle_type = 'monthly'、cycle_months = 1，due_month / anchor_period / custom_category 为 NULL，行为不变；
--   2. recurring_payables.category 保持原有 5 个枚举值（自定义分类写 category = 'other' + custom_category = '<名称>'），
--      不破坏 0009 的 CHECK 约束，也不破坏旧版 iOS PayableCategory 强类型解码；
--   3. 新增列随 sync/pull 的 SELECT t.* 下发，旧客户端忽略未知字段不崩。

ALTER TABLE recurring_payables
  ADD COLUMN cycle_type TEXT NOT NULL DEFAULT 'monthly'
  CHECK (cycle_type IN ('monthly', 'every_n_months', 'yearly'));

ALTER TABLE recurring_payables
  ADD COLUMN cycle_months INTEGER NOT NULL DEFAULT 1
  CHECK (cycle_months BETWEEN 1 AND 60);

ALTER TABLE recurring_payables
  ADD COLUMN due_month INTEGER
  CHECK (due_month IS NULL OR (due_month BETWEEN 1 AND 12));

ALTER TABLE recurring_payables
  ADD COLUMN anchor_period TEXT;

ALTER TABLE recurring_payables
  ADD COLUMN custom_category TEXT;

-- 用户级自定义分类词典：按 normalized_name 去重持久化，删除单笔固定支出后下次仍可选用。
CREATE TABLE IF NOT EXISTS payable_custom_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_payable_custom_categories_user
  ON payable_custom_categories(user_id, created_at ASC);

CREATE TRIGGER IF NOT EXISTS trg_payable_custom_categories_insert
AFTER INSERT ON payable_custom_categories BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (NEW.user_id, 'payable_custom_categories', NEW.id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS trg_payable_custom_categories_update
AFTER UPDATE ON payable_custom_categories BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (NEW.user_id, 'payable_custom_categories', NEW.id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS trg_payable_custom_categories_delete
AFTER DELETE ON payable_custom_categories BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (OLD.user_id, 'payable_custom_categories', OLD.id, 'delete');
END;
