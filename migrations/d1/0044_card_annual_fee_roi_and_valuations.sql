-- 0044_card_annual_fee_roi_and_valuations.sql
-- 1. credit_cards 扩展年费周期、下次扣费日（强校验真实日历日，绝不回填 created_at）、状态、免年费进度与实付/手动回血字段
-- 2. opportunity_definitions（目录默认估值）与 opportunity_accounts（持卡人个人覆盖估值）双层单次估值列
-- 3. promo_usages 兼容实得返现列与 ROI 聚合复合索引

ALTER TABLE credit_cards ADD COLUMN annual_fee_cycle_type TEXT
  CHECK (annual_fee_cycle_type IS NULL OR annual_fee_cycle_type IN (
    'none', 'anniversary_issued', 'anniversary_activated', 'calendar_year', 'custom_date'
  ));

ALTER TABLE credit_cards ADD COLUMN next_annual_fee_date TEXT
  CHECK (next_annual_fee_date IS NULL OR (
    length(next_annual_fee_date) = 10 AND date(next_annual_fee_date, '+0 days') IS next_annual_fee_date
  ));

ALTER TABLE credit_cards ADD COLUMN annual_fee_status TEXT
  CHECK (annual_fee_status IS NULL OR annual_fee_status IN (
    'not_applicable', 'in_progress', 'waived', 'paid', 'unknown'
  ));

ALTER TABLE credit_cards ADD COLUMN waiver_progress_json TEXT
  CHECK (waiver_progress_json IS NULL OR (
    json_valid(waiver_progress_json) AND json_type(waiver_progress_json) = 'object'
  ));

ALTER TABLE credit_cards ADD COLUMN actual_fee_paid REAL
  CHECK (actual_fee_paid IS NULL OR (typeof(actual_fee_paid) IN ('integer', 'real') AND actual_fee_paid >= 0));

ALTER TABLE credit_cards ADD COLUMN manual_reward_value REAL
  CHECK (manual_reward_value IS NULL OR (typeof(manual_reward_value) IN ('integer', 'real') AND manual_reward_value >= 0));

CREATE INDEX IF NOT EXISTS idx_credit_cards_next_annual_fee
  ON credit_cards(status, card_type, next_annual_fee_date)
  WHERE next_annual_fee_date IS NOT NULL;

-- 权益定义级默认估值（管理员或私有定义创建者可配）
ALTER TABLE opportunity_definitions ADD COLUMN estimated_unit_value_minor INTEGER
  CHECK (estimated_unit_value_minor IS NULL OR (typeof(estimated_unit_value_minor) = 'integer' AND estimated_unit_value_minor >= 0));

ALTER TABLE opportunity_definitions ADD COLUMN estimated_value_currency TEXT
  CHECK (estimated_value_currency IS NULL OR length(estimated_value_currency) = 3);

-- 权益账户级个人自用估值（优先于定义级默认估值；不触发 0013 opportunity_accounts_identity_immutable）
ALTER TABLE opportunity_accounts ADD COLUMN estimated_unit_value_minor INTEGER
  CHECK (estimated_unit_value_minor IS NULL OR (typeof(estimated_unit_value_minor) = 'integer' AND estimated_unit_value_minor >= 0));

ALTER TABLE opportunity_accounts ADD COLUMN estimated_value_currency TEXT
  CHECK (estimated_value_currency IS NULL OR length(estimated_value_currency) = 3);

-- 旧版优惠活动实得返现补录列
ALTER TABLE promo_usages ADD COLUMN cashback_amount REAL
  CHECK (cashback_amount IS NULL OR (typeof(cashback_amount) IN ('integer', 'real') AND cashback_amount >= 0));

ALTER TABLE promo_usages ADD COLUMN cashback_currency TEXT
  CHECK (cashback_currency IS NULL OR length(cashback_currency) = 3);

-- 支撑单卡与全家庭按 card_id + 时间窗口毫秒级聚合 ROI
CREATE INDEX IF NOT EXISTS idx_opportunity_usages_card_used
  ON opportunity_usages(card_id, status, used_on);

CREATE INDEX IF NOT EXISTS idx_promo_usages_card_used
  ON promo_usages(card_id, used_at);

-- 通知只按命中卡片的持卡人及当期时间窗口读取任务奖励。
CREATE INDEX IF NOT EXISTS idx_opportunity_fulfillments_holder_recorded
  ON opportunity_fulfillments(holder_id, recorded_on)
  WHERE kind = 'task_result' AND status != 'cancelled';
