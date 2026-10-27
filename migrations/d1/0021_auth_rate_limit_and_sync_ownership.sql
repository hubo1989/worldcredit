-- Durable password failure windows and owner-scoped mutation idempotency.
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  bucket_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL CHECK (failure_count > 0),
  window_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_expiry
  ON auth_login_attempts(window_expires_at);

-- Legacy mutation receipts contain no owner. Recreate the table with user_id in
-- the composite key so two accounts cannot collide or read each other's receipts.
DROP TABLE IF EXISTS sync_mutations;
CREATE TABLE sync_mutations (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  result TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id, mutation_id)
);
