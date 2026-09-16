-- 0009: 周期性固定支出（房租 / 贷款 / 其他按月的应付事项）。
--
-- 为什么单独建表而不是复用 credit_cards：
--   * bills.card_id 是 NOT NULL 且外键指向 credit_cards，房租这类支出没有卡；
--   * 家庭财务审计（docs/audits/2026-09-08）明确要求「不得为了复用现有表，
--     把房租也伪装成信用卡产品」——否则它会混进卡数、额度、免息期等一切口径。
--
-- 本轮只做「每月固定一笔」的最小闭环：按 due_day 推出当期应付，用户登记还款。
-- 期表拆分、提前还款重排、押金结算等留给 W15–W19。

CREATE TABLE IF NOT EXISTS recurring_payables (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('rent', 'loan', 'utility', 'insurance', 'other')),
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  -- 每月应付日（1–31；大于当月天数时按当月最后一天算，与账单日同规则）
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  holder_id TEXT REFERENCES card_holders(id) ON DELETE SET NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_payables_user
  ON recurring_payables(created_by, is_active);

-- 还款记录按「账期」唯一：同一个月重复登记会被唯一约束挡住，天然幂等。
CREATE TABLE IF NOT EXISTS recurring_payable_payments (
  id TEXT PRIMARY KEY,
  payable_id TEXT NOT NULL REFERENCES recurring_payables(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(payable_id, period)
);

CREATE INDEX IF NOT EXISTS idx_recurring_payments_payable
  ON recurring_payable_payments(payable_id, period);
