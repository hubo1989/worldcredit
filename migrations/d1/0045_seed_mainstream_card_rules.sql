-- 0045: 主流中/港/美卡产品的目录默认规则。链接为发卡行公开条款入口。
-- NULL 表示缺少统一适用的公开规则；周期 custom_date 需要持卡人确认具体扣费日。
-- 限定渠道、需要激活或现有规则结构无法表达的活动倍率，仅保留文字说明。
--
-- 迁移内暂存一份数据供两步复用。普通表与末尾 DROP 同在 D1 迁移事务中。
CREATE TABLE _hub176_card_rule_seed (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  card_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  annual_fee REAL,
  ftf_rate REAL,
  fx_free_currencies_json TEXT,
  annual_fee_cycle_type TEXT,
  reward_rules_json TEXT,
  annual_fee_waiver_rules_json TEXT,
  issuer_url TEXT NOT NULL,
  UNIQUE (bank_name, card_name)
);

INSERT INTO _hub176_card_rule_seed VALUES
  ('cp_seed_cmb_classic_platinum', 'CN', '招商银行', '经典白金卡', 'CNY', 3600, NULL, NULL, 'custom_date', NULL, '{"schema_version":1,"waiver_type":"points_redeem","notes":"磁条版主卡需 10,000 永久积分。芯片版主卡还需当年消费满 18 万元。核发满一年后的次月 1 日首扣。 发卡行条款：https://market.cmbchina.com/MPage/online/220607120009184/vippc/vip/jingdian/index.html"}', 'https://market.cmbchina.com/MPage/online/220607120009184/vippc/vip/jingdian/index.html'),
  ('cp_seed_cmb_amex_platinum', 'CN', '招商银行', '百夫长白金卡', 'CNY', 3600, NULL, NULL, 'custom_date', NULL, '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://market.cmbchina.com/MPage/online/220607120009184/vippc/vip/aebpc/index1.html"}', 'https://market.cmbchina.com/MPage/online/220607120009184/vippc/vip/aebpc/index1.html'),
  ('cp_seed_cmb_global_platinum', 'CN', '招商银行', '全币种国际白金卡', 'CNY', NULL, 0, NULL, 'custom_date', NULL, NULL, 'https://market.cmbchina.com/MPage/online/220607120009184/vippc/vip/quanbi/index.html'),
  ('cp_seed_cmb_freedom_platinum', 'CN', '招商银行', '自由人生白金卡', 'CNY', 800, NULL, NULL, 'custom_date', NULL, '{"schema_version":1,"waiver_type":"spend_amount","target_amount":80000,"target_currency":"CNY","notes":"持卡条款规定当年主卡合格消费满 8 万元免年费。2026-07-01 至 2027-06-30 核发适用首年免。 发卡行条款：https://market.cmbchina.com/MPage/online/241030163521870/zyb/index.html"}', 'https://market.cmbchina.com/MPage/online/241030163521870/zyb/index.html'),
  ('cp_seed_boc_joy_student', 'CN', '中国银行', '卓隽留学信用卡', 'CNY', 0, 0, NULL, 'none', NULL, '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.boc.cn/bcservice/bc1/"}', 'https://www.boc.cn/bcservice/bc1/'),
  ('cp_seed_boc_global_chip', 'CN', '中国银行', '全币种国际芯片卡', 'CNY', NULL, 0, NULL, 'custom_date', NULL, NULL, 'https://www.boc.cn/bcservice/bc1/'),
  ('cp_seed_icbc_shangrila', 'CN', '工商银行', '香格里拉白金卡', 'CNY', NULL, NULL, NULL, 'custom_date', NULL, NULL, 'https://www.icbc.com.cn/'),
  ('cp_seed_icbc_global_travel', 'CN', '工商银行', '环球旅行Plus信用卡', 'CNY', NULL, 0, NULL, 'custom_date', NULL, NULL, 'https://www.icbc.com.cn/'),
  ('cp_seed_ccb_premium', 'CN', '建设银行', '尊享白金信用卡', 'CNY', 1800, NULL, NULL, 'anniversary_issued', NULL, '{"schema_version":1,"waiver_type":"points_redeem","points_cost":400000,"notes":"主卡。积分兑换资格以建设银行条款为准。 发卡行条款：https://creditcard.ccb.com/"}', 'https://creditcard.ccb.com/'),
  ('cp_seed_ccb_muse', 'CN', '建设银行', 'Muse信用卡', 'CNY', 0, 0, NULL, 'none', NULL, '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcard.ccb.com/"}', 'https://creditcard.ccb.com/'),
  ('cp_seed_bocom_standard_platinum', 'CN', '交通银行', '标准白金信用卡', 'CNY', 1000, NULL, NULL, 'anniversary_issued', NULL, '{"schema_version":1,"waiver_type":"points_redeem","points_cost":250000,"notes":"主卡。特殊版本年费政策以发卡条款为准。 发卡行条款：https://creditcard.bankcomm.com/"}', 'https://creditcard.bankcomm.com/'),
  ('cp_seed_cgb_xili', 'CN', '广发银行', '犀利卡', 'CNY', NULL, NULL, NULL, 'custom_date', NULL, '{"schema_version":1,"waiver_type":"spend_count","first_year_free":true,"target_count":6,"notes":"合格消费笔数以卡片年费政策为准。 发卡行条款：https://card.cgbchina.com.cn/"}', 'https://card.cgbchina.com.cn/'),
  ('cp_seed_citic_yue', 'CN', '中信银行', '悦卡', 'CNY', NULL, NULL, NULL, 'custom_date', NULL, NULL, 'https://creditcard.ecitic.com/'),
  ('cp_seed_abc_premium', 'CN', '农业银行', '尊然白金信用卡（精粹版）', 'CNY', NULL, NULL, NULL, 'custom_date', NULL, NULL, 'https://www.abchina.com/cn/CreditCard/'),
  ('cp_seed_pingan_safari', 'CN', '平安银行', 'Safari信用卡', 'CNY', NULL, NULL, NULL, 'custom_date', NULL, NULL, 'https://creditcard.pingan.com/'),
  ('cp_seed_hsbc_pulse', 'HK', '汇丰香港', 'Pulse 银联双币钻石卡', 'HKD', NULL, 1.95, '["CNY","MOP"]', 'custom_date', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":0.4,"base_raw_label":"基础签账 0.4% 奖赏钱","category_rules":[],"notes":"指定地区及指定类别额外奖赏受活动条件和上限限制。 发卡行条款：https://www.hsbc.com.hk/credit-cards/products/unionpay-dual-currency-diamond/"}', NULL, 'https://www.hsbc.com.hk/credit-cards/products/unionpay-dual-currency-diamond/'),
  ('cp_seed_hsbc_red', 'HK', '汇丰香港', 'Red 信用卡', 'HKD', 0, 1.95, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":0.4,"base_raw_label":"基本签账 0.4% 奖赏钱","category_rules":[],"notes":"指定商户与网上签账奖励受合资格渠道和上限限制。 发卡行条款：https://www.hsbc.com.hk/credit-cards/products/red/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.hsbc.com.hk/credit-cards/products/red/"}', 'https://www.hsbc.com.hk/credit-cards/products/red/'),
  ('cp_seed_hsbc_everymile', 'HK', '汇丰香港', 'EveryMile 信用卡', 'HKD', 2000, 1.95, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"miles","base_rate_pct":1,"base_raw_label":"一般合资格签账 HK$5 = 1 里","category_rules":[],"point_unit_name":"里数","point_value_per_unit":0.05,"notes":"按 HK$1 奖赏钱可换 20 里作为保守折值。指定消费优惠另计。 发卡行条款：https://www.hsbc.com.hk/credit-cards/products/everymile/"}', '{"schema_version":1,"waiver_type":"first_year_free","first_year_free":true,"notes":"发卡行条款：https://www.hsbc.com.hk/credit-cards/products/everymile/"}', 'https://www.hsbc.com.hk/credit-cards/products/everymile/'),
  ('cp_seed_hsbc_visa_signature', 'HK', '汇丰香港', 'Visa Signature', 'HKD', NULL, NULL, NULL, 'custom_date', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":0.4,"base_raw_label":"基础签账 0.4% 奖赏钱","category_rules":[],"notes":"最红自主奖赏需登记，附类别限制。 发卡行条款：https://www.hsbc.com.hk/credit-cards/products/visa-signature/"}', NULL, 'https://www.hsbc.com.hk/credit-cards/products/visa-signature/'),
  ('cp_seed_sc_simply_cash', 'HK', '渣打香港', 'Simply Cash Visa', 'HKD', NULL, NULL, NULL, 'custom_date', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1.5,"base_raw_label":"一般合资格本地签账 1.5% 现金回赠","category_rules":[{"category":"dining","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"shopping","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"travel","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"transport","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"utilities","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"entertainment","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"medical","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"education","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"},{"category":"other","rate_pct":2,"raw_label":"一般合资格外币签账 2% 现金回赠","currency_scope":"foreign"}],"notes":"发卡行条款：https://www.sc.com/hk/credit-cards/simplycash/"}', NULL, 'https://www.sc.com/hk/credit-cards/simplycash/'),
  ('cp_seed_sc_cathay', 'HK', '渣打香港', '国泰 Mastercard', 'HKD', 2000, NULL, NULL, 'anniversary_issued', NULL, '{"schema_version":1,"waiver_type":"first_year_free","first_year_free":true,"notes":"发卡行条款：https://www.sc.com/hk/credit-cards/cathay/"}', 'https://www.sc.com/hk/credit-cards/cathay/'),
  ('cp_seed_amex_hk_explorer', 'HK', '美国运通香港', 'Explorer 信用卡', 'HKD', 2200, NULL, NULL, 'custom_date', NULL, NULL, 'https://www.americanexpress.com/hk/en/credit-cards/explorer-credit-card/'),
  ('cp_seed_bochk_chill', 'HK', '中银香港', 'Chill Card', 'HKD', NULL, NULL, NULL, 'custom_date', NULL, '{"schema_version":1,"waiver_type":"first_year_free","first_year_free":true,"notes":"发卡行列明白金版主卡首年免年费。具体卡版及条款以发卡行信息为准。 发卡行条款：https://www.bochk.com/dam/boccreditcard/chillcard/eng/index.html"}', 'https://www.bochk.com/dam/boccreditcard/chillcard/eng/index.html'),
  ('cp_seed_chase_csp', 'US', 'Chase', 'Sapphire Preferred', 'USD', 95, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"points","base_rate_pct":1.0,"base_raw_label":"一般消费 1X，按 1¢/点现金兑换","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"餐饮 3X","points_multiplier":3},{"category":"travel","rate_pct":2,"raw_label":"其他合资格旅行 2X","points_multiplier":2}],"point_unit_name":"Ultimate Rewards","point_value_per_unit":0.01,"notes":"发卡行条款：https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred"}', 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred'),
  ('cp_seed_chase_csr', 'US', 'Chase', 'Sapphire Reserve', 'USD', 795, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"points","base_rate_pct":1.0,"base_raw_label":"一般消费 1X，按 1¢/点现金兑换","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"餐饮 3X","points_multiplier":3}],"point_unit_name":"Ultimate Rewards","point_value_per_unit":0.01,"notes":"指定航空、酒店或渠道的倍率另计。 发卡行条款：https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"}', 'https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve'),
  ('cp_seed_chase_cfu', 'US', 'Chase', 'Freedom Unlimited', 'USD', 0, 3, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1.5,"base_raw_label":"一般消费 1.5% 返现","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"餐饮 3% 返现"}],"notes":"发卡行条款：https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited"}', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited'),
  ('cp_seed_chase_cff', 'US', 'Chase', 'Freedom Flex', 'USD', 0, 3, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1,"base_raw_label":"一般消费 1% 返现","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"餐饮 3% 返现"}],"notes":"季度类别需激活且受限，不纳入通用评分。 发卡行条款：https://creditcards.chase.com/cash-back-credit-cards/freedom/flex"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcards.chase.com/cash-back-credit-cards/freedom/flex"}', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/flex'),
  ('cp_seed_amex_us_gold', 'US', 'American Express', 'Gold Card', 'USD', 325, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"points","base_rate_pct":0.6,"base_raw_label":"一般消费 1X。按 0.6¢/点抵账单估值","category_rules":[],"point_unit_name":"Membership Rewards","point_value_per_unit":0.006,"notes":"餐厅和美国超市 4X 适用地区及年度额度限制，不纳入通用评分。 发卡行条款：https://www.americanexpress.com/us/credit-cards/card/gold-card/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.americanexpress.com/us/credit-cards/card/gold-card/"}', 'https://www.americanexpress.com/us/credit-cards/card/gold-card/'),
  ('cp_seed_amex_us_platinum', 'US', 'American Express', 'Platinum Card', 'USD', 895, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"points","base_rate_pct":0.6,"base_raw_label":"一般消费 1X。按 0.6¢/点抵账单估值","category_rules":[],"point_unit_name":"Membership Rewards","point_value_per_unit":0.006,"notes":"5X 机票及预付酒店受渠道与条件限制。 发卡行条款：https://www.americanexpress.com/us/credit-cards/card/platinum/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.americanexpress.com/us/credit-cards/card/platinum/"}', 'https://www.americanexpress.com/us/credit-cards/card/platinum/'),
  ('cp_seed_amex_us_bcp', 'US', 'American Express', 'Blue Cash Preferred', 'USD', 95, 2.7, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1,"base_raw_label":"一般消费 1% 返现","category_rules":[{"category":"transport","rate_pct":3,"raw_label":"合资格公共交通 3% 返现"}],"notes":"美国超市、流媒体与加油类别受额度、地区或商户限制。 发卡行条款：https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/"}', '{"schema_version":1,"waiver_type":"first_year_free","first_year_free":true,"notes":"发卡行条款：https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/"}', 'https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/'),
  ('cp_seed_capitalone_vx', 'US', 'Capital One', 'Venture X', 'USD', 395, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"miles","base_rate_pct":2,"base_raw_label":"一般消费 2X。合资格旅行抵扣按 1¢/里","category_rules":[],"point_unit_name":"Capital One Miles","point_value_per_unit":0.01,"notes":"发卡行条款：https://www.capitalone.com/credit-cards/venture-x/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.capitalone.com/credit-cards/venture-x/"}', 'https://www.capitalone.com/credit-cards/venture-x/'),
  ('cp_seed_capitalone_savor', 'US', 'Capital One', 'Savor Cash Rewards', 'USD', 0, 0, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1,"base_raw_label":"一般消费 1% 返现","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"合资格餐饮 3% 返现"},{"category":"entertainment","rate_pct":3,"raw_label":"合资格娱乐 3% 返现"}],"notes":"发卡行条款：https://www.capitalone.com/credit-cards/savor/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.capitalone.com/credit-cards/savor/"}', 'https://www.capitalone.com/credit-cards/savor/'),
  ('cp_seed_citi_strata_premier', 'US', 'Citi', 'Strata Premier', 'USD', 95, 0, NULL, 'anniversary_issued', '{"schema_version":1,"reward_kind":"points","base_rate_pct":1.0,"base_raw_label":"一般消费 1X。按 1¢/点现金兑换","category_rules":[{"category":"dining","rate_pct":3,"raw_label":"餐饮 3X","points_multiplier":3}],"point_unit_name":"ThankYou Points","point_value_per_unit":0.01,"notes":"其他限定旅行、超市及加油类别以发卡行条款为准。 发卡行条款：https://www.citi.com/credit-cards/citi-strata-premier-credit-card"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.citi.com/credit-cards/citi-strata-premier-credit-card"}', 'https://www.citi.com/credit-cards/citi-strata-premier-credit-card'),
  ('cp_seed_citi_double_cash', 'US', 'Citi', 'Double Cash', 'USD', 0, 3, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":2,"base_raw_label":"购买赚 1%，还款再赚 1%","category_rules":[],"notes":"发卡行条款：https://www.citi.com/credit-cards/citi-double-cash-credit-card"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://www.citi.com/credit-cards/citi-double-cash-credit-card"}', 'https://www.citi.com/credit-cards/citi-double-cash-credit-card'),
  ('cp_seed_wells_active_cash', 'US', 'Wells Fargo', 'Active Cash', 'USD', 0, 3, NULL, 'none', '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":2,"base_raw_label":"一般合资格消费 2% 现金回赠","category_rules":[],"notes":"发卡行条款：https://creditcards.wellsfargo.com/active-cash-credit-card/"}', '{"schema_version":1,"waiver_type":"none","notes":"发卡行条款：https://creditcards.wellsfargo.com/active-cash-credit-card/"}', 'https://creditcards.wellsfargo.com/active-cash-credit-card/');

-- A. 按归一化银行名和卡名匹配历史目录。银行目录尚未建档时保留空外键，不创建或覆盖银行。
INSERT OR IGNORE INTO card_products (
  id, country, bank_id, bank_name, card_name, currency, annual_fee, apply_url,
  ftf_rate, fx_free_currencies_json, annual_fee_cycle_type, reward_rules_json, annual_fee_waiver_rules_json
)
SELECT s.id, s.country, b.id, s.bank_name, s.card_name, s.currency, s.annual_fee, s.issuer_url,
       s.ftf_rate, s.fx_free_currencies_json, s.annual_fee_cycle_type, s.reward_rules_json, s.annual_fee_waiver_rules_json
FROM _hub176_card_rule_seed s
LEFT JOIN banks b ON lower(trim(b.name)) = lower(trim(s.bank_name)) AND b.country = s.country
WHERE NOT EXISTS (
  SELECT 1 FROM card_products cp
  WHERE lower(trim(cp.bank_name)) = lower(trim(s.bank_name)) AND lower(trim(cp.card_name)) = lower(trim(s.card_name))
);

-- B. 回填旧目录时保留原文本、已填写字段和管理员明确清空过的字段。
UPDATE card_products AS cp
SET ftf_rate = s.ftf_rate,
    fx_free_currencies_json = COALESCE(cp.fx_free_currencies_json, s.fx_free_currencies_json),
    reward_rules_json = s.reward_rules_json,
    annual_fee_cycle_type = COALESCE(cp.annual_fee_cycle_type, s.annual_fee_cycle_type),
    annual_fee_waiver_rules_json = s.annual_fee_waiver_rules_json
FROM _hub176_card_rule_seed s
WHERE lower(trim(cp.bank_name)) = lower(trim(s.bank_name)) AND lower(trim(cp.card_name)) = lower(trim(s.card_name))
  AND cp.reward_rules_json IS NULL
  AND cp.ftf_rate IS NULL
  AND cp.annual_fee_waiver_rules_json IS NULL
  AND cp.rules_updated_at IS NULL
  AND (s.reward_rules_json IS NOT NULL OR s.ftf_rate IS NOT NULL
       OR s.annual_fee_waiver_rules_json IS NOT NULL
       OR (cp.fx_free_currencies_json IS NULL AND s.fx_free_currencies_json IS NOT NULL)
       OR (cp.annual_fee_cycle_type IS NULL AND s.annual_fee_cycle_type IS NOT NULL));

DROP TABLE _hub176_card_rule_seed;
