-- 0010: 银行简称。
--
-- banks.name 存的是通用名（「招商银行」），full_name 是全称（「招商银行股份有限
-- 公司」）。运营侧还需要一个更短的简称（「招行」）用于列表窄栏与卡片标题。
ALTER TABLE banks ADD COLUMN short_name TEXT;
