-- 0035_bill_import_drafts_multimodal_and_dedup.sql
-- 方向1 (HUB-152): 草稿状态机、持卡人归属溯源、双币批次、幂等键与附件哈希

ALTER TABLE bill_import_drafts ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (parse_status IN ('parsing', 'needs_password', 'parse_failed', 'ready'));
ALTER TABLE bill_import_drafts ADD COLUMN holder_id TEXT REFERENCES card_holders(id) ON DELETE SET NULL;
ALTER TABLE bill_import_drafts ADD COLUMN attribution_source TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN attribution_trusted INTEGER NOT NULL DEFAULT 0
  CHECK (attribution_trusted IN (0, 1));
ALTER TABLE bill_import_drafts ADD COLUMN source_connection_id TEXT REFERENCES gmail_connections(id) ON DELETE SET NULL;
ALTER TABLE bill_import_drafts ADD COLUMN source_label TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN batch_id TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN file_sha256 TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN client_request_id TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN password_hint TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN error_message TEXT;
ALTER TABLE bill_import_drafts ADD COLUMN confirmed_bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL;
ALTER TABLE bill_import_drafts ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_client_req
  ON bill_import_drafts(created_by, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drafts_inbox
  ON bill_import_drafts(created_by, status, parse_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_file_hash
  ON bill_import_drafts(created_by, file_sha256, status) WHERE file_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drafts_batch
  ON bill_import_drafts(batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE record_attachments ADD COLUMN sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_record_attachments_sha256
  ON record_attachments(uploaded_by, sha256) WHERE sha256 IS NOT NULL;

-- 用户级邮件自动入账安全偏好（与 display_config / reminder_config 物理隔离，避免跨方向修改冲突）
ALTER TABLE user_preferences ADD COLUMN import_config TEXT NOT NULL DEFAULT '{"auto_commit_trusted_email":true}';
