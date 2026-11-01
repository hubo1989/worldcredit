-- 0025: 账单编辑 override 列（spec 13 §6.1）。
--
-- 与 0008 的 bill_amount_override 同一模式：导入方（邮件解析 / Gmail 同步 / LLM）
-- 只写导入列，用户编辑一律写 *_override 列，读取时按优先级合成。导入自动化
-- 与人工编辑从此不抢同一列，用户改过的日期/最低还款不会被下一封邮件改回去。
--
-- 注意：SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS；本迁移经
-- wrangler d1 migrations 跟踪只执行一次（0006/0008 同此先例），不做列级守护。
ALTER TABLE bills ADD COLUMN min_payment_override REAL;
ALTER TABLE bills ADD COLUMN due_date_override TEXT;
ALTER TABLE bills ADD COLUMN statement_date_override TEXT;

-- 识别「哪些账单被人工钉住过」（与 0008 的部分索引同模式）。
CREATE INDEX IF NOT EXISTS idx_bills_editing_overrides
  ON bills(card_id) WHERE min_payment_override IS NOT NULL
    OR due_date_override IS NOT NULL
    OR statement_date_override IS NOT NULL;
