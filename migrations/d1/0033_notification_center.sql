-- 0033_notification_center.sql — 通知中心：分类、跳转链接、结构化详情、已读态、软删除与推送标记
ALTER TABLE notification_history ADD COLUMN category TEXT NOT NULL DEFAULT 'system';
ALTER TABLE notification_history ADD COLUMN target_url TEXT;
ALTER TABLE notification_history ADD COLUMN metadata_json TEXT;
ALTER TABLE notification_history ADD COLUMN read_at TEXT;
ALTER TABLE notification_history ADD COLUMN deleted_at TEXT;
ALTER TABLE notification_history ADD COLUMN push_sent_at TEXT;

-- 历史已发送记录默认视为已推送，防止升级后被 Cron 二次补推
UPDATE notification_history SET push_sent_at = sent_at WHERE status = 'sent' AND push_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_inbox
  ON notification_history(user_id, deleted_at, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_history_unread
  ON notification_history(user_id, deleted_at, read_at);
