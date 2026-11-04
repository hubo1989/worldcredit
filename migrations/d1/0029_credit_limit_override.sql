-- 0029: Add card-level credit_limit_override column.
--
-- credit_cards.credit_limit keeps REAL NOT NULL DEFAULT 0 for schema / iOS GRDB
-- compatibility (0 without override = "未获取"). When a user manually inputs a
-- credit limit, both credit_limit and credit_limit_override are persisted so
-- the UI can reliably distinguish manual "已设置" from unacquired 0 and email
-- sync will never overwrite user-entered limits.

ALTER TABLE credit_cards ADD COLUMN credit_limit_override REAL;
