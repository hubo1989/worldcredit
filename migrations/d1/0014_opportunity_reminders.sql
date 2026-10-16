-- 0014_opportunity_reminders.sql — personal reminder states and notification
-- delivery (tech spec §6.2). Every constraint mirrors the spec template
-- verbatim: user+event state isolation, user+delivery_key job uniqueness, the
-- status enums and the 0–4 attempt budget for the lease/retry state machine.

CREATE TABLE opportunity_reminder_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  read_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(read_steps_json)),
  dismissed_at TEXT,
  snooze_until TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,event_key)
);
CREATE TABLE opportunity_notification_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('account','task','fulfillment')),
  object_id TEXT NOT NULL,
  business_version TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','sent','partial','failed','cancelled','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,delivery_key)
);
CREATE INDEX idx_opportunity_jobs_due ON opportunity_notification_jobs(status,scheduled_at);
CREATE TABLE opportunity_notification_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES opportunity_notification_jobs(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','failed','gone','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  last_error TEXT,
  UNIQUE(job_id,subscription_id)
);
