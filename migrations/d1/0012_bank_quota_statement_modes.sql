-- 0012: 银行维度的额度模式与账单模式。
--
-- 同一银行多张卡存在两种真实形态，此前只能靠卡片级推导，无法表达：
--   * quota_mode = 'shared'    多卡共享额度：额度是一个池，不随卡数叠加
--   * quota_mode = 'independent'（默认）每卡独立额度
--   * statement_mode = 'merged'   多卡合并账单：同银行多卡合一张账单一起还
--   * statement_mode = 'independent'（默认）每卡单独账单
ALTER TABLE banks ADD COLUMN quota_mode TEXT NOT NULL DEFAULT 'independent'
  CHECK (quota_mode IN ('independent', 'shared'));
ALTER TABLE banks ADD COLUMN statement_mode TEXT NOT NULL DEFAULT 'independent'
  CHECK (statement_mode IN ('independent', 'merged'));
