-- Migration: Add managed_by column to card_holders
-- The schema.sql defines this column but it was missing from the deployed database.
-- Prerequisite: ensure at least one user exists in the users table before running.

-- Step 1: Add column as nullable
ALTER TABLE card_holders ADD COLUMN IF NOT EXISTS managed_by UUID;

-- Step 2: Backfill - assign all existing holders to the first admin user
-- Only runs if there are existing rows without managed_by
UPDATE card_holders
SET managed_by = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE managed_by IS NULL;

-- Step 3: Add NOT NULL constraint and foreign key
ALTER TABLE card_holders
  ALTER COLUMN managed_by SET NOT NULL,
  ADD CONSTRAINT fk_card_holders_managed_by
    FOREIGN KEY (managed_by) REFERENCES users(id) ON DELETE CASCADE;

-- Step 4: Create index
CREATE INDEX IF NOT EXISTS idx_card_holders_managed_by ON card_holders(managed_by);
