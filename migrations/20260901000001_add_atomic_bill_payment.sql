-- Atomically insert full-payment records and mark bills paid.
CREATE OR REPLACE FUNCTION mark_bills_paid_atomic(
  p_user_id UUID,
  p_bill_ids UUID[],
  p_paid_at DATE,
  p_channel TEXT DEFAULT '快捷全额结清',
  p_note TEXT DEFAULT '一键全部还款结清'
)
RETURNS TABLE(paid_count INTEGER, total_amount NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_bill RECORD;
  v_remaining NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_bill_ids IS NULL OR array_length(p_bill_ids, 1) IS NULL THEN
    paid_count := 0;
    total_amount := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  paid_count := 0;
  total_amount := 0;

  FOR v_bill IN
    SELECT b.id, b.bill_amount
    FROM bills b
    JOIN credit_cards cc ON cc.id = b.card_id
    JOIN card_holders ch ON ch.id = cc.holder_id
    WHERE b.id = ANY(p_bill_ids)
      AND ch.created_by = p_user_id
    FOR UPDATE OF b
  LOOP
    SELECT COALESCE(SUM(amount), 0)
    INTO v_remaining
    FROM payments
    WHERE bill_id = v_bill.id;

    v_remaining := GREATEST(0, COALESCE(v_bill.bill_amount, 0) - COALESCE(v_remaining, 0));

    IF v_remaining > 0 THEN
      INSERT INTO payments (bill_id, amount, paid_at, channel, note, idempotency_key)
      VALUES (
        v_bill.id,
        v_remaining,
        p_paid_at,
        p_channel,
        p_note,
        'pay_' || v_bill.id::text || '_' || replace(gen_random_uuid()::text, '-', '')
      );
    END IF;

    UPDATE bills SET status = 'paid' WHERE id = v_bill.id;

    paid_count := paid_count + 1;
    total_amount := total_amount + v_remaining;
  END LOOP;

  IF paid_count <> array_length(p_bill_ids, 1) THEN
    RAISE EXCEPTION 'some bills are not owned by current user or do not exist';
  END IF;

  RETURN NEXT;
END;
$$;
