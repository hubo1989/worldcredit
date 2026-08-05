-- db/functions.sql
-- 原子性还款操作：插入还款记录 + 更新账单状态

CREATE OR REPLACE FUNCTION record_payment(
  p_bill_id UUID,
  p_amount NUMERIC,
  p_paid_at DATE,
  p_note TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT '手动还款'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_id UUID;
  v_total_paid NUMERIC;
  v_bill_amount NUMERIC;
BEGIN
  -- 1. 插入还款记录
  INSERT INTO payments (bill_id, amount, paid_at, note, idempotency_key, channel)
  VALUES (p_bill_id, p_amount, p_paid_at, p_note, p_idempotency_key, p_channel)
  RETURNING id INTO v_payment_id;

  -- 2. 计算该账单的累计已还金额
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM payments
  WHERE bill_id = p_bill_id;

  -- 3. 获取账单金额
  SELECT bill_amount INTO v_bill_amount
  FROM bills
  WHERE id = p_bill_id;

  -- 4. 原子更新账单状态
  UPDATE bills SET status = CASE
    WHEN v_total_paid >= v_bill_amount THEN 'paid'
    WHEN v_total_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END
  WHERE id = p_bill_id;

  RETURN v_payment_id;
END;
$$;
