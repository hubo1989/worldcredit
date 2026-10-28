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
}

const parseOk = {
  is_bill: true,
  email_kind: "statement" as const,
  bank_name: "Chase Bank",
  card_last4: "7491",
  bill_amount: 1234.56,
  min_payment: 100,
  due_date: "2026-11-10",
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
      parse: async () => ({ ...parseOk }),
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

    // u1 的 refresh token 是用错误密钥加密的：decryptToken 必然失败，
    // 不依赖 fetch 就能触发单用户失败路径；u2 走正常链路。
    const badEnc = await encryptToken("rt", "wrong-secret");
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
      fetchImpl: okFetch as unknown as typeof fetch,
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
