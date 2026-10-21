-- 固定支出支持填写银行账号（贷款/房租等的还款转账目标）。
-- 选填：不填不影响任何既有逻辑；展示层在固定支出卡片上显示并支持一键复制。
ALTER TABLE recurring_payables ADD COLUMN bank_account TEXT;
