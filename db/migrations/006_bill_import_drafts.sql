-- Migration: Create bill_import_drafts table for intelligent bill recognition
-- This table stores draft bills imported from text, images, PDFs, emails, or SMS
-- before user confirms them into actual bills

CREATE TABLE IF NOT EXISTS bill_import_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'image', 'pdf', 'email', 'sms')),
  raw_text TEXT,
  file_ref TEXT,
  parsed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'discarded')),
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- Add comment for documentation
COMMENT ON TABLE bill_import_drafts IS 'Draft bills from intelligent import (text/image/PDF/email/SMS) awaiting user confirmation';

COMMENT ON COLUMN bill_import_drafts.created_by IS 'User who created the draft';
COMMENT ON COLUMN bill_import_drafts.card_id IS 'Associated credit card (nullable for auto-import where card is unknown)';
COMMENT ON COLUMN bill_import_drafts.source_type IS 'Import source: text, image, pdf, email, or sms';
COMMENT ON COLUMN bill_import_drafts.raw_text IS 'Original text content from email/SMS or OCR output';
COMMENT ON COLUMN bill_import_drafts.file_ref IS 'File storage reference for uploaded images/PDFs';
COMMENT ON COLUMN bill_import_drafts.parsed_payload IS 'JSON containing parsed bill fields and items';
COMMENT ON COLUMN bill_import_drafts.status IS 'Draft status: draft (pending), confirmed (imported), discarded (rejected)';
COMMENT ON COLUMN bill_import_drafts.confidence IS 'Recognition confidence score (0-1), calculated by recognizer';
COMMENT ON COLUMN bill_import_drafts.confirmed_at IS 'Timestamp when draft was confirmed into actual bill';

-- Create index for faster lookups by user and status
CREATE INDEX IF NOT EXISTS idx_bill_import_drafts_created_by_status ON bill_import_drafts(created_by, status);
CREATE INDEX IF NOT EXISTS idx_bill_import_drafts_card_id ON bill_import_drafts(card_id);

-- Enable RLS
ALTER TABLE bill_import_drafts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own drafts
CREATE POLICY "Users can view own bill import drafts"
  ON bill_import_drafts FOR SELECT
  USING (created_by IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Policy: Users can create drafts
CREATE POLICY "Users can create bill import drafts"
  ON bill_import_drafts FOR INSERT
  WITH CHECK (created_by IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Policy: Users can update their own drafts
CREATE POLICY "Users can update own bill import drafts"
  ON bill_import_drafts FOR UPDATE
  USING (created_by IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (created_by IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Policy: Users can delete their own drafts
CREATE POLICY "Users can delete own bill import drafts"
  ON bill_import_drafts FOR DELETE
  USING (created_by IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Policy: Admins can view all drafts
CREATE POLICY "Admins can view all bill import drafts"
  ON bill_import_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid() AND users.role = 'admin'
    )
  );
