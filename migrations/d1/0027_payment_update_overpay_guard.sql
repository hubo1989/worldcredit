-- 0027: Close the BEFORE UPDATE overpay gap on payments (spec 13 review fix).
--
-- 0022's trg_payments_guard_overpay guards BEFORE INSERT only. When
-- updatePayment reads SUM(payments) before entering db.batch(), a concurrent
-- INSERT in that window can slip in and let an amount-increasing UPDATE push
-- SUM(payments) past COALESCE(bill_amount_override, bill_amount) + 0.01.
--
-- Only guard upward edits (NEW.amount > OLD.amount or bill reassignment) so
-- legacy overpaid bills remain editable for notes/channels/dates/downward
-- corrections without getting wedged.
CREATE TRIGGER IF NOT EXISTS trg_payments_guard_overpay_update
BEFORE UPDATE OF amount, bill_id ON payments
WHEN NEW.bill_id != OLD.bill_id OR NEW.amount > OLD.amount
BEGIN
  SELECT CASE
    WHEN (
      SELECT COALESCE(SUM(p.amount), 0) + NEW.amount - (COALESCE(b.bill_amount_override, b.bill_amount) + 0.01)
      FROM bills b LEFT JOIN payments p ON p.bill_id = b.id AND p.id != OLD.id
      WHERE b.id = NEW.bill_id
    ) > 0
    THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_REMAINING')
  END;
END;
