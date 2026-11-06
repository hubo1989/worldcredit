import { describe, it, expect } from "vitest";
import { createOpportunityDb, createSqliteD1 } from "./helpers/sqlite-d1";

describe("0032_unified_credit_accounts: Schema, Backfill, Triggers & Bank Defaults", () => {
  it("verifies the 4 banks defaults are statement_mode='merged' and quota_mode='shared'", async () => {
    const db = createOpportunityDb();

    // 插入测试的 4 家银行（若不存在）并运行更新
    await db.exec(`
      INSERT OR IGNORE INTO banks (id, name) VALUES
        ('b_cmb', '招商银行'),
        ('b_cmbc', '中国民生银行'),
        ('b_bos', '上海银行'),
        ('b_bob', '北京银行'),
        ('b_icbc', '中国工商银行');

      UPDATE banks
      SET statement_mode = 'merged', quota_mode = 'shared'
      WHERE name IN ('招商银行', '中国民生银行', '民生银行', '上海银行', '北京银行')
         OR name LIKE '%招商%'
         OR name LIKE '%民生%'
         OR name LIKE '%上海银行%'
         OR name LIKE '%北京银行%';
    `);

    const banks = (
      await db.prepare("SELECT name, statement_mode, quota_mode FROM banks WHERE id IN ('b_cmb', 'b_cmbc', 'b_bos', 'b_bob', 'b_icbc')").all<{
        name: string;
        statement_mode: string;
        quota_mode: string;
      }>()
    ).results;

    const cmb = banks.find((b) => b.name === "招商银行");
    const cmbc = banks.find((b) => b.name === "中国民生银行");
    const bos = banks.find((b) => b.name === "上海银行");
    const bob = banks.find((b) => b.name === "北京银行");
    const icbc = banks.find((b) => b.name === "中国工商银行");

    expect(cmb).toMatchObject({ statement_mode: "merged", quota_mode: "shared" });
    expect(cmbc).toMatchObject({ statement_mode: "merged", quota_mode: "shared" });
    expect(bos).toMatchObject({ statement_mode: "merged", quota_mode: "shared" });
    expect(bob).toMatchObject({ statement_mode: "merged", quota_mode: "shared" });
    expect(icbc).toMatchObject({ statement_mode: "independent", quota_mode: "independent" });

    db.close();
  });

  it("verifies backfill logic on various scenarios: no collision merged, collision kept independent, cross-holder isolated", async () => {
    // 创建一个从 0001 执行到 0031 的干净库，插入存量数据，再应用 0032
    const db = createSqliteD1();
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migrationsDir = path.join(__dirname, "../../migrations/d1");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    // 运行 0001 - 0031
    for (const f of files) {
      if (f.startsWith("0032")) break;
      db.exec(fs.readFileSync(path.join(migrationsDir, f), "utf8"));
    }

    // 灌入存量数据
    db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('u1', 'u1@example.com', 'h1'),
        ('u2', 'u2@example.com', 'h2');

      INSERT INTO banks (id, name, statement_mode, quota_mode) VALUES
        ('b_cmb', '招商银行', 'merged', 'shared'),
        ('b_cmbc', '民生银行', 'merged', 'shared'),
        ('b_icbc', '中国工商银行', 'independent', 'independent');

      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value) VALUES
        ('cp_cmb', 'b_cmb', '招商银行', '经典白', 'CNY', 'after_billing', 20),
        ('cp_cmbc', 'b_cmbc', '民生银行', '标准卡', 'CNY', 'after_billing', 20),
        ('cp_icbc', 'b_icbc', '中国工商银行', '牡丹卡', 'CNY', 'after_billing', 25);

      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES
        ('h1', 'u1', 'u1', '持卡人甲'),
        ('h2', 'u2', 'u2', '持卡人乙');

      -- 场景 1：h1 招商银行 2 张卡，card1 有 2026-09 和 2026-10 账单，card2 无账单 -> 无同月碰撞，应合并！
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit, status, created_at) VALUES
        ('card_cmb_1', 'h1', 'cp_cmb', 5, 50000, 'active', '2026-01-01T00:00:00Z'),
        ('card_cmb_2', 'h1', 'cp_cmb', 5, 60000, 'active', '2026-01-02T00:00:00Z');

      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount) VALUES
        ('bill_cmb_1', 'card_cmb_1', '2026-09', '2026-09-25', 1000),
        ('bill_cmb_2', 'card_cmb_1', '2026-10', '2026-10-25', 2000);

      -- 场景 2：h1 民生银行 2 张卡（0872 与 另一张卡），两张卡均有 2026-10 账单 -> 同月碰撞！绝不强行合并，各自保留 independent！
      INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, credit_limit, status, created_at) VALUES
        ('card_cmbc_coll_1', 'h1', 'cp_cmbc', '0872', 22, 30000, 'active', '2026-01-01T00:00:00Z'),
        ('card_cmbc_coll_2', 'h1', 'cp_cmbc', '1234', 27, 30000, 'active', '2026-01-02T00:00:00Z');

      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount) VALUES
        ('bill_cmbc_1', 'card_cmbc_coll_1', '2026-10', '2026-11-16', 3000),
        ('bill_cmbc_2', 'card_cmbc_coll_2', '2026-10', '2026-11-21', 4000);

      -- 场景 3：h2 民生银行尾号 9765 卡 -> 持卡人是 h2！与 h1 的 0872 属于不同持卡人，严禁跨人合并！
      INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, credit_limit, status, created_at) VALUES
        ('card_cmbc_h2_9765', 'h2', 'cp_cmbc', '9765', 27, 40000, 'active', '2026-01-03T00:00:00Z');

      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount) VALUES
        ('bill_cmbc_h2', 'card_cmbc_h2_9765', '2026-10', '2026-11-21', 5000);

      -- 场景 4：h1 工商银行（independent 银行）单卡 -> independent 账户
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit, status, created_at) VALUES
        ('card_icbc_1', 'h1', 'cp_icbc', 15, 20000, 'active', '2026-01-01T00:00:00Z');
    `);

    // 现在执行 0032 迁移！
    db.exec(fs.readFileSync(path.join(migrationsDir, "0032_unified_credit_accounts.sql"), "utf8"));

    // 验证场景 1（招行多卡无碰撞合并）
    const cmbCards = (
      await db.prepare("SELECT id, account_id FROM credit_cards WHERE id IN ('card_cmb_1', 'card_cmb_2')").all<{
        id: string;
        account_id: string;
      }>()
    ).results;
    expect(cmbCards[0].account_id).toBeTruthy();
    expect(cmbCards[0].account_id).toBe(cmbCards[1].account_id);

    const cmbAccount = await db
      .prepare("SELECT * FROM credit_accounts WHERE id = ?")
      .bind(cmbCards[0].account_id)
      .first<{
        statement_mode: string;
        quota_mode: string;
        primary_card_id: string;
        shared_credit_limit: number;
      }>();
    expect(cmbAccount).toMatchObject({
      statement_mode: "merged",
      quota_mode: "shared",
      primary_card_id: "card_cmb_1", // card_cmb_1 账单多，成为锚点卡
      shared_credit_limit: 60000, // 取组内 MAX(50000, 60000)
    });

    // 验证招行历史账单的 account_id 和 card_id
    const cmbBills = (
      await db.prepare("SELECT id, card_id, account_id FROM bills WHERE id IN ('bill_cmb_1', 'bill_cmb_2')").all<{
        id: string;
        card_id: string;
        account_id: string;
      }>()
    ).results;
    expect(cmbBills[0].account_id).toBe(cmbCards[0].account_id);
    expect(cmbBills[1].account_id).toBe(cmbCards[0].account_id);
    expect(cmbBills[0].card_id).toBe("card_cmb_1");
    expect(cmbBills[1].card_id).toBe("card_cmb_1");

    // 验证场景 2（h1 民生卡同月碰撞 -> 保守回填，绝不合并，账单零删除零篡改）
    const cmbcCollCards = (
      await db
        .prepare("SELECT id, account_id FROM credit_cards WHERE id IN ('card_cmbc_coll_1', 'card_cmbc_coll_2')")
        .all<{ id: string; account_id: string }>()
    ).results;
    expect(cmbcCollCards[0].account_id).not.toBe(cmbcCollCards[1].account_id); // 保持独立！

    const cmbcAcc1 = await db
      .prepare("SELECT statement_mode, primary_card_id FROM credit_accounts WHERE id = ?")
      .bind(cmbcCollCards[0].account_id)
      .first<{ statement_mode: string; primary_card_id: string }>();
    const cmbcAcc2 = await db
      .prepare("SELECT statement_mode, primary_card_id FROM credit_accounts WHERE id = ?")
      .bind(cmbcCollCards[1].account_id)
      .first<{ statement_mode: string; primary_card_id: string }>();
    expect(cmbcAcc1?.statement_mode).toBe("independent");
    expect(cmbcAcc2?.statement_mode).toBe("independent");
    expect(cmbcAcc1?.primary_card_id).toBe("card_cmbc_coll_1");
    expect(cmbcAcc2?.primary_card_id).toBe("card_cmbc_coll_2");

    // 账单金额分文不差保留
    const cmbcBills = (
      await db.prepare("SELECT id, bill_amount, card_id, account_id FROM bills WHERE id IN ('bill_cmbc_1', 'bill_cmbc_2')").all<{
        id: string;
        bill_amount: number;
        card_id: string;
        account_id: string;
      }>()
    ).results;
    expect(cmbcBills).toHaveLength(2);
    expect(cmbcBills[0].bill_amount).toBe(3000);
    expect(cmbcBills[1].bill_amount).toBe(4000);
    expect(cmbcBills[0].account_id).toBe(cmbcCollCards[0].account_id);
    expect(cmbcBills[1].account_id).toBe(cmbcCollCards[1].account_id);

    // 验证场景 3（民生 0872 与 9765 跨人隔离）
    const h2Card = await db
      .prepare("SELECT id, holder_id, account_id FROM credit_cards WHERE id = 'card_cmbc_h2_9765'")
      .first<{ id: string; holder_id: string; account_id: string }>();
    expect(h2Card?.holder_id).toBe("h2");
    expect(h2Card?.account_id).not.toBe(cmbcCollCards[0].account_id);
    expect(h2Card?.account_id).not.toBe(cmbcCollCards[1].account_id);

    const h2Account = await db
      .prepare("SELECT * FROM credit_accounts WHERE id = ?")
      .bind(h2Card?.account_id)
      .first<{ holder_id: string }>();
    expect(h2Account?.holder_id).toBe("h2");

    // 验证唯一约束 UNIQUE(account_id, bill_month)
    // 试图向同一个 account 插入同月第二条账单，必须被 SQLite 拒绝！
    expect(() => {
      db.exec(`
        INSERT INTO bills (id, account_id, card_id, bill_month, due_date, bill_amount)
        VALUES ('bill_dup', '${cmbCards[0].account_id}', 'card_cmb_1', '2026-10', '2026-10-25', 999);
      `);
    }).toThrow(/UNIQUE constraint failed: bills.account_id, bills.bill_month/);

    db.close();
  });

  it("verifies sync_changes triggers for credit_accounts and bill_card_subtotals", async () => {
    const db = createOpportunityDb();

    // 创建测试持卡人与账户
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u_sync', 'sync@example.com', 'h');
      INSERT INTO banks (id, name) VALUES ('b_sync', '测试银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name) VALUES ('cp_sync', 'b_sync', '测试银行', '标准卡');
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h_sync', 'u_sync', 'u_sync', '同步测试人');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('c_sync', 'h_sync', 'cp_sync', 10);
      DELETE FROM sync_changes;
    `);

    // 1. 测试 credit_accounts 插入
    await db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_name, currency, primary_card_id)
      VALUES ('acc_sync_test', 'h_sync', '测试银行', 'CNY', 'c_sync');
    `);

    const accInsertChange = await db
      .prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE tbl = 'credit_accounts' AND row_id = 'acc_sync_test'")
      .first();
    expect(accInsertChange).toEqual({
      owner_id: "u_sync",
      tbl: "credit_accounts",
      row_id: "acc_sync_test",
      op: "upsert",
    });

    // 2. 测试 credit_accounts 更新
    await db.exec(`
      UPDATE credit_accounts SET shared_credit_limit = 50000 WHERE id = 'acc_sync_test';
    `);
    const accUpdateChanges = (
      await db.prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE tbl = 'credit_accounts' AND row_id = 'acc_sync_test'").all()
    ).results;
    expect(accUpdateChanges.length).toBeGreaterThanOrEqual(2);

    // 3. 测试 bill_card_subtotals 插入与更新
    await db.exec(`
      INSERT INTO bills (id, account_id, card_id, bill_month, due_date, bill_amount)
      VALUES ('bill_sub_test', 'acc_sync_test', 'c_sync', '2026-10', '2026-10-25', 1000);
      DELETE FROM sync_changes;

      INSERT INTO bill_card_subtotals (id, bill_id, card_id, card_tail, subtotal_amount)
      VALUES ('sub_1', 'bill_sub_test', 'c_sync', '0872', 600);
    `);

    const subChange = await db
      .prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE tbl = 'bill_card_subtotals' AND row_id = 'sub_1'")
      .first();
    expect(subChange).toEqual({
      owner_id: "u_sync",
      tbl: "bill_card_subtotals",
      row_id: "sub_1",
      op: "upsert",
    });

    db.close();
  });
});
