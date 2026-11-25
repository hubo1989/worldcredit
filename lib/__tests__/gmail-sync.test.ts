// lib/__tests__/gmail-sync.test.ts — Gmail 拉取同步引擎的真实 SQLite 回归。
//
// 路由口径与 email-worker 必须一致（共用 lib/email-core）：字段齐 + 持卡人/
// 卡命中 → 直接落账单；认不出人或卡对不上 → 预填草稿。这里锁的是：
//   1) 证据足够时直接落账单并记去重行
//   2) 无持卡人时停草稿（source_type=email）
//   3) 同一封邮件二次同步不重复处理
//   4) 非账单邮件记 skipped 且不建账单
//   5) syncAllGmailConnections 单用户失败不影响其他用户
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setDb, setWorkerEnv } from "../db/client";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { encryptToken } from "../gmail/token-crypto";
import { syncUserGmail, syncAllGmailConnections, __setGmailSyncDeps } from "../gmail/sync.server";

let db: SqliteD1;

const SECRET = "test-gmail-sync-secret";

const RAW_EML = new TextEncoder().encode(
  "From: statements@chase.example\r\nTo: Hubo <hubo@example.com>\r\nSubject: Your statement\r\nDate: Wed, 28 Oct 2026 09:00:00 +0000\r\n\r\n尊敬的Hubo先生，本期应还 1234.56",
);

function toRawB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function gmailFetch(handlers: { list: unknown; raw: unknown; token?: unknown }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/token")) {
      return new Response(
        JSON.stringify(handlers.token ?? { access_token: "at", expires_in: 3600 }),
      );
    }
    if (url.includes("/messages?")) return new Response(JSON.stringify(handlers.list));
    return new Response(JSON.stringify(handlers.raw));
  });
}

async function seedUser(id: string) {
  await db
    .prepare("INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "x", "U", "2026-10-01T00:00:00Z")
    .run();
}

async function seedConnection(userId: string) {
  const enc = await encryptToken("rt-1", SECRET);
  await db
    .prepare(
      "INSERT INTO gmail_connections (user_id,google_sub,email,refresh_token_enc,scopes,status) VALUES (?,?,?,?,?,?)",
    )
    .bind(userId, `sub-${userId}`, `${userId}@example.test`, enc, "gmail.readonly", "active")
    .run();
}

async function seedHolderAndProduct() {
  await db
    .prepare(
      "INSERT INTO card_holders (id,created_by,managed_by,name,created_at) VALUES (?,?,?,?,?)",
    )
    .bind("h1", "u1", "u1", "Hubo", "2026-10-01T00:00:00Z")
    .run();
  await db
    .prepare(
      "INSERT INTO card_products (id,bank_name,card_name,currency,created_at) VALUES (?,?,?,?,?)",
    )
    .bind("p1", "Chase Bank", "Sapphire", "USD", "2026-10-01T00:00:00Z")
    .run();
  await db.prepare(
    "INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, card_number_last4) VALUES ('c1', 'h1', 'p1', 16, '7491')",
  ).run();
}

const parseOk = {
  is_bill: true,
  email_kind: "statement" as const,
  bank_name: "Chase Bank",
  card_last4: "7491",
  bill_amount: 1234.56,
  min_payment: 100,
  due_date: "2026-11-10",
  due_date_status: "exact" as const,
  bill_month: "2026-10",
  statement_date: "2026-10-16",
  currency: "USD",
  confidence: 0.95,
};

beforeAll(() => {
  setWorkerEnv({
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "cs",
  });
});

beforeEach(async () => {
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);
  await seedUser("u1");
  await seedConnection("u1");
});

afterEach(() => {
  __setGmailSyncDeps(null);
  setDb(null);
  db.close();
});

