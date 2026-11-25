-- 0042_payment_fx_lock_and_sync_triggers.sql
ALTER TABLE payments ADD COLUMN settled_currency TEXT
  CHECK (settled_currency IS NULL OR length(settled_currency) = 3);
ALTER TABLE payments ADD COLUMN settled_amount REAL
  CHECK (settled_amount IS NULL OR settled_amount > 0);
ALTER TABLE payments ADD COLUMN locked_fx_rate REAL
  CHECK (locked_fx_rate IS NULL OR locked_fx_rate > 0);

CREATE TRIGGER IF NOT EXISTS trg_payments_validate_fx_lock_insert
BEFORE INSERT ON payments
WHEN NOT (
  (NEW.settled_currency IS NULL AND NEW.settled_amount IS NULL AND NEW.locked_fx_rate IS NULL)
  OR
  (
    NEW.settled_currency IS NOT NULL AND length(NEW.settled_currency) = 3
    AND NEW.settled_amount IS NOT NULL AND NEW.settled_amount > 0
    AND NEW.locked_fx_rate IS NOT NULL AND NEW.locked_fx_rate > 0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_FX_LOCK_INCOMPLETE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_validate_fx_lock_update
BEFORE UPDATE OF settled_currency, settled_amount, locked_fx_rate ON payments
WHEN NOT (
  (NEW.settled_currency IS NULL AND NEW.settled_amount IS NULL AND NEW.locked_fx_rate IS NULL)
  OR
  (
    NEW.settled_currency IS NOT NULL AND length(NEW.settled_currency) = 3
    AND NEW.settled_amount IS NOT NULL AND NEW.settled_amount > 0
    AND NEW.locked_fx_rate IS NOT NULL AND NEW.locked_fx_rate > 0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_FX_LOCK_INCOMPLETE');
END;

-- Direct sync triggers: bill_items
CREATE TRIGGER IF NOT EXISTS trg_bill_items_insert AFTER INSERT ON bill_items BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = NEW.bill_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_items_update AFTER UPDATE ON bill_items BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = NEW.bill_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_items_delete AFTER DELETE ON bill_items BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', OLD.id, 'delete'
  FROM bills b
  JOIN credit_cards cc ON cc.id = b.card_id
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = OLD.bill_id;
END;

-- Direct sync triggers: installment_plans
CREATE TRIGGER IF NOT EXISTS trg_installment_plans_insert AFTER INSERT ON installment_plans BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'installment_plans', NEW.id, 'upsert'
  FROM credit_cards cc
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE cc.id = NEW.card_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_installment_plans_update AFTER UPDATE ON installment_plans BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'installment_plans', NEW.id, 'upsert'
  FROM credit_cards cc
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE cc.id = NEW.card_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_installment_plans_delete AFTER DELETE ON installment_plans BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'installment_plans', OLD.id, 'delete'
  FROM credit_cards cc
  JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE cc.id = OLD.card_id;
END;

-- Direct sync triggers: merchant_category_rules
CREATE TRIGGER IF NOT EXISTS trg_merchant_category_rules_insert AFTER INSERT ON merchant_category_rules BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (NEW.user_id, 'merchant_category_rules', NEW.id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS trg_merchant_category_rules_update AFTER UPDATE ON merchant_category_rules BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (NEW.user_id, 'merchant_category_rules', NEW.id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS trg_merchant_category_rules_delete AFTER DELETE ON merchant_category_rules BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (OLD.user_id, 'merchant_category_rules', OLD.id, 'delete');
END;

-- Cascade BEFORE DELETE triggers（SQLite 级联删除时父行先于子表 AFTER DELETE 被移除，须同 0022 前置捕获）
CREATE TRIGGER IF NOT EXISTS trg_bills_cascade_sync_d3
BEFORE DELETE ON bills
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', bi.id, 'delete'
  FROM credit_cards cc
  JOIN card_holders ch ON ch.id = cc.holder_id
  JOIN bill_items bi ON bi.bill_id = OLD.id
  WHERE cc.id = OLD.card_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_cards_cascade_sync_d3
BEFORE DELETE ON credit_cards
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', bi.id, 'delete'
  FROM card_holders ch
  JOIN bills b ON b.card_id = OLD.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE ch.id = OLD.holder_id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'installment_plans', ip.id, 'delete'
  FROM card_holders ch
  JOIN installment_plans ip ON ip.card_id = OLD.id
  WHERE ch.id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_card_holders_cascade_sync_d3
BEFORE DELETE ON card_holders
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'bill_items', bi.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE cc.holder_id = OLD.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'installment_plans', ip.id, 'delete'
  FROM credit_cards cc
  JOIN installment_plans ip ON ip.card_id = cc.id
  WHERE cc.holder_id = OLD.id;
END;

-- Ownership transfer sync triggers
CREATE TRIGGER IF NOT EXISTS trg_card_holders_transfer_sync_d3
AFTER UPDATE OF managed_by ON card_holders
WHEN OLD.managed_by IS NOT NEW.managed_by
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'bill_items', bi.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'installment_plans', ip.id, 'delete'
  FROM credit_cards cc
  JOIN installment_plans ip ON ip.card_id = cc.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.managed_by, 'bill_items', bi.id, 'upsert'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.managed_by, 'installment_plans', ip.id, 'upsert'
  FROM credit_cards cc
  JOIN installment_plans ip ON ip.card_id = cc.id
  WHERE cc.holder_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_cards_transfer_sync_d3
AFTER UPDATE OF holder_id ON credit_cards
WHEN OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'bill_items', bi.id, 'delete'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'installment_plans', ip.id, 'delete'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN installment_plans ip ON ip.card_id = NEW.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT new_ch.managed_by, 'bill_items', bi.id, 'upsert'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  JOIN bill_items bi ON bi.bill_id = b.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT new_ch.managed_by, 'installment_plans', ip.id, 'upsert'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN installment_plans ip ON ip.card_id = NEW.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;
END;

-- Direct parent changes also invalidate the former owner's cached row.
CREATE TRIGGER IF NOT EXISTS trg_bill_items_transfer_sync_d3
AFTER UPDATE OF bill_id ON bill_items
WHEN OLD.bill_id IS NOT NEW.bill_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bill_items', OLD.id, 'delete'
  FROM bills b JOIN credit_cards cc ON cc.id = b.card_id JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE b.id = OLD.bill_id
    AND ch.managed_by IS NOT (SELECT ch.managed_by FROM bills b JOIN credit_cards cc ON cc.id = b.card_id JOIN card_holders ch ON ch.id = cc.holder_id WHERE b.id = NEW.bill_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_installment_plans_transfer_sync_d3
AFTER UPDATE OF card_id ON installment_plans
WHEN OLD.card_id IS NOT NEW.card_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'installment_plans', OLD.id, 'delete'
  FROM credit_cards cc JOIN card_holders ch ON ch.id = cc.holder_id
  WHERE cc.id = OLD.card_id
    AND ch.managed_by IS NOT (SELECT ch.managed_by FROM credit_cards cc JOIN card_holders ch ON ch.id = cc.holder_id WHERE cc.id = NEW.card_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_merchant_category_rules_transfer_sync_d3
AFTER UPDATE OF user_id ON merchant_category_rules
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (OLD.user_id, 'merchant_category_rules', OLD.id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS trg_bills_transfer_sync_d3
AFTER UPDATE OF card_id ON bills
WHEN OLD.card_id IS NOT NEW.card_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'bill_items', bi.id, 'delete'
  FROM bill_items bi
  JOIN credit_cards old_card ON old_card.id = OLD.card_id
  JOIN card_holders old_ch ON old_ch.id = old_card.holder_id
  JOIN credit_cards new_card ON new_card.id = NEW.card_id
  JOIN card_holders new_ch ON new_ch.id = new_card.holder_id
  WHERE bi.bill_id = NEW.id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT new_ch.managed_by, 'bill_items', bi.id, 'upsert'
  FROM bill_items bi
  JOIN credit_cards old_card ON old_card.id = OLD.card_id
  JOIN card_holders old_ch ON old_ch.id = old_card.holder_id
  JOIN credit_cards new_card ON new_card.id = NEW.card_id
  JOIN card_holders new_ch ON new_ch.id = new_card.holder_id
  WHERE bi.bill_id = NEW.id AND old_ch.managed_by IS NOT new_ch.managed_by;
END;

-- Devices whose cursor predates the migration must also receive existing items.
INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT ch.managed_by, 'bill_items', bi.id, 'upsert'
FROM bill_items bi
JOIN bills b ON b.id = bi.bill_id
JOIN credit_cards cc ON cc.id = b.card_id
JOIN card_holders ch ON ch.id = cc.holder_id;
