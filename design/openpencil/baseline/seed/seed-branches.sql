-- ============================================================================
-- WorldCredit 基线种子数据 — 业务分支覆盖
--
-- 目的：本地 D1 数据量太小（1 持卡人 / 27 卡 / 1 账单），default 态取证
--       拿不到多币种、部分还款、逾期、免息期、未出账单这些分支。
--       本脚本补齐这些分支，让基线截图能覆盖真实业务状态。
--
-- 设计原则：
--   1. 只增不改：不 UPDATE / DELETE 任何现有行，避免破坏已有基线。
--   2. 幂等：全部使用固定 id + INSERT OR REPLACE，可重复执行。
--   3. 状态由读时计算：bills.status 只是初始值，
--      真正生效的是 computeStatus()（依据 paid_amount 与 due_date）。
--      所以「部分还款」靠 payments 行制造，「逾期」靠过去的 due_date 制造。
--   4. 多币种来自 card_products.currency，不是 bill_items.currency。
--
-- 执行：
--   npx wrangler d1 execute worldcredit --local --file design/openpencil/baseline/seed/seed-branches.sql
-- ============================================================================

-- 固定 id 前缀，便于识别与回滚
-- holder:  b0000001-...     cards: c0000001-...  products: d0000001-...
-- bills:   e0000001-...     payments: f0000001-...

-- ---------------------------------------------------------------------------
-- 0. 复用真实用户与持卡人（不新建，避免多出一套账户）
-- ---------------------------------------------------------------------------
-- created_by / managed_by 使用已存在的真实用户 id：
--   hubo1989@gmail.com = ea04e4d4-6571-4ddb-a208-a54ad4aafe9e
-- 持卡人沿用现有的：c5449849-d651-5256-b70f-f038ac2fd25e (呼博)

-- ---------------------------------------------------------------------------
-- 1. 卡产品：多币种（USD / HKD）与不同免息期
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO card_products
  (id, country, bank_id, bank_name, card_name, card_image_id, description_md, apply_url,
   rewards_summary, currency, payment_due_type, payment_due_value, annual_fee, annual_fee_waiver, is_active, created_at)
VALUES
  -- 美元卡：after_billing 25 天免息，用于多币种折算分支
  ('d0000001-0000-4000-8000-000000000001', 'US', NULL, 'American Express', 'Platinum Card',
   NULL, NULL, NULL, NULL, 'USD', 'after_billing', 25, 0, NULL, 1, '2026-01-01 00:00:00'),
  -- 港币卡：after_billing 20 天免息
  ('d0000002-0000-4000-8000-000000000002', 'HK', NULL, '汇丰银行', 'Visa Signature',
   NULL, NULL, NULL, NULL, 'HKD', 'after_billing', 20, 0, NULL, 1, '2026-01-01 00:00:00'),
  -- 固定还款日卡：fixed 15 号，用于「固定还款日」分支
  ('d0000003-0000-4000-8000-000000000003', 'CN', NULL, '中国建设银行', '龙卡全球支付',
   NULL, NULL, NULL, NULL, 'CNY', 'fixed', 15, 0, NULL, 1, '2026-01-01 00:00:00'),
  -- 长免息期卡：after_billing 50 天，用于免息期展示
  ('d0000004-0000-4000-8000-000000000004', 'CN', NULL, '交通银行', '标准白金卡',
   NULL, NULL, NULL, NULL, 'CNY', 'after_billing', 50, 0, NULL, 1, '2026-01-01 00:00:00');

-- ---------------------------------------------------------------------------
-- 2. 卡片：绑定到现有持卡人
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO credit_cards
  (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type,
   loan_due_day, override_billing_day, override_due_type, override_due_value, created_at, name_override, annual_fee_override)
