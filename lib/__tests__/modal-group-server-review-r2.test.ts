import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOpportunityDb } from "./helpers/sqlite-d1";
import { setDb } from "../db";
import { createCard, updateCard } from "../api/cards.server";
import { mergeCardsIntoAccount } from "../api/accounts.server";
import { createHolder } from "../api/holders.server";

describe("PR #55 Review R2 - Server Regressions (High 1, Medium 6, Medium 7)", () => {
  let db: ReturnType<typeof createOpportunityDb>;

  beforeEach(async () => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);

    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('u1', 'u1@example.com', 'h1');
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES
        ('h1', 'u1', 'u1', '持卡人甲');
      INSERT INTO banks (id, name, statement_mode, quota_mode) VALUES
        ('b_cmb', '招商银行', 'merged', 'shared'),
        ('b_icbc', '中国工商银行', 'independent', 'independent'),
        ('b_empty', '新合作银行', 'independent', 'independent');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency) VALUES
        ('cp_cmb', 'b_cmb', '招商银行', '经典白金卡', 'CNY'),
        ('cp_icbc', 'b_icbc', '中国工商银行', '工行牡丹卡', 'CNY');
    `);
  });

  afterEach(() => {
    setDb(null);
    db.close();
  });

  it("High 1: mergeCardsIntoAccount rejects cross-bank merge (防御纵深拒绝跨行)", async () => {
    const cardCmb = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
      credit_limit: 50000,
    });
    const cardIcbc = await createCard({
      holder_id: "h1",
      card_product_id: "cp_icbc",
      billing_day: 5,
      credit_limit: 30000,
    });

    expect(cardCmb.account_id).toBeTruthy();
    expect(cardIcbc.account_id).toBeTruthy();

    await expect(
      mergeCardsIntoAccount(cardCmb.account_id!, [cardIcbc.id]),
    ).rejects.toThrow("不可跨银行合并信用卡至同一账户");
  });

  it("Medium 6: updateCard with empty product bank dynamically ensures default product (无产品银行自动补全默认产品)", async () => {
    const card = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
      credit_limit: 50000,
    });

    // 切换到无卡产品的新银行 b_empty，客户端不传 card_product_id
    const updated = await updateCard(card.id, {
      bank_id: "b_empty",
    });

    expect(updated.card_product_id).toBe("cp_default_b_empty");
    expect(updated.card_product?.bank_id).toBe("b_empty");
    expect(updated.card_product?.card_name).toBe("标准信用卡");
  });

  it("Medium 7: createCard & updateCard reject invalid override due rules (还款规则范围校验)", async () => {
    // 1. after_billing 负数天数被拒绝
    await expect(
      createCard({
        holder_id: "h1",
        card_product_id: "cp_cmb",
        billing_day: 5,
        credit_limit: 50000,
        override_due_type: "after_billing",
        override_due_value: -1,
      }),
    ).rejects.toThrow("账单日后还款天数必须大于或等于 0");

    // 2. fixed 固定日 < 1 或 > 31 被拒绝
    await expect(
      createCard({
        holder_id: "h1",
        card_product_id: "cp_cmb",
        billing_day: 5,
        credit_limit: 50000,
        override_due_type: "fixed",
        override_due_value: 0,
      }),
    ).rejects.toThrow("固定还款日必须在 1 到 31 之间");

    await expect(
      createCard({
        holder_id: "h1",
        card_product_id: "cp_cmb",
        billing_day: 5,
        credit_limit: 50000,
        override_due_type: "fixed",
        override_due_value: 32,
      }),
    ).rejects.toThrow("固定还款日必须在 1 到 31 之间");

    // 3. 启用规则却不传值被拒绝
    await expect(
      createCard({
        holder_id: "h1",
        card_product_id: "cp_cmb",
        billing_day: 5,
        credit_limit: 50000,
        override_due_type: "after_billing",
        override_due_value: undefined,
      }),
    ).rejects.toThrow("启用自定义还款规则时必须提供有效的还款日数值");

    // 4. updateCard 同样受校验保护
    const card = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
      credit_limit: 50000,
    });

    await expect(
      updateCard(card.id, {
        override_due_type: "fixed",
        override_due_value: 40,
      }),
    ).rejects.toThrow("固定还款日必须在 1 到 31 之间");
  });

  it("createHolder rejects empty or whitespace name", async () => {
    await expect(
      createHolder({
        name: "   ",
        avatar_color: "#7aadff",
      }),
    ).rejects.toThrow("持卡人姓名不能为空");
  });
});
