-- 0019: Gmail 直连拉取（path C）——连接凭据与消息去重/审计。
-- refresh_token_enc / access_token_enc 是 AES-GCM 密文（lib/gmail/token-crypto.ts），
-- 明文 token 绝不落库、绝不进日志。

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_token_expires_at TEXT,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error TEXT,
  last_sync_at TEXT,
  last_sync_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gmail_sync_messages (
  gmail_message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT,
  rfc_message_id TEXT,
  from_email TEXT,
  subject TEXT,
  internal_date TEXT,
  raw_r2_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('bill_written', 'draft_parked', 'skipped', 'failed')),
  bill_id TEXT,
  draft_id TEXT,
  parse_confidence REAL,
  error_msg TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_user
  ON gmail_sync_messages(user_id, created_at DESC);
