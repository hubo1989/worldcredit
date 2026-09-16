-- 0008: user-entered bill amount must outrank every imported value.
--
-- 账单日临近（不足 5 天）时用户可以先手填一个金额。此后无论邮件解析、Gmail
-- 同步还是 LLM 抽取回来什么数字，都不能覆盖这个人工值——否则用户刚填好的
-- 金额会被下一封账单邮件悄悄改回去。
--
-- 用独立的 override 列而不是「导入时猜是不是人工填的」：bill_amount 本身
-- 无法区分来源，任何近似判断都会在某个导入路径上失效。
ALTER TABLE bills ADD COLUMN bill_amount_override REAL;

-- 便于识别「哪些账单被人工钉住了」，也让导入侧只读必要列。
CREATE INDEX IF NOT EXISTS idx_bills_amount_override
  ON bills(card_id) WHERE bill_amount_override IS NOT NULL;
