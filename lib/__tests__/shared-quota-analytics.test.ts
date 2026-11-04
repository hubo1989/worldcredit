import { describe, it, expect, beforeEach } from "vitest";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { setDb } from "../db/client";
import { getAnalyticsSummary } from "../api/analytics.server";
import { getHolderStatsPageData } from "../api/holders.server";

let db: SqliteD1;

beforeEach(async () => {
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);

  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'test@example.com', 'hash');
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '张三');

    -- 招行：默认共享额度
    INSERT INTO banks (id, name, quota_mode, statement_mode) VALUES ('b_cmb', '招商银行', 'shared', 'merged');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, currency)
    VALUES
      ('cp_cmb_classic', 'b_cmb', '招商银行', '经典白', 'CNY'),
      ('cp_cmb_bird', 'b_cmb', '招商银行', '百夫长', 'CNY');

    -- 工行：独立额度
    INSERT INTO banks (id, name, quota_mode, statement_mode) VALUES ('b_icbc', '中国工商银行', 'independent', 'independent');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, currency)
    VALUES ('cp_icbc_car', 'b_icbc', '中国工商银行', '车主卡', 'CNY');
  `);
});

describe("共享额度池去重统计 (E5/PRD 7.3)", () => {
  it("同一持卡人名下招行两张共享额度卡，总额度不重复累加", async () => {
    // 招行建立合并/共享账户，两张卡各填 50,000
    await db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, quota_mode, statement_mode)
      VALUES ('acc_cmb', 'h1', 'b_cmb', '招商银行', 'CNY', 'shared', 'merged');

      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, billing_day, status)
      VALUES
        ('cc_cmb_1', 'h1', 'acc_cmb', 'cp_cmb_classic', '1111', 50000, 10, 'active'),
        ('cc_cmb_2', 'h1', 'acc_cmb', 'cp_cmb_bird', '2222', 50000, 10, 'active');
    `);

    const summary = await getAnalyticsSummary({ holder_id: "h1" });
    // 共享额度池只算 1 次 50,000
    expect(summary.total_credit_limit).toBe(50000);

    const holderData = await getHolderStatsPageData("h1");
    expect(holderData.summary.totalLimit).toBe(50000);
  });

  it("当账户显式配置 shared_credit_limit 时优先取 shared_credit_limit", async () => {
    await db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, quota_mode, statement_mode, shared_credit_limit)
      VALUES ('acc_cmb', 'h1', 'b_cmb', '招商银行', 'CNY', 'shared', 'merged', 80000);

      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, billing_day, status)
      VALUES
        ('cc_cmb_1', 'h1', 'acc_cmb', 'cp_cmb_classic', '1111', 50000, 10, 'active'),
        ('cc_cmb_2', 'h1', 'acc_cmb', 'cp_cmb_bird', '2222', 60000, 10, 'active');
    `);

    const summary = await getAnalyticsSummary({ holder_id: "h1" });
    expect(summary.total_credit_limit).toBe(80000);

    const holderData = await getHolderStatsPageData("h1");
    expect(holderData.summary.totalLimit).toBe(80000);
  });

  it("共享池额度与独立卡额度正确累加", async () => {
    // 招行 2 张卡共享 50,000；工行 1 张卡独立 30,000；总计应为 80,000
    await db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, quota_mode, statement_mode)
      VALUES
        ('acc_cmb', 'h1', 'b_cmb', '招商银行', 'CNY', 'shared', 'merged'),
        ('acc_icbc', 'h1', 'b_icbc', '中国工商银行', 'CNY', 'independent', 'independent');

      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, billing_day, status)
      VALUES
        ('cc_cmb_1', 'h1', 'acc_cmb', 'cp_cmb_classic', '1111', 50000, 10, 'active'),
        ('cc_cmb_2', 'h1', 'acc_cmb', 'cp_cmb_bird', '2222', 50000, 10, 'active'),
        ('cc_icbc_1', 'h1', 'acc_icbc', 'cp_icbc_car', '3333', 30000, 15, 'active');
    `);

    const summary = await getAnalyticsSummary({ holder_id: "h1" });
    expect(summary.total_credit_limit).toBe(80000);

    const holderData = await getHolderStatsPageData("h1");
    expect(holderData.summary.totalLimit).toBe(80000);
  });
});
