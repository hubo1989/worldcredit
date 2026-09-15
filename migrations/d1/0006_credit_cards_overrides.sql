-- 0006: Add card-level name and annual fee overrides.
--
-- Allows users to customize card name and annual fee per card,
-- with card-level values taking priority over card_product defaults.

ALTER TABLE credit_cards ADD COLUMN name_override TEXT;
ALTER TABLE credit_cards ADD COLUMN annual_fee_override REAL;
