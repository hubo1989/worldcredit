-- Existing deliveries retain their original Web Push identity and status.
ALTER TABLE opportunity_notification_deliveries
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'web_push'
  CHECK (channel IN ('web_push', 'apns'));

-- A rollback keeps namespaced APNs rows. Restore their channel on reapply.
UPDATE opportunity_notification_deliveries
  SET channel = 'apns' WHERE subscription_id GLOB 'apns:*';

CREATE INDEX IF NOT EXISTS idx_opp_deliveries_job_channel
  ON opportunity_notification_deliveries(job_id, channel, status);

-- Run these statements in order after rolling the Worker back.
-- rollback: DROP INDEX IF EXISTS idx_opp_deliveries_job_channel;
-- rollback: ALTER TABLE opportunity_notification_deliveries DROP COLUMN channel;
