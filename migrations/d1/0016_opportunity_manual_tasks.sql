-- 0016_opportunity_manual_tasks.sql — P2 manual spend tasks (tech spec §8.1).
-- Progress is a per-cycle ABSOLUTE snapshot (events keep before/after); the
-- rules snapshot survives template edits; card_ids_json is a bounded explicit
-- set validated against the holder at every write by the service layer.

CREATE TABLE opportunity_tasks (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL CHECK (task_type IN ('annual_fee','welcome','monthly_spend','custom')),
  title TEXT NOT NULL,
  card_ids_json TEXT NOT NULL CHECK (json_valid(card_ids_json)),
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  reward_json TEXT NOT NULL CHECK (json_valid(reward_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_opportunity_tasks_holder ON opportunity_tasks(holder_id,status);
CREATE TABLE opportunity_task_cycles (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES opportunity_tasks(id) ON DELETE RESTRICT,
  cycle_key TEXT NOT NULL,
  rules_snapshot_json TEXT NOT NULL CHECK (json_valid(rules_snapshot_json)),
  reward_snapshot_json TEXT NOT NULL CHECK (json_valid(reward_snapshot_json)),
  period_start_on TEXT NOT NULL,
  period_end_before TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  expected_from_on TEXT,
  expected_until_before TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(progress_json)),
  as_of_on TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id,cycle_key),
  CHECK (period_end_before > period_start_on)
);
