-- migrations/d1/0023_session_refresh_tokens.sql
-- Refresh token 凭据：App 登录时签发，access token 过期后静默续期用。
-- 一次性轮换（rotated）：每次 refresh 换新 token 并吊销旧的，防重放。

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
