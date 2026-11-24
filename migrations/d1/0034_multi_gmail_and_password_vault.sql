-- 0034_multi_gmail_and_password_vault.sql
-- 方向1 (HUB-152): 1:N 多 Gmail 连接、多连接同步消息去重与家庭月结单密码本

-- 部署前保留 D1 Time Travel 书签并暂停写入。回滚 0034–0036 时，
-- 先回退 Worker 代码，再恢复该书签，然后恢复写入，避免丢失迁移后的业务数据。

-- 1. 重建 gmail_connections：由 user_id 主键升级为 id 主键 + UNIQUE(user_id, google_sub)
-- 默认值保证旧测试不显式传 id 的 INSERT 语句 100% 兼容通过
CREATE TABLE gmail_connections_new (
  id TEXT PRIMARY KEY NOT NULL DEFAULT ('gconn_' || lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  display_label TEXT,
  default_holder_id TEXT REFERENCES card_holders(id) ON DELETE SET NULL,
  attribution_mode TEXT NOT NULL DEFAULT 'auto_then_default'
    CHECK (attribution_mode IN ('auto_then_default', 'force_default_unless_conflict')),
  sync_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0, 1)),
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_token_expires_at TEXT,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error TEXT,
  last_sync_at TEXT,
  last_sync_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, google_sub)
);

INSERT INTO gmail_connections_new (
  id, user_id, google_sub, email, display_label, default_holder_id,
  attribution_mode, sync_enabled, refresh_token_enc, access_token_enc,
  access_token_expires_at, scopes, status, last_error, last_sync_at,
  last_sync_summary, created_at, updated_at
)
SELECT
  'gconn_' || user_id, user_id, google_sub, email, NULL, NULL,
  'auto_then_default', 1, refresh_token_enc, access_token_enc,
  access_token_expires_at, scopes, status, last_error, last_sync_at,
  last_sync_summary, created_at, updated_at
FROM gmail_connections;

DROP TABLE gmail_connections;
ALTER TABLE gmail_connections_new RENAME TO gmail_connections;

CREATE INDEX IF NOT EXISTS idx_gmail_connections_user
  ON gmail_connections(user_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_gmail_connections_holder
  ON gmail_connections(default_holder_id) WHERE default_holder_id IS NOT NULL;

-- 2. 重建 gmail_sync_messages：关联 connection_id 并建立 UNIQUE(user_id, gmail_message_id)
CREATE TABLE gmail_sync_messages_new (
  id TEXT PRIMARY KEY NOT NULL DEFAULT ('gsync_' || lower(hex(randomblob(12)))),
  connection_id TEXT REFERENCES gmail_connections(id) ON DELETE SET NULL,
  gmail_message_id TEXT NOT NULL,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, gmail_message_id)
);

INSERT INTO gmail_sync_messages_new (
  id, connection_id, gmail_message_id, user_id, thread_id, rfc_message_id,
  from_email, subject, internal_date, raw_r2_key, status, bill_id, draft_id,
  parse_confidence, error_msg, created_at
)
SELECT
  gmail_message_id,
  (SELECT gc.id FROM gmail_connections gc WHERE gc.id = 'gconn_' || gsm.user_id),
  gmail_message_id, user_id, thread_id, NULLIF(lower(trim(rfc_message_id, '<> ')), ''),
  from_email, subject, internal_date, raw_r2_key, status, bill_id, draft_id,
  parse_confidence, error_msg, created_at
FROM gmail_sync_messages gsm;

DROP TABLE gmail_sync_messages;
ALTER TABLE gmail_sync_messages_new RENAME TO gmail_sync_messages;

CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_user
  ON gmail_sync_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_conn
  ON gmail_sync_messages(connection_id, created_at DESC) WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_rfc
  ON gmail_sync_messages(user_id, rfc_message_id) WHERE rfc_message_id IS NOT NULL;

-- 3. 月结单密码本表（password_ciphertext 仅存 AES-GCM 密文）
CREATE TABLE IF NOT EXISTS statement_password_vault (
  id TEXT PRIMARY KEY NOT NULL DEFAULT ('pwv_' || lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  holder_id TEXT REFERENCES card_holders(id) ON DELETE CASCADE,
  bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
  bank_keyword TEXT,
  password_ciphertext TEXT NOT NULL,
  hint TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_password_vault_user_lookup
  ON statement_password_vault(user_id, holder_id, bank_id, last_used_at DESC);

-- Cron pages active connections by ID and manual sync filters by owner.
CREATE INDEX idx_gmail_connections_sync ON gmail_connections(id)
  WHERE status = 'active' AND sync_enabled = 1;
