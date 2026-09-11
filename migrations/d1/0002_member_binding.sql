-- 0002: bind family member accounts to card holders (plan.md D1).
-- A member account (users.role = member) sees only holders bound via auth_user_id.
ALTER TABLE card_holders ADD COLUMN auth_user_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_card_holders_auth_user
  ON card_holders(auth_user_id) WHERE auth_user_id IS NOT NULL;
