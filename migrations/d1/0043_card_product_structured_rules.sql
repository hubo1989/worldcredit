-- 0043_card_product_structured_rules.sql
-- 扩展卡产品结构化外币手续费（FTF）、分类回报倍率、年费周期建议与免年费规则模板。
-- 全部可空，100% 兼容存量 500+ 目录记录与旧文本字段。

ALTER TABLE card_products ADD COLUMN ftf_rate REAL
  CHECK (ftf_rate IS NULL OR (ftf_rate >= 0 AND ftf_rate <= 10));

ALTER TABLE card_products ADD COLUMN fx_free_currencies_json TEXT
  CHECK (fx_free_currencies_json IS NULL OR (
    json_valid(fx_free_currencies_json) AND json_type(fx_free_currencies_json) = 'array'
  ));

ALTER TABLE card_products ADD COLUMN reward_rules_json TEXT
  CHECK (reward_rules_json IS NULL OR (
    json_valid(reward_rules_json) AND json_type(reward_rules_json) = 'object'
  ));

ALTER TABLE card_products ADD COLUMN annual_fee_cycle_type TEXT
  CHECK (annual_fee_cycle_type IS NULL OR annual_fee_cycle_type IN (
    'none', 'anniversary_issued', 'anniversary_activated', 'calendar_year', 'custom_date'
  ));

ALTER TABLE card_products ADD COLUMN annual_fee_waiver_rules_json TEXT
  CHECK (annual_fee_waiver_rules_json IS NULL OR (
    json_valid(annual_fee_waiver_rules_json) AND json_type(annual_fee_waiver_rules_json) = 'object'
  ));

-- 仅在管理员通过后台接口手工保存结构化规则时写入时间戳；
-- 任何回填脚本必须校验 rules_updated_at IS NULL，即使管理员主动将某规则置回 NULL 亦绝不被覆盖。
ALTER TABLE card_products ADD COLUMN rules_updated_at TEXT;