describe("syncUserGmail", () => {
  it("证据足够时直接落账单，并记录去重行", async () => {
    await seedHolderAndProduct();
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk, items: [
        { description: "Dinner", amount: 50, transaction_date: "2026-10-15" },
        { description: "Refund", amount: -9, currency: "HKD" },
      ] }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m1", threadId: "t1" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m1" },
      }) as unknown as typeof fetch,
      bucket: null,
    });

    const summary = await syncUserGmail("u1");
    expect(summary.written).toBe(1);
    const bill = await db.prepare("SELECT * FROM bills").all();
    expect(bill.results.length).toBe(1);
    const msg = await db
      .prepare("SELECT * FROM gmail_sync_messages WHERE gmail_message_id='m1'")
      .first<{ status: string }>();
    expect(msg?.status).toBe("bill_written");
    await expect(syncUserGmail("u1")).resolves.toMatchObject({ written: 0, drafted: 0 });
    expect(db.raw.prepare(
      "SELECT description, amount, currency, item_type, source FROM bill_items ORDER BY description",
    ).all()).toEqual([
      { description: "Dinner", amount: 50, currency: "USD", item_type: "purchase", source: "email" },
      { description: "Refund", amount: 9, currency: "HKD", item_type: "refund", source: "email" },
    ]);
  });

  it("证据不足（识别不出持卡人）时停草稿", async () => {
    // 不建持卡人 → resolveHolder 无从归属 → 预填草稿
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m2", threadId: "t2" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m2" },
      }) as unknown as typeof fetch,
      bucket: null,
    });

    const summary = await syncUserGmail("u1");
    expect(summary.drafted).toBe(1);
    const draft = await db
      .prepare("SELECT * FROM bill_import_drafts")
      .first<{ status: string; source_type: string }>();
    expect(draft?.source_type).toBe("email");
    const msg = await db
      .prepare("SELECT * FROM gmail_sync_messages WHERE gmail_message_id='m2'")
      .first<{ status: string }>();
    expect(msg?.status).toBe("draft_parked");
  });

  it("同一封邮件第二次同步不重复处理", async () => {
    await seedHolderAndProduct();
    const fetchImpl = gmailFetch({
      list: { messages: [{ id: "m3" }] },
      raw: { raw: toRawB64(RAW_EML), id: "m3" },
    });
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      bucket: null,
    });

    await syncUserGmail("u1");
    const second = await syncUserGmail("u1");
    expect(second.scanned).toBe(1);
    expect(second.written + second.drafted + second.skipped + second.failed).toBe(0);
    const bills = await db.prepare("SELECT COUNT(*) c FROM bills").first<{ c: number }>();
    expect(bills?.c).toBe(1);
  });

  it("failed 行不挡去重：重试成功后原地覆盖为 bill_written", async () => {
    await seedHolderAndProduct();
    // 预置一条 failed 记录（模拟子请求超限这类瞬态失败）
    await db
      .prepare(
        "INSERT INTO gmail_sync_messages (gmail_message_id, user_id, status, error_msg) VALUES (?,?, 'failed', ?)",
      )
      .bind("m-retry", "u1", "Too many subrequests")
      .run();
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m-retry" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m-retry" },
      }) as unknown as typeof fetch,
      bucket: null,
    });

    const summary = await syncUserGmail("u1");
    expect(summary.written).toBe(1);
    // 原地覆盖：仍是 1 行，状态已改写
    const cnt = await db
      .prepare("SELECT COUNT(*) c FROM gmail_sync_messages WHERE gmail_message_id='m-retry'")
      .first<{ c: number }>();
    expect(cnt?.c).toBe(1);
    const msg = await db
      .prepare("SELECT status FROM gmail_sync_messages WHERE gmail_message_id='m-retry'")
      .first<{ status: string }>();
    expect(msg?.status).toBe("bill_written");

  });

  it("重试再败：failed 行原地更新错误信息，不插新行", async () => {
    __setGmailSyncDeps({
      parse: async () => {
        throw new Error("AI timeout");
      },
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m-retry2" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m-retry2" },
      }) as unknown as typeof fetch,
      bucket: null,
    });
    await db
      .prepare(
        "INSERT INTO gmail_sync_messages (gmail_message_id, user_id, status, error_msg) VALUES (?,?, 'failed', ?)",
      )
      .bind("m-retry2", "u1", "Too many subrequests")
      .run();

    const summary = await syncUserGmail("u1");
    expect(summary.failed).toBe(1);
    const row = await db
      .prepare("SELECT COUNT(*) c, MAX(error_msg) e FROM gmail_sync_messages WHERE gmail_message_id='m-retry2'")
      .first<{ c: number; e: string }>();
    expect(row?.c).toBe(1);
    expect(row?.e).toContain("AI timeout");
  });

  it("maxMessages 分批：单轮只处理 N 封并报 remaining，续轮跑完", async () => {
    await seedHolderAndProduct();
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({
        list: {
          messages: [
            { id: "m5", threadId: "t5" },
            { id: "m6", threadId: "t6" },
            { id: "m7", threadId: "t7" },
          ],
        },
        raw: { raw: toRawB64(RAW_EML), id: "x" },
      }) as unknown as typeof fetch,
      bucket: null,
    });

    const first = await syncUserGmail("u1", { maxMessages: 2 });
    expect(first.scanned).toBe(3);
    expect(first.written).toBe(2);
    expect(first.remaining).toBe(1);

    const second = await syncUserGmail("u1", { maxMessages: 2 });
    expect(second.written).toBe(1);
    expect(second.remaining).toBe(0);

    const rows = await db
      .prepare("SELECT COUNT(*) c FROM gmail_sync_messages")
      .first<{ c: number }>();
    expect(rows?.c).toBe(3);
  });

  it("非账单邮件记 skipped 且不建账单", async () => {
    __setGmailSyncDeps({
      parse: async () => ({ is_bill: false, email_kind: "other" }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m4" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m4" },
      }) as unknown as typeof fetch,
      bucket: null,
    });
    const summary = await syncUserGmail("u1");
    expect(summary.skipped).toBe(1);
    const bills = await db.prepare("SELECT COUNT(*) c FROM bills").first<{ c: number }>();
    expect(bills?.c).toBe(0);
  });

  it("未连接或连接停用时抛错，不产生任何写入", async () => {
    await db.prepare("UPDATE gmail_connections SET status='revoked' WHERE user_id='u1'").run();
    await expect(syncUserGmail("u1")).rejects.toThrow(/未连接|停用/);
  });
});

