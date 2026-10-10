-- 0011: 卡片账户模式覆盖。
--
-- 多卡一账户此前由「同银行 + 同持卡人 ≥2 张卡」自动推导（bills-view-model
-- 的 deriveAccountMode）。实际存在同一人同银行两张卡但账户独立记账的情况，
-- 以及邮件导入歧义需要人工钉住的场景。加 account_mode_override 让用户
-- 手工指定；NULL = 维持自动推导。
ALTER TABLE credit_cards ADD COLUMN account_mode_override TEXT
  CHECK (account_mode_override IN ('multi', 'single'));
