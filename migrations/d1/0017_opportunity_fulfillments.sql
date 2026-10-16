-- 0017_opportunity_fulfillments.sql — claims, reward grants, bookings and
-- task results (tech spec §8.2). Business uniqueness lives in source_key;
-- cross-object consistency (holder/account/cycle/task/card/usage) is enforced
-- by the guard view + triggers so direct SQL can never land an inconsistent
-- fulfillment.

CREATE TABLE opportunity_fulfillments (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('claim','grant','booking','task_result')),
  account_id TEXT REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT REFERENCES opportunity_cycles(id) ON DELETE RESTRICT,
  task_cycle_id TEXT REFERENCES opportunity_task_cycles(id) ON DELETE RESTRICT,
  reward_key TEXT,
  source_key TEXT NOT NULL UNIQUE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('recorded','cancelled','used','pending_settlement','expired')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  recorded_on TEXT NOT NULL,
  service_at TEXT,
  service_time_zone TEXT,
  external_reference TEXT,
  entry_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(entry_json)),
  settlement TEXT CHECK (settlement IS NULL OR settlement IN ('returned','charged','unknown')),
  usage_id TEXT UNIQUE REFERENCES opportunity_usages(id) ON DELETE RESTRICT,
  note TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind='task_result' OR (account_id IS NOT NULL AND cycle_id IS NOT NULL)),
  CHECK (kind!='task_result' OR (account_id IS NULL AND cycle_id IS NULL AND task_cycle_id IS NOT NULL AND reward_key IS NOT NULL AND usage_id IS NULL)),
  CHECK (kind!='booking' OR (card_id IS NOT NULL AND cycle_id IS NOT NULL AND service_at IS NOT NULL AND service_time_zone IS NOT NULL)),
  CHECK (kind!='grant' OR (task_cycle_id IS NOT NULL AND reward_key IS NOT NULL AND cycle_id IS NOT NULL))
);
CREATE INDEX idx_opportunity_fulfillments_account ON opportunity_fulfillments(account_id,status,service_at);

CREATE VIEW opportunity_invalid_fulfillments AS
SELECT f.id FROM opportunity_fulfillments f
LEFT JOIN opportunity_accounts a ON a.id=f.account_id
LEFT JOIN opportunity_cycles c ON c.id=f.cycle_id
LEFT JOIN opportunity_task_cycles tc ON tc.id=f.task_cycle_id
LEFT JOIN opportunity_tasks t ON t.id=tc.task_id
WHERE (f.kind!='task_result' AND (a.id IS NULL OR a.holder_id!=f.holder_id))
  OR (f.cycle_id IS NOT NULL AND (c.id IS NULL OR c.account_id!=f.account_id))
  OR (f.task_cycle_id IS NOT NULL AND (tc.id IS NULL OR t.holder_id!=f.holder_id))
  OR (f.card_id IS NOT NULL AND f.kind='task_result' AND NOT EXISTS (
    SELECT 1 FROM credit_cards cc WHERE cc.id=f.card_id AND cc.holder_id=f.holder_id
  ))
  OR (f.card_id IS NOT NULL AND f.kind!='task_result' AND NOT EXISTS (
    SELECT 1 FROM opportunity_account_cards ac
    WHERE ac.account_id=f.account_id AND ac.card_id=f.card_id AND ac.holder_id=f.holder_id
  ))
  OR (f.status='used' AND (f.usage_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM opportunity_usages u WHERE u.id=f.usage_id AND u.status='active'
  )))
  OR (f.usage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM opportunity_usages u
    WHERE u.id=f.usage_id AND u.account_id=f.account_id AND u.cycle_id=f.cycle_id AND u.card_id=f.card_id
  ));
CREATE TRIGGER opportunity_fulfillments_guard_insert AFTER INSERT ON opportunity_fulfillments
WHEN EXISTS (SELECT 1 FROM opportunity_invalid_fulfillments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_FULFILLMENT_SCOPE_MISMATCH'); END;
CREATE TRIGGER opportunity_fulfillments_guard_update AFTER UPDATE ON opportunity_fulfillments
WHEN EXISTS (SELECT 1 FROM opportunity_invalid_fulfillments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_FULFILLMENT_SCOPE_MISMATCH'); END;
CREATE TRIGGER opportunity_linked_usage_guard BEFORE UPDATE ON opportunity_usages
WHEN EXISTS (
  SELECT 1 FROM opportunity_fulfillments f WHERE f.usage_id=OLD.id AND (
    f.account_id!=NEW.account_id OR f.cycle_id!=NEW.cycle_id OR f.card_id!=NEW.card_id
    OR (f.status='used' AND NEW.status!='active')
  )
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_USE_FULFILLMENT_CORRECTION'); END;
CREATE TRIGGER opportunity_fulfillment_used_guard BEFORE UPDATE ON opportunity_fulfillments
WHEN NEW.status='used' AND (NEW.usage_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM opportunity_usages u WHERE u.id=NEW.usage_id AND u.status='active'
))
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_ACTIVE_USAGE_REQUIRED'); END;
