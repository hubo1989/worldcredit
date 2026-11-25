-- 0041_installment_plans.sql
CREATE TABLE IF NOT EXISTS installment_plans (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  source_bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
  source_item_id TEXT REFERENCES bill_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'purchase' CHECK (plan_type IN ('purchase', 'bill', 'cash')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  principal_amount REAL NOT NULL CHECK (principal_amount > 0),
  total_periods INTEGER NOT NULL CHECK (total_periods BETWEEN 2 AND 60),
  paid_periods INTEGER NOT NULL DEFAULT 0 CHECK (paid_periods >= 0 AND paid_periods <= total_periods),
  fee_mode TEXT NOT NULL DEFAULT 'equal_principal_fee' CHECK (
    fee_mode IN ('equal_principal_fee', 'interest_free', 'equal_installment_apr')
  ),
  fee_charge_mode TEXT NOT NULL DEFAULT 'per_period' CHECK (
    fee_charge_mode IN ('per_period', 'upfront')
  ),
  fee_rate_per_period REAL CHECK (fee_rate_per_period IS NULL OR fee_rate_per_period >= 0),
  custom_period_fee REAL CHECK (custom_period_fee IS NULL OR custom_period_fee >= 0),
  apr REAL CHECK (apr IS NULL OR (apr >= 0 AND apr <= 1)),
  start_month TEXT NOT NULL,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  due_month_offset INTEGER NOT NULL DEFAULT 0 CHECK (due_month_offset IN (0, 1)),
  billing_mode TEXT NOT NULL DEFAULT 'included_in_statement' CHECK (
    billing_mode IN ('included_in_statement', 'independent')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'completed', 'early_settled', 'cancelled')
  ),
  early_settled_at TEXT,
  early_settled_amount REAL CHECK (early_settled_amount IS NULL OR early_settled_amount >= 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_installment_plans_card_status
  ON installment_plans(card_id, status);
CREATE INDEX IF NOT EXISTS idx_installment_plans_status_start
  ON installment_plans(status, start_month);
CREATE INDEX IF NOT EXISTS idx_installment_plans_source_bill
  ON installment_plans(source_bill_id) WHERE source_bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installment_plans_source_item
  ON installment_plans(source_item_id) WHERE source_item_id IS NOT NULL;
