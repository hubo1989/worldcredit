-- Add user ownership to Gmail ledger sync rows so client sync never scans or claims unrelated users' entries.
ALTER TABLE gmail_ledger_entries
  ADD COLUMN IF NOT EXISTS created_by UUID;

CREATE INDEX IF NOT EXISTS idx_gmail_ledger_created_by ON gmail_ledger_entries(created_by);
