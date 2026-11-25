// lib/__tests__/helpers/hub156-schema.ts — HUB-156 单测用的「冻结 schema」。
//
// 方向1 的 0034–0036 迁移由 HUB-155 交付，与本模块（HUB-156）并行开发。为了让
// 后端 API 的契约测试在迁移落地前后都能跑，这里按 HUB-154 第 2 节冻结的 DDL
// 把列/表补进内存库；全部操作幂等——等真实迁移合入后，已存在的列会被跳过。

import type { SqliteD1 } from './sqlite-d1'

function columnsOf(db: SqliteD1, table: string): Set<string> {
  const rows = db.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

function addColumn(db: SqliteD1, table: string, column: string, ddl: string): void {
  if (columnsOf(db, table).has(column)) return
  db.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
}

function tableExists(db: SqliteD1, table: string): boolean {
  const row = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  return !!row
}

/** 0034：gmail_connections 由「user_id 主键」重建为 1:N 多连接。 */
function rebuildGmailConnections(db: SqliteD1): void {
  if (columnsOf(db, 'gmail_connections').has('id')) return
  db.raw.exec(`
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
  `)
}

/** 0034：同步消息补 connection_id 与跨连接去重索引。 */
function upgradeSyncMessages(db: SqliteD1): void {
  addColumn(db, 'gmail_sync_messages', 'connection_id',
    'TEXT REFERENCES gmail_connections(id) ON DELETE SET NULL')
  db.raw.exec(`
    CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_conn
      ON gmail_sync_messages(connection_id, created_at DESC) WHERE connection_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_rfc
      ON gmail_sync_messages(user_id, rfc_message_id) WHERE rfc_message_id IS NOT NULL;
  `)
}

/** 0034：月结单密码本。 */
function createPasswordVault(db: SqliteD1): void {
  if (tableExists(db, 'statement_password_vault')) return
  db.raw.exec(`
    CREATE TABLE statement_password_vault (
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
  `)
}

/** 0035：草稿状态机 / 归属溯源 / 幂等键 / 附件哈希 / import_config。 */
function upgradeDrafts(db: SqliteD1): void {
  addColumn(db, 'bill_import_drafts', 'parse_status',
    "TEXT NOT NULL DEFAULT 'ready' CHECK (parse_status IN ('parsing', 'needs_password', 'parse_failed', 'ready'))")
  addColumn(db, 'bill_import_drafts', 'holder_id',
    'TEXT REFERENCES card_holders(id) ON DELETE SET NULL')
  addColumn(db, 'bill_import_drafts', 'attribution_source', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'attribution_trusted',
    'INTEGER NOT NULL DEFAULT 0 CHECK (attribution_trusted IN (0, 1))')
  addColumn(db, 'bill_import_drafts', 'source_connection_id',
    'TEXT REFERENCES gmail_connections(id) ON DELETE SET NULL')
  addColumn(db, 'bill_import_drafts', 'source_label', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'batch_id', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'file_sha256', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'client_request_id', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'password_hint', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'error_message', 'TEXT')
  addColumn(db, 'bill_import_drafts', 'confirmed_bill_id',
    'TEXT REFERENCES bills(id) ON DELETE SET NULL')
  addColumn(db, 'bill_import_drafts', 'updated_at', 'TEXT')
  db.raw.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_client_req
      ON bill_import_drafts(created_by, client_request_id) WHERE client_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_drafts_inbox
      ON bill_import_drafts(created_by, status, parse_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drafts_file_hash
      ON bill_import_drafts(created_by, file_sha256, status) WHERE file_sha256 IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_drafts_batch
      ON bill_import_drafts(batch_id) WHERE batch_id IS NOT NULL;
  `)
  addColumn(db, 'record_attachments', 'sha256', 'TEXT')
  addColumn(db, 'user_preferences', 'import_config',
    `TEXT NOT NULL DEFAULT '{"auto_commit_trusted_email":true}'`)
}

/** 0036：历史邮箱账本分流标记列。 */
function upgradeLedger(db: SqliteD1): void {
  addColumn(db, 'gmail_ledger_entries', 'migration_status',
    "TEXT DEFAULT NULL CHECK (migration_status IS NULL OR migration_status IN ('archived_matched', 'migrated_to_draft', 'skipped_noise'))")
  addColumn(db, 'gmail_ledger_entries', 'migrated_draft_id',
    'TEXT REFERENCES bill_import_drafts(id) ON DELETE SET NULL')
}

/** 幂等地把 0034–0036 的冻结 schema 补进测试库。 */
export function ensureHub156Schema(db: SqliteD1): void {
  rebuildGmailConnections(db)
  upgradeSyncMessages(db)
  createPasswordVault(db)
  upgradeDrafts(db)
  upgradeLedger(db)
}
