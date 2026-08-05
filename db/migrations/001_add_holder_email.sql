-- Add email column to card_holders for member binding
ALTER TABLE card_holders ADD COLUMN IF NOT EXISTS email TEXT;

-- Index for email lookups during auto-binding
CREATE INDEX IF NOT EXISTS idx_card_holders_email ON card_holders(email) WHERE email IS NOT NULL;
