-- 0028：固定支出增加可选的银行归属，供账单页「按银行」筛选。
-- 可空：不填即「非银行」，筛选时单列一个桶。
ALTER TABLE recurring_payables ADD COLUMN bank_name TEXT;
