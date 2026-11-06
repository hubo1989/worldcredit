import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOpportunityDb } from "./helpers/sqlite-d1";
import { setDb } from "../db";
import { createCard, deleteCard } from "../api/cards.server";
import { mergeCardsIntoAccount, splitCardFromAccount, getCreditAccountDetail } from "../api/accounts.server";

describe("Anchor Card Lifecycle Guard & Account Operations", () => {
  let db: ReturnType<typeof createOpportunityDb>;

  beforeEach(async () => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);

    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('u1', 'u1@example.com', 'h1');
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES
        ('h1', 'u1', 'u1', '持卡人甲'),
        ('h2', 'u1', 'u1', '持卡人乙');
      INSERT INTO banks (id, name, statement_mode, quota_mode) VALUES
        ('b_cmb', '招商银行', 'merged', 'shared');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency) VALUES
        ('cp_cmb', 'b_cmb', '招商银行', '经典白金卡', 'CNY');
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("createCard associates with existing merged account if one exists, otherwise creates new account", async () => {
    // 1. 创建第一张招行卡
    const card1 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
      credit_limit: 50000,
    });
    expect(card1.account_id).toBeTruthy();

    const acc1 = await getCreditAccountDetail(card1.account_id!);
    expect(acc1?.statement_mode).toBe("merged");
    expect(acc1?.primary_card_id).toBe(card1.id);

    // 2. 创建同持卡人同银行第二张招行卡，应自动挂载在同一个 credit_account
    const card2 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
      credit_limit: 60000,
    });
    expect(card2.account_id).toBe(card1.account_id);

    const accUpdated = await getCreditAccountDetail(card1.account_id!);
    expect(accUpdated?.cards.map((c) => c.id)).toEqual(
      expect.arrayContaining([card1.id, card2.id]),
    );
  });

  it("deleteCard transfers primary_card_id and bills when deleting anchor card in a multi-card account", async () => {
    const card1 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });
    const card2 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });

    // 插入挂在 card1（当前 primary_card_id）下的账单
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, due_date, bill_amount)
      VALUES ('bill_cmb_anchor', '${card1.account_id}', '${card1.id}', '2026-10', '2026-10-25', 8888);
    `);

    // 删除锚点卡 card1
    await deleteCard(card1.id);

    // card1 应被删除
    const checkCard1 = await db.prepare("SELECT * FROM credit_cards WHERE id = ?").bind(card1.id).first();
    expect(checkCard1).toBeNull();

    // 账户的 primary_card_id 应自动平滑移交给 card2
    const acc = await getCreditAccountDetail(card1.account_id!);
    expect(acc?.primary_card_id).toBe(card2.id);

    // 历史账单绝不丢失！且 card_id 随之平滑对齐为 card2！
    const bill = await db.prepare("SELECT * FROM bills WHERE id = 'bill_cmb_anchor'").first<{ card_id: string; bill_amount: number }>();
    expect(bill).not.toBeNull();
    expect(bill?.card_id).toBe(card2.id);
    expect(bill?.bill_amount).toBe(8888);
  });

  it("splitCardFromAccount splits a card into independent account and safely updates anchor", async () => {
    const card1 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });
    const card2 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });

    const newAcc = await splitCardFromAccount(card1.id);
    expect(newAcc.statement_mode).toBe("independent");
    expect(newAcc.primary_card_id).toBe(card1.id);

    // card1 挂在新账户上
    const c1Row = await db.prepare("SELECT account_id FROM credit_cards WHERE id = ?").bind(card1.id).first<{ account_id: string }>();
    expect(c1Row?.account_id).toBe(newAcc.id);

    // 原账户的锚点卡切换为 card2
    const oldAcc = await getCreditAccountDetail(card2.account_id!);
    expect(oldAcc?.primary_card_id).toBe(card2.id);
  });

  it("mergeCardsIntoAccount merges cards into target account and rejects same-month collisions", async () => {
    const card1 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });
    // 拆出 card2 为独立账户
    const card2 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });
    const indepAcc = await splitCardFromAccount(card2.id);

    // 两个账户在 2026-10 均有账单 -> 碰撞！
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, due_date, bill_amount)
      VALUES
        ('b_t1', '${card1.account_id}', '${card1.id}', '2026-10', '2026-10-25', 1000),
        ('b_t2', '${indepAcc.id}', '${card2.id}', '2026-10', '2026-10-25', 2000);
    `);

    // 试图合并 card2 进 card1.account_id -> 必须报冲突并拒绝！
    await expect(mergeCardsIntoAccount(card1.account_id!, [card2.id])).rejects.toThrow(
      /检测到历史账单碰撞/,
    );
  });

  it("mergeCardsIntoAccount rejects cross-holder merge", async () => {
    const card1 = await createCard({
      holder_id: "h1",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });
    const cardH2 = await createCard({
      holder_id: "h2",
      card_product_id: "cp_cmb",
      billing_day: 5,
    });

    await expect(mergeCardsIntoAccount(card1.account_id!, [cardH2.id])).rejects.toThrow(
      /不可跨持卡人合并/,
    );
  });
});
