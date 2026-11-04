import { describe, it, expect, beforeEach } from "vitest";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { setDb } from "../db/client";
import { getCardsWithBillsSummary, getBillDetail, createBill } from "../api/bills.server";

let db: SqliteD1;

beforeEach(async () => {
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);

  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'test@example.com', 'hash');
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');

    INSERT INTO banks (id, name, statement_mode, quota_mode)
    VALUES ('b_cmb', '招商银行', 'merged', 'shared');

    INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
    VALUES
      ('cp_cmb_classic', 'b_cmb', '招商银行', '经典白', 'CNY', 'after_billing', 20),
      ('cp_cmb_bird', 'b_cmb', '招商银行', '百夫长', 'CNY', 'after_billing', 20);

    -- 建立招行合并账户
    INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, billing_day)
    VALUES ('acc_cmb', 'h1', 'b_cmb', '招商银行', 'CNY', 'merged', 'shared', 10);

    INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, billing_day, status)
    VALUES
      ('cc_1', 'h1', 'acc_cmb', 'cp_cmb_classic', '0872', 50000, 10, 'active'),
      ('cc_2', 'h1', 'acc_cmb', 'cp_cmb_bird', '9765', 50000, 10, 'active');

    UPDATE credit_accounts SET primary_card_id = 'cc_1' WHERE id = 'acc_cmb';
  `);
});

describe("多卡统一账单摘要与读取路径 (E5/Phase 2)", () => {
  it("getCardsWithBillsSummary: 合并账户副卡抑制缺账，待还不重复累加", async () => {
    // 插入一笔 2026-10 期账单（总额 10000，挂在锚点卡 cc_1）
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b_oct', 'acc_cmb', 'cc_1', '2026-10', 10000, '2026-11-05', 'unpaid');

      -- 分卡小计：0872 消费 6000，9765 消费 3800，剩余 200 差额
      INSERT INTO bill_card_subtotals (id, bill_id, card_id, card_tail, subtotal_amount, currency)
      VALUES
        ('sub_1', 'b_oct', 'cc_1', '0872', 6000, 'CNY'),
        ('sub_2', 'b_oct', 'cc_2', '9765', 3800, 'CNY');
    `);

    const summaries = await getCardsWithBillsSummary("u1");
    expect(summaries).toHaveLength(2);

    const anchorSummary = summaries.find((s) => s.card.id === "cc_1")!;
    const secondarySummary = summaries.find((s) => s.card.id === "cc_2")!;

    // 主卡检查
    expect(anchorSummary.isAnchorCard).toBe(true);
    expect(anchorSummary.suppressMissingStatement).toBe(false);
    expect(anchorSummary.unpaidAmount).toBe(10000);
    expect(anchorSummary.activeBill?.subtotals).toHaveLength(2);
    expect(anchorSummary.activeBill?.unallocated_amount).toBe(200);

    // 副卡检查：必须抑制缺账，待还必须为 0
    expect(secondarySummary.isAnchorCard).toBe(false);
    expect(secondarySummary.suppressMissingStatement).toBe(true);
    expect(secondarySummary.unpaidAmount).toBe(0);
    expect(secondarySummary.memberCards).toHaveLength(2);
  });

  it("getBillDetail: 返回账户信息、分卡小计与未归卡差额", async () => {
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b_oct', 'acc_cmb', 'cc_1', '2026-10', 5000, '2026-11-05', 'unpaid');

      INSERT INTO bill_card_subtotals (id, bill_id, card_id, card_tail, subtotal_amount, currency)
      VALUES
        ('sub_1', 'b_oct', 'cc_1', '0872', 3000, 'CNY'),
        ('sub_2', 'b_oct', 'cc_2', '9765', 1500, 'CNY');
    `);

    const detail = await getBillDetail("b_oct");
    expect(detail.bill.account?.id).toBe("acc_cmb");
    expect(detail.bill.account?.statement_mode).toBe("merged");
    expect(detail.bill.subtotals).toHaveLength(2);
    // 5000 - (3000 + 1500) = 500
    expect(detail.bill.unallocated_amount).toBe(500);
    expect(detail.bill.member_cards).toHaveLength(2);
  });

  it("createBill: 自动补齐 account_id 并对齐 anchor card", async () => {
    // 传入副卡 cc_2，但账户是 merged，应自动对齐 card_id 为 cc_1
    const created = await createBill({
      card_id: "cc_2",
      bill_month: "2026-11",
      bill_amount: 8800,
      due_date: "2026-12-05",
      status: "unpaid",
      subtotals: [
        { card_tail: "0872", subtotal_amount: 5000 },
        { card_tail: "9765", subtotal_amount: 3800 },
      ],
    });

    expect(created.account_id).toBe("acc_cmb");
    expect(created.card_id).toBe("cc_1"); // 对齐锚点卡
    expect(created.bill_amount).toBe(8800);

    const detail = await getBillDetail(created.id);
    expect(detail.bill.subtotals).toHaveLength(2);
    expect(detail.bill.unallocated_amount).toBeUndefined(); // 5000+3800 = 8800，无差额
  });
});
