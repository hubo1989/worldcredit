import { describe, it, expect } from "vitest";
import { createOpportunityDb } from "./helpers/sqlite-d1";

describe("0019_offline_sync_tables: trigger verification on full schema", () => {
  it("captures catalog insertions in sync_changes with owner_id = null", async () => {
    const db = createOpportunityDb();

    await db.exec(`
      INSERT INTO banks (id, name) VALUES ('b_test', '测试银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp_test', 'b_test', '测试银行', '测试金卡', 'after_billing', 20);
    `);

    const changes = (
      await db.prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes ORDER BY seq").all()
    ).results;

    expect(changes).toEqual([
      { owner_id: null, tbl: "banks", row_id: "b_test", op: "upsert" },
      { owner_id: null, tbl: "card_products", row_id: "cp_test", op: "upsert" },
    ]);
    db.close();
  });

  it("captures user chain insertions and direct deletions with owner_id = managed_by", async () => {
    const db = createOpportunityDb();

    // 1. Setup user
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u_admin', 'admin@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp1', 'b1', '招商银行', '经典白', 'after_billing', 20);
    `);

    // Clear initial sync_changes from setup
    await db.exec("DELETE FROM sync_changes;");

    // 2. Insert holder, card, bill, payment
    await db.exec(`
      INSERT INTO card_holders (id, created_by, managed_by, name)
      VALUES ('h1', 'u_admin', 'u_admin', '持卡人甲');

      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day)
      VALUES ('cc1', 'h1', 'cp1', 5);

      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount)
      VALUES ('bill1', 'cc1', '2026-10-01', '2026-10-25', 1000);

      INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
      VALUES ('pay1', 'bill1', 1000, '2026-10-20', 'key_pay1');
    `);

    const changes = (
      await db.prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes ORDER BY seq").all()
    ).results;

    expect(changes).toEqual([
      { owner_id: "u_admin", tbl: "card_holders", row_id: "h1", op: "upsert" },
      { owner_id: "u_admin", tbl: "credit_cards", row_id: "cc1", op: "upsert" },
      { owner_id: "u_admin", tbl: "bills", row_id: "bill1", op: "upsert" },
      { owner_id: "u_admin", tbl: "payments", row_id: "pay1", op: "upsert" },
    ]);

    // 3. Direct delete of payment
    await db.exec("DELETE FROM payments WHERE id = 'pay1';");

    const latestChange = await db
      .prepare("SELECT owner_id, tbl, row_id, op FROM sync_changes ORDER BY seq DESC LIMIT 1")
      .first();

    expect(latestChange).toEqual({
      owner_id: "u_admin",
      tbl: "payments",
      row_id: "pay1",
      op: "delete",
    });

    db.close();
  });

  it("supports device_tokens and sync_mutations tables", async () => {
    const db = createOpportunityDb();

    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO device_tokens (id, user_id, platform, token, app_version)
      VALUES ('d1', 'u1', 'ios', 'apns_token_xyz', '1.0.0');

      INSERT INTO sync_mutations (client_id, mutation_id, result)
      VALUES ('client_abc', 'mut_1', '{"ok":true}');
    `);

    const token = await db.prepare("SELECT * FROM device_tokens WHERE id = ?").bind("d1").first();
    const mut = await db
      .prepare("SELECT * FROM sync_mutations WHERE mutation_id = ?")
      .bind("mut_1")
      .first();

    expect(token).toMatchObject({ platform: "ios", token: "apns_token_xyz" });
    expect(mut).toMatchObject({ client_id: "client_abc", result: '{"ok":true}' });

    db.close();
  });

  it("captures delete changes for descendant rows when a parent is cascade-deleted", async () => {
    const db = createOpportunityDb();
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u_cascade', 'cascade@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b_cascade', '测试银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name) VALUES ('cp_cascade', 'b_cascade', '测试银行', '测试卡');
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h_cascade', 'u_cascade', 'u_cascade', '甲');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc_cascade', 'h_cascade', 'cp_cascade', 5);
      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount) VALUES ('bill_cascade', 'cc_cascade', '2026-10', '2026-10-25', 500);
      INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('pay_cascade', 'bill_cascade', 200, '2026-10-20', 'cascade_key');
      INSERT INTO recurring_payables (id, created_by, name, amount, due_day) VALUES ('rp_cascade', 'u_cascade', '房租', 3000, 10);
      INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at) VALUES ('rpp_cascade', 'rp_cascade', '2026-10', 3000, '2026-10-10');
      DELETE FROM sync_changes;
      DELETE FROM card_holders WHERE id = 'h_cascade';
      DELETE FROM recurring_payables WHERE id = 'rp_cascade';
    `);
    const deleted = (
      await db
        .prepare(
          "SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE op = 'delete' ORDER BY seq",
        )
        .all()
    ).results;
    expect(deleted).toEqual(
      expect.arrayContaining([
        { owner_id: "u_cascade", tbl: "payments", row_id: "pay_cascade", op: "delete" },
        { owner_id: "u_cascade", tbl: "bills", row_id: "bill_cascade", op: "delete" },
        { owner_id: "u_cascade", tbl: "credit_cards", row_id: "cc_cascade", op: "delete" },
        { owner_id: "u_cascade", tbl: "card_holders", row_id: "h_cascade", op: "delete" },
        {
          owner_id: "u_cascade",
          tbl: "recurring_payable_payments",
          row_id: "rpp_cascade",
          op: "delete",
        },
        { owner_id: "u_cascade", tbl: "recurring_payables", row_id: "rp_cascade", op: "delete" },
      ]),
    );
    db.close();
  });
});
