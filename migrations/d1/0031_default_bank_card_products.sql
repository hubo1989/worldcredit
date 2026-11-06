-- 0031: 补齐银行兜底基础卡产品 + 存量 override_billing_day 归一合并
--
-- 1. 补齐兜底基础卡产品：
--    对尚未拥有 CNY 基础信用卡产品的银行，幂等补充 id = 'cp_default_' || banks.id 的标准卡产品，
--    确保每家银行均可直接用于建卡与选卡，并通过 0019 触发器自动同步下发 iOS。

INSERT OR IGNORE INTO card_products (
  id,
  country,
  bank_id,
  bank_name,
  card_name,
  currency,
  payment_due_type,
  payment_due_value,
  annual_fee,
  is_active
)
SELECT
  'cp_default_' || b.id,
  b.country,
  b.id,
  b.name,
  '标准信用卡',
  'CNY',
  'after_billing',
  20,
  0,
  1
FROM banks b
WHERE NOT EXISTS (
  SELECT 1 FROM card_products cp
  WHERE cp.bank_id = b.id AND cp.currency = 'CNY' AND cp.is_active = 1
);

-- 2. 存量 override_billing_day 一次性合并回 billing_day 并清空，消除双列歧义
UPDATE credit_cards
SET billing_day = override_billing_day,
    override_billing_day = NULL
WHERE override_billing_day IS NOT NULL;
