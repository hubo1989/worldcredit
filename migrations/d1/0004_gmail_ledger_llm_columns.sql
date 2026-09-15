-- 0004: restore the LLM-enriched columns on gmail_ledger_entries.
--
-- Postgres carried these via migrations/20260527035528_add-llm-fields-to-gmail-ledger.sql,
-- but the D1 schema (0001) was created without them, so the deployed table lacked
-- six columns that lib/api/gmail-ledger.ts declares and app/(mobile)/gmail-ledger
-- reads (cardholder_name, loan_monthly_payment, ...). Without them an import that
-- carries those fields fails, and the ledger page loses holder names.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this migration is not idempotent by
-- itself; it is expected to run once against a database that lacks the columns.

ALTER TABLE gmail_ledger_entries ADD COLUMN cardholder_name TEXT;
ALTER TABLE gmail_ledger_entries ADD COLUMN is_overpayment INTEGER DEFAULT 0;
ALTER TABLE gmail_ledger_entries ADD COLUMN amount_direction TEXT DEFAULT 'unknown';
ALTER TABLE gmail_ledger_entries ADD COLUMN loan_monthly_payment REAL;
ALTER TABLE gmail_ledger_entries ADD COLUMN loan_details TEXT;
ALTER TABLE gmail_ledger_entries ADD COLUMN llm_confidence TEXT;
