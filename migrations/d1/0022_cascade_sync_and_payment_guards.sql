-- Capture cascade deletes before SQLite removes parent rows, and reject
-- concurrent payments that would push a bill past its effective amount.

CREATE TRIGGER IF NOT EXISTS trg_payments_guard_overpay
BEFORE INSERT ON payments
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM payments p
      WHERE (p.idempotency_key = NEW.idempotency_key OR p.id = NEW.id) AND p.bill_id = NEW.bill_id
    )
    THEN NULL
    WHEN (SELECT b.status FROM bills b WHERE b.id = NEW.bill_id) = 'paid'
    THEN RAISE(ABORT, 'PAYMENT_ALREADY_SETTLED')
    WHEN (
      SELECT COALESCE(SUM(p.amount), 0) + NEW.amount - (COALESCE(b.bill_amount_override, b.bill_amount) + 0.01)
      FROM bills b LEFT JOIN payments p ON p.bill_id = b.id
      WHERE b.id = NEW.bill_id
    ) > 0
    THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_REMAINING')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_card_holders_cascade_sync
BEFORE DELETE ON card_holders
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'payments', p.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN payments p ON p.bill_id = b.id
  WHERE cc.holder_id = OLD.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'bills', b.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  WHERE cc.holder_id = OLD.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'credit_cards', cc.id, 'delete'
  FROM credit_cards cc
  WHERE cc.holder_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_cards_cascade_sync
BEFORE DELETE ON credit_cards
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'payments', p.id, 'delete'
  FROM card_holders ch
  JOIN bills b ON b.card_id = OLD.id
  JOIN payments p ON p.bill_id = b.id
  WHERE ch.id = OLD.holder_id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bills', b.id, 'delete'
  FROM card_holders ch
  JOIN bills b ON b.card_id = OLD.id
  WHERE ch.id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bills_cascade_sync
BEFORE DELETE ON bills
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'payments', p.id, 'delete'
  FROM credit_cards cc
  JOIN card_holders ch ON ch.id = cc.holder_id
  JOIN payments p ON p.bill_id = OLD.id
  WHERE cc.id = OLD.card_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_recurring_payables_cascade_sync
BEFORE DELETE ON recurring_payables
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.created_by, 'recurring_payable_payments', rpp.id, 'delete'
  FROM recurring_payable_payments rpp
  WHERE rpp.payable_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_card_holders_transfer_sync
AFTER UPDATE OF managed_by ON card_holders
WHEN OLD.managed_by IS NOT NEW.managed_by
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'payments', p.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN payments p ON p.bill_id = b.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'bills', b.id, 'delete'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.managed_by, 'credit_cards', cc.id, 'delete'
  FROM credit_cards cc
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  VALUES (OLD.managed_by, 'card_holders', OLD.id, 'delete');

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.managed_by, 'credit_cards', cc.id, 'upsert'
  FROM credit_cards cc
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.managed_by, 'bills', b.id, 'upsert'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  WHERE cc.holder_id = NEW.id;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.managed_by, 'payments', p.id, 'upsert'
  FROM credit_cards cc
  JOIN bills b ON b.card_id = cc.id
  JOIN payments p ON p.bill_id = b.id
  WHERE cc.holder_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_cards_transfer_sync
AFTER UPDATE OF holder_id ON credit_cards
WHEN OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'payments', p.id, 'delete'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  JOIN payments p ON p.bill_id = b.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'bills', b.id, 'delete'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT old_ch.managed_by, 'credit_cards', OLD.id, 'delete'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT new_ch.managed_by, 'bills', b.id, 'upsert'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;

  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT new_ch.managed_by, 'payments', p.id, 'upsert'
  FROM card_holders old_ch
  JOIN card_holders new_ch ON new_ch.id = NEW.holder_id
  JOIN bills b ON b.card_id = NEW.id
  JOIN payments p ON p.bill_id = b.id
  WHERE old_ch.id = OLD.holder_id AND old_ch.managed_by IS NOT new_ch.managed_by;
END;