VALUES
  -- 多币种 USD
  ('c0000001-0000-4000-8000-000000000001', 'c5449849-d651-5256-b70f-f038ac2fd25e',
   'd0000001-0000-4000-8000-000000000001', '9001', 80000, 8, 'active', 'credit',
   NULL, NULL, NULL, NULL, '2026-01-01 00:00:00', NULL, NULL),
  -- 多币种 HKD
  ('c0000002-0000-4000-8000-000000000002', 'c5449849-d651-5256-b70f-f038ac2fd25e',
   'd0000002-0000-4000-8000-000000000002', '9002', 120000, 12, 'active', 'credit',
   NULL, NULL, NULL, NULL, '2026-01-01 00:00:00', NULL, NULL),
  -- 固定还款日
  ('c0000003-0000-4000-8000-000000000003', 'c5449849-d651-5256-b70f-f038ac2fd25e',
   'd0000003-0000-4000-8000-000000000003', '9003', 50000, 20, 'active', 'credit',
   NULL, NULL, NULL, NULL, '2026-01-01 00:00:00', NULL, NULL),
  -- 长免息期
  ('c0000004-0000-4000-8000-000000000004', 'c5449849-d651-5256-b70f-f038ac2fd25e',
   'd0000004-0000-4000-8000-000000000004', '9004', 200000, 5, 'active', 'credit',
   NULL, NULL, NULL, NULL, '2026-01-01 00:00:00', NULL, NULL);

-- ---------------------------------------------------------------------------
-- 3. 账单：覆盖 未出账 / 待还 / 部分还款 / 逾期 四类状态
--
-- 日期用 SQLite 相对时间生成，保证脚本任何时候跑都成立：
--   date('now','start of month','-1 month')  → 上月
-- computeStatus 只看 due_date 与 paid_amount，所以：
--   逾期 = due_date 在过去（-14 天）
--   部分还款 = 有 payments 但金额 < bill_amount
--   免息期 = due_date 在未来
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO bills
  (id, card_id, bill_month, statement_start, statement_end, statement_date,
   bill_amount, min_payment, due_date, status, created_at, bill_amount_override)
VALUES
  -- A. 待还（未来到期，正常免息期）：USD 卡
  ('e0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001',
   strftime('%Y-%m', date('now','start of month')),
   date('now','start of month','-1 month','+8 days'), date('now','start of month','+7 days'), date('now','start of month','+8 days'),
   2860.00, 286.00, date('now','+18 days'), 'unpaid', '2026-01-01 00:00:00', NULL),

  -- B. 部分还款：HKD 卡，账单 25000，已还 10000 → computed partial
  ('e0000002-0000-4000-8000-000000000002', 'c0000002-0000-4000-8000-000000000002',
   strftime('%Y-%m', date('now','start of month')),
   date('now','start of month','-1 month','+12 days'), date('now','start of month','+11 days'), date('now','start of month','+12 days'),
   25000.00, 2500.00, date('now','+6 days'), 'partial', '2026-01-01 00:00:00', NULL),

  -- C. 逾期：CNY 固定还款日卡，到期日已过 14 天，无还款 → computed overdue
  ('e0000003-0000-4000-8000-000000000003', 'c0000003-0000-4000-8000-000000000003',
   strftime('%Y-%m', date('now','start of month','-1 month')),
   date('now','start of month','-2 month','+20 days'), date('now','start of month','-1 month','+19 days'), date('now','start of month','-1 month','+20 days'),
   3680.55, 368.05, date('now','-14 days'), 'overdue', '2026-01-01 00:00:00', NULL),

  -- D. 手动设定金额（bill_amount_override 优先）：长免息期卡
  --    导入金额 12000，手填 8000 → 读边界用 8000
  ('e0000004-0000-4000-8000-000000000004', 'c0000004-0000-4000-8000-000000000004',
   strftime('%Y-%m', date('now','start of month')),
   date('now','start of month','-1 month','+5 days'), date('now','start of month','+4 days'), date('now','start of month','+5 days'),
   12000.00, 1200.00, date('now','+45 days'), 'unpaid', '2026-01-01 00:00:00', 8000.00),

  -- E. 已结清（历史账单，用于历史明细折叠）
  ('e0000005-0000-4000-8000-000000000005', 'c0000001-0000-4000-8000-000000000001',
   strftime('%Y-%m', date('now','start of month','-1 month')),
   date('now','start of month','-2 month','+8 days'), date('now','start of month','-1 month','+7 days'), date('now','start of month','-1 month','+8 days'),
   1980.00, 198.00, date('now','-25 days'), 'unpaid', '2026-01-01 00:00:00', NULL);

