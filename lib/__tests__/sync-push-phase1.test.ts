import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { setDb, setWorkerEnv } from "../db/client";
import { createSessionValue, type SessionUser } from "../session";
import { ADMIN_EMAILS } from "../admin-emails";
import { POST as pushHandler } from "../../app/api/sync/push/route";
import { POST as pullHandler } from "../../app/api/sync/pull/route";

interface MutationResult {
  id: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
  permanent?: boolean;
  already_processed?: boolean;
}

describe("Phase 1 /api/sync/push OFFLINE_SYNC_MUTATIONS expansion", () => {
  let db: SqliteD1;
  let memberToken: string;
  let otherMemberToken: string;
  let adminToken: string;

  const memberUser: SessionUser = {
    id: "u-member-a",
    email: "member-a@example.test",
    name: "Member A",
    role: "member",
    created_at: "2026-10-01T00:00:00Z",
  };

  const otherMemberUser: SessionUser = {
    id: "u-member-b",
    email: "member-b@example.test",
    name: "Member B",
    role: "member",
    created_at: "2026-10-01T00:00:00Z",
  };

  const adminUser: SessionUser = {
    id: "u-admin",
    email: ADMIN_EMAILS[0],
    name: "Admin",
    role: "admin",
    created_at: "2026-10-01T00:00:00Z",
  };

  beforeAll(async () => {
    setWorkerEnv({ SESSION_SECRET: "sync-push-phase1-test-secret-16chars" });
    memberToken = await createSessionValue(memberUser);
    otherMemberToken = await createSessionValue(otherMemberUser);
    adminToken = await createSessionValue(adminUser);
  });

  beforeEach(() => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);
    db.exec(`
      INSERT INTO users (id, email, password_hash, role) VALUES
        ('u-member-a', 'member-a@example.test', 'hash', 'member'),
        ('u-member-b', 'member-b@example.test', 'hash', 'member'),
        ('u-admin', '${ADMIN_EMAILS[0]}', 'hash', 'admin');
      INSERT INTO banks (id, name) VALUES ('bank-1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
        VALUES ('cp-1', 'bank-1', '招商银行', '经典白', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
        ('holder-a', 'u-member-a', 'u-member-a', '本人A', 'u-member-a'),
        ('holder-b', 'u-member-b', 'u-member-b', '本人B', 'u-member-b');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES
        ('card-a', 'holder-a', 'cp-1', 5),
        ('card-b', 'holder-b', 'cp-1', 10);
      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status) VALUES
        ('bill-a', 'card-a', '2026-10', '2026-10-25', 1000, 'unpaid'),
        ('bill-b', 'card-b', '2026-10', '2026-10-28', 2000, 'unpaid');
      INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key) VALUES
        ('pay-a', 'bill-a', 1000, '2026-10-20', '自动还款', '全额', 'pay-a-key'),
        ('pay-b', 'bill-b', 500, '2026-10-20', '手动还款', NULL, 'pay-b-key');
      UPDATE bills SET status = 'paid' WHERE id = 'bill-a';
      UPDATE bills SET status = 'partial' WHERE id = 'bill-b';
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id) VALUES
        ('payable-a', 'u-member-a', '房租A', 'rent', 3000, 'CNY', 5, 'holder-a'),
        ('payable-b', 'u-member-b', '房租B', 'rent', 4000, 'CNY', 10, 'holder-b');
      INSERT INTO notification_history (id, user_id, notification_key, category, title, body, sent_at, status) VALUES
        ('notif-a1', 'u-member-a', 'key-a1', 'bill_due', '账单提醒1', '内容1', '2026-10-20T09:00:00Z', 'sent'),
        ('notif-a2', 'u-member-a', 'key-a2', 'bill_due', '账单提醒2', '内容2', '2026-10-21T09:00:00Z', 'sent'),
        ('notif-b1', 'u-member-b', 'key-b1', 'bill_due', 'B账单提醒', '内容B', '2026-10-21T09:00:00Z', 'sent');
    `);
  });

  afterEach(() => {
    setDb(null);
    db.close();
  });

  async function push(
    mutations: Array<{ id: string; name: string; args: unknown[] }>,
    authToken = memberToken,
    clientId = "ios_phase1_client"
  ): Promise<MutationResult[]> {
    const res = await pushHandler(
      new Request("https://app.all-bill.com/api/sync/push", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ client_id: clientId, mutations }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: MutationResult[] };
    return body.results;
  }

  async function pullSince(cursor: number, authToken = memberToken) {
    const res = await pullHandler(
      new Request("https://app.all-bill.com/api/sync/pull", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ cursor }),
      })
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      cursor: number;
      changes: Array<{ tbl: string; row_id: string; op: string; row?: Record<string, unknown> }>;
    };
  }

  it("supports bills.updateBillFields & bills.clearOverride with member isolation and pull sync", async () => {
    const startCursor = (await pullSince(0)).cursor;

    const [updated] = await push([
      {
        id: "mut-bill-fields-1",
        name: "bills.updateBillFields",
        args: [
          "bill-a",
          {
            amount: 1500,
            min_payment: 150,
            due_date: "2026-10-29",
            statement_date: "2026-10-06",
            statement_start: "2026-09-07",
            statement_end: "2026-10-06",
          },
        ],
      },
    ]);
    expect(updated.ok).toBe(true);

    const rowAfterUpdate = db.raw
      .prepare(
        "SELECT bill_amount, bill_amount_override, min_payment_override, due_date_override, statement_date_override, status FROM bills WHERE id = 'bill-a'"
      )
      .get() as Record<string, unknown>;
    expect(rowAfterUpdate).toEqual({
      bill_amount: 1000,
      bill_amount_override: 1500,
      min_payment_override: 150,
      due_date_override: "2026-10-29",
      statement_date_override: "2026-10-06",
      status: "partial", // 1000 paid < 1500 override -> recalculated
    });

    // Cross-user bill update must fail closed (403 -> permanent: true)
    const [forbiddenUpdate] = await push([
      {
        id: "mut-bill-fields-forbid",
        name: "bills.updateBillFields",
        args: ["bill-b", { amount: 1 }],
      },
    ]);
    expect(forbiddenUpdate).toMatchObject({
      ok: false,
      permanent: true,
    });
    expect(forbiddenUpdate.error).toContain("无权访问");

    // Clear override restores status to paid since 1000 >= 1000
    const [cleared] = await push([
      {
        id: "mut-bill-clear-1",
        name: "bills.clearOverride",
        args: ["bill-a", ["amount", "due_date"]],
      },
    ]);
    expect(cleared.ok).toBe(true);

    const rowAfterClear = db.raw
      .prepare(
        "SELECT bill_amount_override, min_payment_override, due_date_override, status FROM bills WHERE id = 'bill-a'"
      )
      .get() as Record<string, unknown>;
    expect(rowAfterClear).toEqual({
      bill_amount_override: null,
      min_payment_override: 150,
      due_date_override: null,
      status: "paid",
    });

    // Forbidden clearOverride
    const [forbiddenClear] = await push([
      {
        id: "mut-bill-clear-forbid",
        name: "bills.clearOverride",
        args: ["bill-b", ["amount"]],
      },
    ]);
    expect(forbiddenClear).toMatchObject({ ok: false, permanent: true });

    // Validation error is cached as permanent
    const [invalidDate] = await push([
      {
        id: "mut-bill-bad-date",
        name: "bills.updateBillFields",
        args: ["bill-a", { due_date: "2026-02-30" }],
      },
    ]);
    expect(invalidDate).toMatchObject({
      ok: false,
      permanent: true,
      code: "VALIDATION_FAILED",
    });

    const pulled = await pullSince(startCursor);
    expect(pulled.changes.some((c) => c.tbl === "bills" && c.row_id === "bill-a")).toBe(true);
  });

  it("supports payments.updatePayment with overpayment guard, member isolation, and bill recalc", async () => {
    const startCursor = (await pullSince(0)).cursor;

    // Lower payment from 1000 to 400 -> bill-a status must revert from paid to partial
    const [okRes] = await push([
      {
        id: "mut-pay-update-1",
        name: "payments.updatePayment",
        args: ["pay-a", { amount: 400, note: "修正金额" }],
      },
    ]);
    expect(okRes.ok).toBe(true);
    expect(db.raw.prepare("SELECT status FROM bills WHERE id = 'bill-a'").get()).toEqual({
      status: "partial",
    });

    // Overpayment attempt -> CONFLICT -> permanent: true
    const [overpay] = await push([
      {
        id: "mut-pay-overpay",
        name: "payments.updatePayment",
        args: ["pay-a", { amount: 1500 }],
      },
    ]);
    expect(overpay).toMatchObject({
      ok: false,
      permanent: true,
      code: "CONFLICT",
    });

    // Member cannot edit another member's payment
    const [forbidden] = await push([
      {
        id: "mut-pay-forbid",
        name: "payments.updatePayment",
        args: ["pay-b", { amount: 100 }],
      },
    ]);
    expect(forbidden).toMatchObject({ ok: false, permanent: true });
    expect(forbidden.error).toContain("无权访问");

    const pulled = await pullSince(startCursor);
    expect(pulled.changes.some((c) => c.tbl === "payments" && c.row_id === "pay-a")).toBe(true);
    expect(pulled.changes.some((c) => c.tbl === "bills" && c.row_id === "bill-a")).toBe(true);
  });

  it("supports payables.createRecurringPayable with server-bound created_by, holder guard, and mutation dedup", async () => {
    const startCursor = (await pullSince(0)).cursor;

    // Spoofed created_by must be overwritten by session.id; server generates UUID id
    const [created] = await push([
      {
        id: "mut-payable-create-1",
        name: "payables.createRecurringPayable",
        args: [
          {
            id: "client-temp-id-ignored",
            created_by: "u-member-b",
            name: "车位租金",
            category: "rent",
            amount: 800,
            currency: "CNY",
            due_day: 15,
            holder_id: "holder-a",
          },
        ],
      },
    ]);
    expect(created.ok).toBe(true);
    expect(created.data?.created_by).toBe("u-member-a");
    expect(typeof created.data?.id).toBe("string");
    expect(created.data?.id).not.toBe("client-temp-id-ignored");

    // Replaying exact same mutation_id deduplicates via sync_mutations
    const [replayed] = await push([
      {
        id: "mut-payable-create-1",
        name: "payables.createRecurringPayable",
        args: [
          {
            created_by: "u-member-b",
            name: "车位租金",
            category: "rent",
            amount: 800,
            currency: "CNY",
            due_day: 15,
            holder_id: "holder-a",
          },
        ],
      },
    ]);
    expect(replayed.ok).toBe(true);
    expect(replayed.already_processed).toBe(true);
    expect(replayed.data?.id).toBe(created.data?.id);
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM recurring_payables WHERE name = '车位租金'")
        .get()
    ).toEqual({ n: 1 });

    // Member referencing another user's holder_id must fail closed
    const [forbiddenHolder] = await push([
      {
        id: "mut-payable-forbid-holder",
        name: "payables.createRecurringPayable",
        args: [
          {
            created_by: "u-member-a",
            name: "越权支出",
            category: "other",
            amount: 100,
            currency: "CNY",
            due_day: 5,
            holder_id: "holder-b",
          },
        ],
      },
    ]);
    expect(forbiddenHolder).toMatchObject({ ok: false, permanent: true });
    expect(forbiddenHolder.error).toContain("无权访问");

    const pulled = await pullSince(startCursor);
    expect(
      pulled.changes.some(
        (c) => c.tbl === "recurring_payables" && c.row_id === created.data?.id
      )
    ).toBe(true);
  });

  it("supports payables.updateRecurringPayable with owner guard", async () => {
    const startCursor = (await pullSince(0)).cursor;

    const [updated] = await push([
      {
        id: "mut-payable-update-1",
        name: "payables.updateRecurringPayable",
        args: ["payable-a", { amount: 3500, note: "涨租" }],
      },
    ]);
    expect(updated.ok).toBe(true);
    expect(updated.data?.amount).toBe(3500);

    // Member cannot update another user's payable
    const [forbidden] = await push([
      {
        id: "mut-payable-update-forbid",
        name: "payables.updateRecurringPayable",
        args: ["payable-b", { amount: 1 }],
      },
    ]);
    expect(forbidden).toMatchObject({ ok: false, permanent: true });
    expect(forbidden.error).toContain("无权访问");

    // Admin updating missing payable returns NOT_FOUND permanent failure
    const [missing] = await push(
      [
        {
          id: "mut-payable-missing",
          name: "payables.updateRecurringPayable",
          args: ["payable-missing", { amount: 100 }],
        },
      ],
      adminToken
    );
    expect(missing).toMatchObject({
      ok: false,
      permanent: true,
      code: "NOT_FOUND",
    });

    const pulled = await pullSince(startCursor);
    expect(
      pulled.changes.some((c) => c.tbl === "recurring_payables" && c.row_id === "payable-a")
    ).toBe(true);
  });

  it("supports notifications.markNotificationRead & markAllNotificationsRead with session bindUser", async () => {
    // Spoofed args[0] = 'u-member-b' must be overwritten with session.id ('u-member-a')
    const [oneRes] = await push([
      {
        id: "mut-notif-read-1",
        name: "notifications.markNotificationRead",
        args: ["u-member-b", "notif-a1"],
      },
    ]);
    expect(oneRes).toMatchObject({
      ok: true,
      data: { updated: true, unread_count: 1 },
    });

    // Attempting to mark u-member-b's notification must NOT mutate it
    const [crossUser] = await push([
      {
        id: "mut-notif-cross",
        name: "notifications.markNotificationRead",
        args: ["u-member-b", "notif-b1"],
      },
    ]);
    expect(crossUser).toMatchObject({
      ok: true,
      data: { updated: false, unread_count: 1 },
    });
    expect(
      db.raw.prepare("SELECT read_at FROM notification_history WHERE id = 'notif-b1'").get()
    ).toEqual({ read_at: null });

    // markAllNotificationsRead with spoofed userId only marks u-member-a's remaining unread
    const [allRes] = await push([
      {
        id: "mut-notif-read-all",
        name: "notifications.markAllNotificationsRead",
        args: ["u-member-b"],
      },
    ]);
    expect(allRes).toMatchObject({
      ok: true,
      data: { updated_count: 1, unread_count: 0 },
    });
    expect(
      db.raw.prepare("SELECT read_at FROM notification_history WHERE id = 'notif-b1'").get()
    ).toEqual({ read_at: null });
  });

  it("supports preferences.updateUserPreferences with bindUser and sync/pull reflection", async () => {
    const startCursor = (await pullSince(0)).cursor;

    const [prefRes] = await push([
      {
        id: "mut-pref-1",
        name: "preferences.updateUserPreferences",
        args: [
          "u-member-b",
          {
            display_config: { privacy_mode: true, default_currency: "USD" },
            reminder_config: { remind_days_before: [7, 3, 1] },
          },
        ],
      },
    ]);
    expect(prefRes.ok).toBe(true);
    expect(prefRes.data?.user_id).toBe("u-member-a");

    // Other user's preferences remain absent
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM user_preferences WHERE user_id = 'u-member-b'")
        .get()
    ).toEqual({ n: 0 });

    const pulled = await pullSince(startCursor);
    expect(
      pulled.changes.some(
        (c) => c.tbl === "user_preferences" && c.row_id === "u-member-a"
      )
    ).toBe(true);

    // Verify other member's pull does NOT receive u-member-a's preference row
    const otherPulled = await pullSince(0, otherMemberToken);
    expect(
      otherPulled.changes.some(
        (c) => c.tbl === "user_preferences" && c.row_id === "u-member-a"
      )
    ).toBe(false);
  });

  it("keeps non-allowlisted mutations permanently rejected", async () => {
    const [res] = await push(
      [
        {
          id: "mut-disallowed-delete",
          name: "bills.deleteBill",
          args: ["bill-a"],
        },
      ],
      adminToken
    );
    expect(res).toMatchObject({
      ok: false,
      permanent: true,
    });
    expect(res.error).toContain("不支持的离线同步调用");
  });
});