describe("syncAllGmailConnections", () => {
  it.each([429, 503])("keeps a mailbox active after a transient list failure (%s) and retries it", async (status) => {
    let shouldFail = true;
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      sessionSecret: SECRET,
      bucket: null,
      fetchImpl: async input => {
        if (String(input).includes("/token")) return Response.json({ access_token: "at", expires_in: 3600 });
        const response = shouldFail ? Response.json({ error: "temporary" }, { status }) : Response.json({});
        shouldFail = false;
        return response;
      },
    });
    const connection = () => db.raw.prepare("SELECT status, last_error FROM gmail_connections WHERE user_id = 'u1'").get();
    await expect(syncAllGmailConnections()).resolves.toEqual({ users: 1, failures: 1 });
    expect(connection()).toEqual({ status: "active", last_error: `Gmail API error (${status})` });
    await expect(syncAllGmailConnections()).resolves.toEqual({ users: 1, failures: 0 });
    expect(connection()).toEqual({ status: "active", last_error: null });
  });

  it("单用户失败被隔离：u1 置 error，u2 仍被处理", async () => {
    await seedUser("u2");
    await seedConnection("u2");
    await seedHolderAndProduct();
    await db
      .prepare(
        "INSERT INTO card_holders (id,created_by,managed_by,name,created_at) VALUES (?,?,?,?,?)",
      )
      .bind("h2", "u2", "u2", "Hubo", "2026-10-02T00:00:00Z")
      .run();

    await db.prepare(
      "INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, card_number_last4) VALUES ('c2', 'h2', 'p1', 16, '7491')",
    ).run();

    // Google confirms that u1 revoked consent. u2 still uses the normal path.
    const badEnc = await encryptToken("revoked", SECRET);
    await db
      .prepare("UPDATE gmail_connections SET refresh_token_enc=? WHERE user_id='u1'")
      .bind(badEnc)
      .run();
    const okFetch = gmailFetch({
      list: { messages: [{ id: "u2m1" }] },
      raw: { raw: toRawB64(RAW_EML), id: "u2m1" },
    });
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: (input, init) => {
        if (String(input).includes("/token") && String(init?.body).includes("refresh_token=revoked")) {
          return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
        }
        return okFetch(input);
      },
      sessionSecret: SECRET,
      bucket: null,
    });

    const result = await syncAllGmailConnections();
    expect(result.users).toBe(2);
    expect(result.failures).toBe(1);
    const u1 = await db
      .prepare("SELECT status,last_error FROM gmail_connections WHERE user_id='u1'")
      .first<{ status: string; last_error: string }>();
    expect(u1?.status).toBe("error");
    expect(u1?.last_error).toBeTruthy();
    const u2 = await db
      .prepare("SELECT status FROM gmail_connections WHERE user_id='u2'")
      .first<{ status: string }>();
    expect(u2?.status).toBe("active");
    const u2msg = await db
      .prepare("SELECT status FROM gmail_sync_messages WHERE gmail_message_id='u2m1'")
      .first<{ status: string }>();
    expect(u2msg?.status).toBe("bill_written");
  });

  it("每日账单 cron（0 9）挂载了 Gmail 拉取，且不在 */15 权益扫描分支里", () => {
    // 挂载点在 worker/index.ts 的 route === "bills" 分支（worker/cron.ts 内部有
    // 「无订阅/无账单即 return」的提前退出，插在 cron.ts 尾部会被静默跳过）。
    const src = readFileSync(join(__dirname, "../../worker/index.ts"), "utf8");
    expect(src).toMatch(/import \{ syncAllGmailConnections \}/);
    const billsBranch = src.split('route === "bills"')[1]?.split("return;")[0] ?? "";
    expect(billsBranch).toContain("syncAllGmailConnections");
  });
});