-- ---------------------------------------------------------------------------
-- 4. 还款记录：制造「部分还款」与「已结清」
--    computeStatus 依据 paidAmount 判定，不只看 bills.status
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key, created_at)
VALUES
  -- B 账单部分还款：25000 里还了 10000
  ('f0000001-0000-4000-8000-000000000001', 'e0000002-0000-4000-8000-000000000002',
   10000.00, date('now','-3 days'), '手动还款', '基线种子：部分还款', 'seed-partial-0002', '2026-01-01 00:00:00'),
  -- E 账单全额结清：1980 全部还清
  ('f0000002-0000-4000-8000-000000000002', 'e0000005-0000-4000-8000-000000000005',
   1980.00, date('now','-20 days'), '自动还款', '基线种子：已结清', 'seed-paid-0005', '2026-01-01 00:00:00');

-- ---------------------------------------------------------------------------
-- 5. 账单明细：制造分类占比与消费趋势（analytics 依赖）
--    币种跟随所属卡片：USD 卡 → USD，HKD 卡 → HKD
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO bill_items
  (id, bill_id, transaction_date, post_date, description, merchant_name, category,
   amount, currency, item_type, source, confidence, created_at)
VALUES
  -- USD 卡账单明细（境外消费分支）
  ('a0000001-0000-4000-8000-000000000001', 'e0000001-0000-4000-8000-000000000001',
   date('now','-12 days'), date('now','-11 days'), 'AMAZON.COM', 'Amazon', 'shopping', 860.00, 'USD', 'purchase', 'email', 0.95, '2026-01-01 00:00:00'),
  ('a0000002-0000-4000-8000-000000000002', 'e0000001-0000-4000-8000-000000000001',
   date('now','-8 days'), date('now','-7 days'), 'UNITED AIRLINES', 'United Airlines', 'travel', 1200.00, 'USD', 'purchase', 'email', 0.92, '2026-01-01 00:00:00'),
  ('a0000003-0000-4000-8000-000000000003', 'e0000001-0000-4000-8000-000000000001',
   date('now','-5 days'), date('now','-4 days'), 'STARBUCKS', 'Starbucks', 'dining', 800.00, 'USD', 'purchase', 'llm', 0.88, '2026-01-01 00:00:00'),
  -- HKD 卡账单明细
  ('a0000004-0000-4000-8000-000000000004', 'e0000002-0000-4000-8000-000000000002',
   date('now','-10 days'), date('now','-9 days'), 'HONG KONG RESTAURANT', 'HK Restaurant', 'dining', 15000.00, 'HKD', 'purchase', 'manual', NULL, '2026-01-01 00:00:00'),
  ('a0000005-0000-4000-8000-000000000005', 'e0000002-0000-4000-8000-000000000002',
   date('now','-6 days'), date('now','-5 days'), 'MTR', 'MTR', 'transport', 10000.00, 'HKD', 'purchase', 'manual', NULL, '2026-01-01 00:00:00'),
  -- CNY 逾期卡明细
  ('a0000006-0000-4000-8000-000000000006', 'e0000003-0000-4000-8000-000000000003',
   date('now','-30 days'), date('now','-29 days'), '京东商城', '京东', 'shopping', 3680.55, 'CNY', 'purchase', 'email', 0.97, '2026-01-01 00:00:00'),
  -- 长免息期卡明细
  ('a0000007-0000-4000-8000-000000000007', 'e0000004-0000-4000-8000-000000000004',
   date('now','-15 days'), date('now','-14 days'), '铁路 12306', '中国铁路', 'travel', 8000.00, 'CNY', 'purchase', 'manual', NULL, '2026-01-01 00:00:00');

-- ---------------------------------------------------------------------------
-- 6. 用户偏好：确认默认币种为 CNY（多币种折算目标）
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO user_preferences (id, user_id, display_config, reminder_config, updated_at)
VALUES (
  'b0000009-0000-4000-8000-000000000009',
  'ea04e4d4-6571-4ddb-a208-a54ad4aafe9e',
  '{"privacy_mode":false,"show_min_payment":true,"show_statement_date":true,"show_annual_fee":true,"show_card_last4":true,"default_currency":"CNY"}',
  '{"remind_days_before":[3,1,0],"quiet_hours_start":"22:00","quiet_hours_end":"08:00","enabled_channels":["web_push"]}',
  '2026-01-01 00:00:00'
);
