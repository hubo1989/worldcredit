-- Migration: Add reminder_states table
-- This table tracks user's reminder read/dismiss status

CREATE TABLE IF NOT EXISTS reminder_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('read', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, reminder_key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reminder_states_user_id ON reminder_states(user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_states_key ON reminder_states(reminder_key);

-- Add RLS policies
ALTER TABLE reminder_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reminder states"
  ON reminder_states
  FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert their own reminder states"
  ON reminder_states
  FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update their own reminder states"
  ON reminder_states
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reminder_states_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER set_reminder_states_updated_at
  BEFORE UPDATE ON reminder_states
  FOR EACH ROW
  EXECUTE FUNCTION update_reminder_states_updated_at();
