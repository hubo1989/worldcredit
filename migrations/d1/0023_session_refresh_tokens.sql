-- migrations/d1/0023_session_refresh_tokens.sql
-- Refresh token 凭据：App 登录时签发，access token 过期后静默续期用。
-- 一次性轮换（rotated）：每次 refresh 换新 token 并把旧 token 移入墓碑，防重放；
-- 墓碑被重放命中即视为失窃信号，全量吊销该用户全部 refresh token。

CREATE TABLE IF NOT EXISTS session_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, -- SHA-256(token)，原文只下发一次
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_refresh_user ON session_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_session_refresh_expires ON session_refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS session_refresh_tombstones (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_tombstones_user ON session_refresh_tombstones(user_id);