describe("multi-mailbox scheduling and posting gates", () => {
  const scopedMail = (rfc: string | null, recipient = "Gmail <box@example.test>") => new TextEncoder().encode([
    "From: statements@chase.example", `To: ${recipient}`, "Subject: Your statement",
    ...(rfc ? [`Message-ID: <${rfc}>`] : []), "", "This month's statement",
  ].join("\r\n"));

  async function seedMailbox(id: string, owner = "u1", holder: string | null = null, enabled = 1) {
    const ciphertext = await encryptToken(id, SECRET);
    await db.prepare(
      `INSERT INTO gmail_connections (id, user_id, google_sub, email, refresh_token_enc, scopes, default_holder_id, sync_enabled)
       VALUES (?, ?, ?, ?, ?, 'gmail.readonly', ?, ?)`,
    ).bind(id, owner, id, `${id}@example.test`, ciphertext, holder, enabled).run();
  }

  function mailboxes(
    accounts: Record<string, { id: string; raw: Uint8Array }>,
  ) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token")) {
        const account = (init?.body as URLSearchParams).get("refresh_token");
        return Response.json({ access_token: account, expires_in: 3600 });
      }
      const account = new Headers(init?.headers).get("Authorization")?.slice("Bearer ".length) ?? "";
      const item = accounts[account];
      if (!item) return new Response(null, { status: 401 });
      return url.includes("/messages?")
        ? Response.json({ messages: [{ id: item.id }] })
        : Response.json({ raw: toRawB64(item.raw) });
    });
  }

  it("claims a forwarded RFC Message-ID once across concurrently syncing connections", async () => {
    await db.exec("DELETE FROM gmail_connections");
    await seedMailbox("box-a");
    await seedMailbox("box-b");
    const parse = vi.fn(async () => ({ ...parseOk }));
    const put = vi.fn(async (_key: string, _value: Uint8Array) => {});
    __setGmailSyncDeps({
      parse, bucket: { put } as unknown as R2Bucket,
      fetchImpl: mailboxes({
        "box-a": { id: "a-message", raw: scopedMail("Statement@Bank.Example") },
        "box-b": { id: "b-message", raw: scopedMail("statement@bank.example") },
      }),
    });
    const summaries = await Promise.all([
      syncUserGmail("u1", { connectionId: "box-a" }),
      syncUserGmail("u1", { connectionId: "box-b" }),
    ]);
    expect(summaries.reduce((count, summary) => count + summary.drafted, 0)).toBe(1);
    expect(parse).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]).toEqual([
      expect.stringMatching(/^gmail-raw\/u1\/box-[ab]\/[ab]-message\.eml$/), expect.any(Uint8Array),
    ]);
    const retry = await syncAllGmailConnections();
    expect(retry).toEqual({ users: 1, failures: 0 });
    expect(parse).toHaveBeenCalledOnce();
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM bill_import_drafts").get()).toEqual({ count: 1 });
    expect(db.raw.prepare("SELECT status FROM gmail_sync_messages ORDER BY status").all())
      .toEqual([{ status: "draft_parked" }, { status: "skipped" }]);
  });

  it("isolates IDs by owner, maps the connection default, and ignores paused mailboxes", async () => {
    await db.exec("DELETE FROM gmail_connections");
    await seedUser("u2");
    await db.exec(`INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', 'Alice Lee')`);
    await seedMailbox("primary", "u1", "h1");
    await seedMailbox("second", "u1");
    await seedMailbox("paused", "u1", null, 0);
    await seedMailbox("foreign", "u2");
    const fetchImpl = mailboxes({
      primary: { id: "shared-id", raw: scopedMail("same@bank.test") },
      second: { id: "distinct", raw: scopedMail(null) },
      foreign: { id: "shared-id", raw: scopedMail("same@bank.test") },
    });
    const parse = vi.fn(async () => ({ ...parseOk }));
    __setGmailSyncDeps({ parse, fetchImpl, bucket: null });
    await expect(syncUserGmail("u1", { connectionId: "foreign" })).rejects.toThrow("未连接");
    await expect(syncUserGmail("u1", { connectionId: "paused" })).rejects.toThrow("未连接");
    await expect(syncAllGmailConnections()).resolves.toEqual({ users: 2, failures: 0 });
    expect(parse).toHaveBeenCalledTimes(3);
    expect(db.raw.prepare(
      "SELECT user_id, connection_id, gmail_message_id FROM gmail_sync_messages ORDER BY connection_id",
    ).all()).toEqual([
      { user_id: "u2", connection_id: "foreign", gmail_message_id: "shared-id" },
      { user_id: "u1", connection_id: "primary", gmail_message_id: "shared-id" },
      { user_id: "u1", connection_id: "second", gmail_message_id: "distinct" },
    ]);
    expect(db.raw.prepare(
      "SELECT holder_id, attribution_source, attribution_trusted FROM bill_import_drafts WHERE source_connection_id='primary'",
    ).get()).toEqual({ holder_id: "h1", attribution_source: "connection_default", attribution_trusted: 1 });
    expect(db.raw.prepare("SELECT last_sync_at FROM gmail_connections WHERE id='paused'").get())
      .toEqual({ last_sync_at: null });
  });

  it("parks each unsafe statement and does not add a credit card", async () => {
    await seedHolderAndProduct();
    const raw = scopedMail(null, "Hubo <hubo@example.test>");
    let parsed = { ...parseOk };
    const run = (id: string) => {
      __setGmailSyncDeps({
        parse: async () => parsed, bucket: null,
        fetchImpl: gmailFetch({ list: { messages: [{ id }] }, raw: { raw: toRawB64(raw) } }),
      });
      return syncUserGmail("u1");
    };
    parsed = { ...parseOk, confidence: 0.62 };
    expect((await run("low-confidence")).drafted).toBe(1);
    parsed = { ...parseOk, due_date: "2026-02-30" };
    expect((await run("missing-due")).drafted).toBe(1);
    parsed = { ...parseOk, card_last4: "9910" };
    expect((await run("new-card")).drafted).toBe(1);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM bills").get()).toEqual({ count: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM credit_cards").get()).toEqual({ count: 1 });
  });

  it("protects paid state and amount overrides even when the incoming parse is high-confidence", async () => {
    await seedHolderAndProduct();
    db.exec(`INSERT INTO bills (id, card_id, bill_month, bill_amount, bill_amount_override, due_date, status)
      VALUES ('posted', 'c1', '2026-10', 1234.56, 1234.56, '2026-11-10', 'paid')`);
    const raw = scopedMail(null);
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk, bill_amount: 2000 }), bucket: null,
      fetchImpl: gmailFetch({ list: { messages: [{ id: "conflict" }] }, raw: { raw: toRawB64(raw) } }),
    });
    expect((await syncUserGmail("u1")).drafted).toBe(1);
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }), bucket: null,
      fetchImpl: gmailFetch({ list: { messages: [{ id: "safe-replay" }] }, raw: { raw: toRawB64(raw) } }),
    });
    expect((await syncUserGmail("u1")).written).toBe(1);
    expect(db.raw.prepare("SELECT id, bill_amount, bill_amount_override, status FROM bills").all())
      .toEqual([{ id: "posted", bill_amount: 1234.56, bill_amount_override: 1234.56, status: "paid" }]);
  });

  it("parks an unresolved shared card tail with both candidates", async () => {
    await seedHolderAndProduct();
    db.exec(`INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h2', 'u1', 'u1', 'Jiang Li');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, card_number_last4) VALUES ('c2', 'h2', 'p1', 16, '7491')`);
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }), bucket: null,
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "ambiguous" }] },
        raw: { raw: toRawB64(scopedMail(null)) },
      }),
    });
    expect((await syncUserGmail("u1")).drafted).toBe(1);
    expect(db.raw.prepare(
      "SELECT card_id, attribution_source, json_extract(parsed_payload, '$.candidate_card_ids') AS candidates FROM bill_import_drafts",
    ).get()).toEqual({ card_id: null, attribution_source: "conflict", candidates: '["c1","c2"]' });
  });
});
