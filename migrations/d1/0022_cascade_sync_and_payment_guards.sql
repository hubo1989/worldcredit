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
