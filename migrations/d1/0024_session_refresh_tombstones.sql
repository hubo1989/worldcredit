-- migrations/d1/0024_session_refresh_tombstones.sql
-- 已轮换/已吊销 refresh token 的墓碑：重放命中 = 失窃信号，触发全量吊销。
-- 墓碑保留 180 天（与 token TTL 一致），过期由 cron 清理或自然失效。

CREATE TABLE IF NOT EXISTS session_refresh_tombstones (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_tombstones_user ON session_refresh_tombstones(user_id);
