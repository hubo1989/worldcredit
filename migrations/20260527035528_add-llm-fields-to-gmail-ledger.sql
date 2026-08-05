-- Add LLM-enriched fields to gmail_ledger_entries
ALTER TABLE gmail_ledger_entries
  ADD COLUMN IF NOT EXISTS cardholder_name TEXT,
  ADD COLUMN IF NOT EXISTS is_overpayment BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS amount_direction TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS loan_monthly_payment NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS loan_details JSONB,
  ADD COLUMN IF NOT EXISTS llm_confidence TEXT;
