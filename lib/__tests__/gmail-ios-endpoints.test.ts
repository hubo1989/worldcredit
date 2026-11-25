// lib/__tests__/gmail-ios-endpoints.test.ts — iOS 专用 Bearer 端点的契约回归。
// Web 走 /api/rpc/gmail/*（session cookie），iOS 走 /api/gmail/*（Authorization:
// Bearer <session token>，与 api/sync/* 同款）。锁的是：
//   1) 未带凭据一律 401
//   2) status 返回连接形状（未连接 fail-safe）
//   3) connect 缺 serverAuthCode 400；坏 code 走 token_exchange 失败路径
//   4) sync 未连接时把引擎错误透传成 400
//   5) disconnect 幂等
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createOpportunityDb } from "./helpers/sqlite-d1";
import { setDb, setWorkerEnv } from "../db/client";
import { createSessionValue, type SessionUser } from "../session";
import { __setGmailSyncDeps } from "../gmail/sync.server";
import { __setGmailConnectDeps } from "../gmail/connect.server";
import { GET as statusHandler } from "../../app/api/gmail/status/route";
import { POST as connectHandler } from "../../app/api/gmail/connect/route";
import { POST as syncHandler } from "../../app/api/gmail/sync/route";
import { POST as disconnectHandler } from "../../app/api/gmail/disconnect/route";
import { GET as connectionsHandler } from "../../app/api/gmail/connections/route";
import { PATCH as connectionPatchHandler } from "../../app/api/gmail/connections/[id]/route";
import { encryptToken } from "../gmail/token-crypto";
import { ensureHub156Schema } from "./helpers/hub156-schema";
import { MemberScopeError } from "../api/member-scope";
import {
  getGmailConnections,
  updateGmailConnection,
  syncGmailConnection,
  disconnectGmailConnection,
  applyGmailConnectionDefaults,
} from "../api/gmail.server";

const SECRET = "test-gmail-ios-endpoints-secret";

const mockUser: SessionUser = {
  id: "u_ios_gmail",
  email: "ios@example.com",
  name: "iOS User",
  role: "member",
  created_at: "2026-10-28T00:00:00Z",
};

describe("iOS /api/gmail/* endpoints", () => {
  let db: ReturnType<typeof createOpportunityDb>;
  let token: string;

  const authed = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });

  beforeAll(async () => {
    setWorkerEnv({ SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs" });
    token = await createSessionValue(mockUser);
  });

  beforeEach(async () => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);
    await db
      .prepare(
        "INSERT INTO users (id, email, password_hash) VALUES ('u_ios_gmail', 'ios@example.com', 'x')",
      )
      .run();
  });

  afterEach(() => {
    __setGmailSyncDeps(null);
    __setGmailConnectDeps(null);
    setDb(null);
    db.close();
  });

  it("未带凭据四个端点全部 401", async () => {
    const base = "https://app.all-bill.com/api/gmail";
    expect((await statusHandler(new Request(`${base}/status`))).status).toBe(401);
    expect(
      (await connectHandler(new Request(`${base}/connect`, { method: "POST", body: "{}" }))).status,
    ).toBe(401);
    expect((await syncHandler(new Request(`${base}/sync`, { method: "POST" }))).status).toBe(401);
    expect(
      (await disconnectHandler(new Request(`${base}/disconnect`, { method: "POST" }))).status,
    ).toBe(401);
  });

  it("status 未连接时返回 fail-safe 形状", async () => {
    const res = await statusHandler(
      new Request("https://app.all-bill.com/api/gmail/status", authed()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      email: null,
      status: null,
      last_sync_at: null,
      last_sync_summary: null,
      last_error: null,
    });
  });

  it("status 已连接时返回邮箱与状态", async () => {
    const enc = await encryptToken("rt-ios", SECRET);
    await db
      .prepare(
        "INSERT INTO gmail_connections (user_id, google_sub, email, refresh_token_enc, scopes) VALUES (?,?,?,?,?)",
      )
      .bind("u_ios_gmail", "sub-ios", "ios@example.com", enc, "gmail.readonly")
      .run();
    const res = await statusHandler(
      new Request("https://app.all-bill.com/api/gmail/status", authed()),
    );
    const body = (await res.json()) as { connected: boolean; email: string };
    expect(body.connected).toBe(true);
    expect(body.email).toBe("ios@example.com");
  });

  it("connect 缺 serverAuthCode 400", async () => {
    const res = await connectHandler(
      new Request(
        "https://app.all-bill.com/api/gmail/connect",
        authed({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("serverAuthCode");
  });

  it("connect 坏授权码走 token_exchange 失败路径", async () => {
    // 注入 fetch：Google 对坏 code 返回 400，路由应透传 token_exchange 而不是打真实网络
    __setGmailConnectDeps(
      (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch,
    );
    const res = await connectHandler(
      new Request(
        "https://app.all-bill.com/api/gmail/connect",
        authed({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverAuthCode: "4/0bad-code" }),
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("token");
    // 失败不落库
    const rows = await db
      .prepare("SELECT COUNT(*) c FROM gmail_connections")
      .first<{ c: number }>();
    expect(rows?.c).toBe(0);
  });

  it("sync 未连接时透传引擎错误（400）", async () => {
    const res = await syncHandler(
      new Request("https://app.all-bill.com/api/gmail/sync", authed({ method: "POST" })),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("未连接");
  });

  it("disconnect 幂等：无连接也返回 ok", async () => {
    const res = await disconnectHandler(
      new Request("https://app.all-bill.com/api/gmail/disconnect", authed({ method: "POST" })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ─── HUB-156：多邮箱连接（HUB-154 §3.3(3) / AC-05）──────────────────────────
//
// 兼容红线：上面 7 个用例锁的是「单连接 6 字段」形状，一个字段都不能变。
// 下面锁的是多连接新增面：列表、改映射、按 connectionId 同步/断开、越权 403、
// 以及单用户 10 条上限。

describe("多 Gmail 连接（HUB-156）", () => {
  let db: ReturnType<typeof createOpportunityDb>;
  let token: string;

  const authed = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });

  beforeAll(async () => {
    setWorkerEnv({ SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs" });
    token = await createSessionValue(mockUser);
  });

  beforeEach(async () => {
    db = createOpportunityDb();
    ensureHub156Schema(db);
    setDb(db as unknown as D1Database);
    await db
      .prepare(
        "INSERT INTO users (id, email, password_hash) VALUES ('u_ios_gmail', 'ios@example.com', 'x')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO users (id, email, password_hash) VALUES ('u_other', 'other@example.com', 'x')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES ('h_ios', 'u_ios_gmail', 'u_ios_gmail', '我', 'u_ios_gmail')",
      )
      .run();
  });

  afterEach(() => {
    __setGmailSyncDeps(null);
    __setGmailConnectDeps(null);
    setDb(null);
    db.close();
  });

  async function seedConnection(
    id: string,
    userId: string,
    email: string,
    overrides: { sync_enabled?: number; status?: string } = {},
  ) {
    const enc = await encryptToken("rt-" + id, SECRET);
    await db
      .prepare(
        `INSERT INTO gmail_connections
           (id, user_id, google_sub, email, refresh_token_enc, scopes, sync_enabled, status)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        userId,
        "sub-" + id,
        email,
        enc,
        "gmail.readonly",
        overrides.sync_enabled ?? 1,
        overrides.status ?? "active",
      )
      .run();
  }

  it("GET /api/gmail/connections 返回多连接并按创建时间升序", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    await seedConnection("gconn_b", "u_ios_gmail", "b@example.com");
    const res = await connectionsHandler(
      new Request("https://app.all-bill.com/api/gmail/connections", authed()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; email: string }> };
    expect(body.data.map(item => item.id)).toEqual(["gconn_a", "gconn_b"]);
    expect(body.data[0].email).toBe("a@example.com");
  });

  it("PATCH 支持改备注 / 默认持卡人 / 同步开关", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    const res = await connectionPatchHandler(
      new Request("https://app.all-bill.com/api/gmail/connections/gconn_a", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          display_label: "老婆的卡",
          default_holder_id: "h_ios",
          sync_enabled: false,
        }),
      }),
      { params: Promise.resolve({ id: "gconn_a" }) },
    );
    expect(res.status).toBe(200);
    const updated = (await getGmailConnections("u_ios_gmail"))[0];
    expect(updated.display_label).toBe("老婆的卡");
    expect(updated.default_holder_id).toBe("h_ios");
    expect(updated.sync_enabled).toBe(false);
  });

  it("越权改他人连接 → 403（不区分「不存在」）", async () => {
    await seedConnection("gconn_other", "u_other", "other@example.com");
    await expect(
      updateGmailConnection("gconn_other", { display_label: "劫持" }, "u_ios_gmail"),
    ).rejects.toBeInstanceOf(MemberScopeError);
    await expect(
      updateGmailConnection("no-such-id", { display_label: "x" }, "u_ios_gmail"),
    ).rejects.toBeInstanceOf(MemberScopeError);
  });

  it("按 connectionId 断开只删该邮箱，其它连接与其 R2 前缀不受影响", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    await seedConnection("gconn_b", "u_ios_gmail", "b@example.com");
    const result = await disconnectGmailConnection("gconn_a", "u_ios_gmail");
    expect(result.ok).toBe(true);
    const left = await getGmailConnections("u_ios_gmail");
    expect(left.map(item => item.id)).toEqual(["gconn_b"]);
    await expect(disconnectGmailConnection("gconn_b", "u_other")).rejects.toBeInstanceOf(MemberScopeError);
  });

  it("sync 传 connectionId 只同步该邮箱；不传则同步全部 active + enabled", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    await seedConnection("gconn_b", "u_ios_gmail", "b@example.com");
    await seedConnection("gconn_c", "u_ios_gmail", "c@example.com", { sync_enabled: 0 });
    __setGmailSyncDeps({ parse: async () => ({ is_bill: false }) });

    const single = await syncGmailConnection({ connectionId: "gconn_b" }, "u_ios_gmail");
    expect(single.connections.map(item => item.id)).toEqual(["gconn_b"]);

    const all = await syncGmailConnection({}, "u_ios_gmail");
    expect(all.connections.map(item => item.id)).toEqual(["gconn_a", "gconn_b"]);
    // 关了同步开关的邮箱不进同步集合
    const skipped = all.connections.find(item => item.id === "gconn_c");
    expect(skipped).toBeUndefined();
  });

  it("连接建立后按 defaultHolderId / displayLabel 补写映射", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    await applyGmailConnectionDefaults("u_ios_gmail", {
      defaultHolderId: "h_ios",
      displayLabel: "工资卡",
    });
    const [connection] = await getGmailConnections("u_ios_gmail");
    expect(connection.default_holder_id).toBe("h_ios");
    expect(connection.display_label).toBe("工资卡");
  });

  it("连接数达到 10 条后拒绝继续绑定", async () => {
    for (let i = 0; i < 10; i++) {
      await seedConnection(`gconn_${i}`, "u_ios_gmail", `user${i}@example.com`);
    }
    __setGmailConnectDeps((async () => new Response("{}", { status: 200 })) as typeof fetch);
    const res = await connectHandler(
      new Request("https://app.all-bill.com/api/gmail/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ serverAuthCode: "code-2" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("10");
  });

  it("单连接 6 字段兼容形状不受多连接影响", async () => {
    await seedConnection("gconn_a", "u_ios_gmail", "a@example.com");
    const res = await statusHandler(
      new Request("https://app.all-bill.com/api/gmail/status", authed()),
    );
    expect(Object.keys(await res.json()).sort()).toEqual(
      ["connected", "email", "last_error", "last_sync_at", "last_sync_summary", "status"].sort(),
    );
  });
});

// ─── HUB-158 QA 返工 P1-2 / P1-3 回归 ───────────────────────────────────
// P1-2：批量同步时每轮必须锁定本轮连接，OAuth 替身记录 refresh_token 以确认
//        A、B 各用各的授权（修复前两次都落到最老的 A 上）。
// P1-3：解绑 A 必须清掉新旧格式 raw_r2_key 与对应 R2 对象，且绝不动 B。
describe("HUB-158 QA 返工 P1-2/P1-3", () => {
  let db: ReturnType<typeof createOpportunityDb>;
  let seenRefreshTokens: string[];
  let deletedKeys: string[];
  let objects: Map<string, Uint8Array>;

  const trackingBucket = () => ({
    async delete(key: string) {
      objects.delete(key);
      deletedKeys.push(key);
    },
    async list(opts: { prefix?: string; cursor?: string } = {}) {
      const keys = [...objects.keys()].filter(key => !opts.prefix || key.startsWith(opts.prefix));
      return { objects: keys.map(key => ({ key })), truncated: false };
    },
  });

  async function seedConn(id: string, userId: string, email: string) {
    const enc = await encryptToken("rt-" + id, SECRET);
    await db
      .prepare(
        `INSERT INTO gmail_connections
           (id, user_id, google_sub, email, refresh_token_enc, scopes, sync_enabled, status)
         VALUES (?,?,?,?,?,?,1,'active')`,
      )
      .bind(id, userId, "sub-" + id, email, enc, "gmail.readonly")
      .run();
  }

  beforeEach(async () => {
    db = createOpportunityDb();
    ensureHub156Schema(db);
    setDb(db as unknown as D1Database);
    await db
      .prepare(
        "INSERT INTO users (id, email, password_hash) VALUES ('u_ios_gmail', 'ios@example.com', 'x')",
      )
      .run();
    seenRefreshTokens = [];
    deletedKeys = [];
    objects = new Map();
    setWorkerEnv({
      SESSION_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "cs",
      ATTACHMENTS: trackingBucket(),
    });
  });

  afterEach(() => {
    __setGmailSyncDeps(null);
    __setGmailConnectDeps(null);
    setWorkerEnv({ SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs" });
    setDb(null);
    db.close();
  });

  it("P1-2 批量同步 A、B 各使用自己的 OAuth 授权（不再重复用 A）", async () => {
    await seedConn("gconn_a", "u_ios_gmail", "a@example.com");
    await seedConn("gconn_b", "u_ios_gmail", "b@example.com");

    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        const params = new URLSearchParams(String(init?.body ?? ""));
        seenRefreshTokens.push(params.get("refresh_token") ?? "");
        return Response.json({ access_token: "at", expires_in: 3600 });
      }
      return Response.json({ messages: [] });
    }) as unknown as typeof fetch;

    __setGmailSyncDeps({
      parse: async () => ({ is_bill: false }),
      fetchImpl,
      sessionSecret: SECRET,
    });

    const all = await syncGmailConnection({}, "u_ios_gmail");
    expect(all.connections.map(item => item.id).sort()).toEqual(["gconn_a", "gconn_b"]);
    // 修复前为 ['rt-gconn_a','rt-gconn_a']；修复后两条连接各用各的 refresh token。
    expect(seenRefreshTokens).toHaveLength(2);
    expect(seenRefreshTokens.slice().sort()).toEqual(["rt-gconn_a", "rt-gconn_b"]);
  });

  it("P1-3 解绑 A 清理新旧格式 raw_r2_key 与 R2 对象，B 的记录与对象不动", async () => {
    await seedConn("gconn_a", "u_ios_gmail", "a@example.com");
    await seedConn("gconn_b", "u_ios_gmail", "b@example.com");

    const legacyA = "gmail-raw/u_ios_gmail/legacy-a.eml"; // 迁移前旧格式：无 connectionId 段
    const newA = "gmail-raw/u_ios_gmail/gconn_a/new-a.eml";
    const orphanA = "gmail-raw/u_ios_gmail/gconn_a/orphan-a.eml";
    const keyB = "gmail-raw/u_ios_gmail/gconn_b/b.eml";
    objects.set(legacyA, new Uint8Array([1]));
    objects.set(newA, new Uint8Array([2]));
    objects.set(orphanA, new Uint8Array([4]));
    objects.set(keyB, new Uint8Array([3]));

    const insert = db.prepare(
      `INSERT INTO gmail_sync_messages
         (id, connection_id, gmail_message_id, user_id, raw_r2_key, status)
       VALUES (?,?,?,?,?,?)`,
    );
    await insert.bind("m_a_legacy", "gconn_a", "gm-a1", "u_ios_gmail", legacyA, "skipped").run();
    await insert.bind("m_a_new", "gconn_a", "gm-a2", "u_ios_gmail", newA, "skipped").run();
    await insert.bind("m_b", "gconn_b", "gm-b1", "u_ios_gmail", keyB, "skipped").run();

    const result = await disconnectGmailConnection("gconn_a", "u_ios_gmail");
    expect(result.ok).toBe(true);

    // 旧格式键（不在新前缀里）与新格式键都已被删。
    expect(deletedKeys).toContain(legacyA);
    expect(deletedKeys).toContain(newA);
    expect(deletedKeys).toContain(orphanA);
    // B 的对象没被删、仍在库里。
    expect(deletedKeys).not.toContain(keyB);
    expect(objects.has(keyB)).toBe(true);

    // A 的审计引用被清空（删连接会触发 connection_id ON DELETE SET NULL，
    // 因此必须先按 connection_id 清引用再删；修复前引用会永久残留）。
    const rows = await db
      .prepare("SELECT gmail_message_id, raw_r2_key FROM gmail_sync_messages")
      .all<{ gmail_message_id: string; raw_r2_key: string | null }>();
    const byId = new Map((rows.results ?? []).map(row => [row.gmail_message_id, row.raw_r2_key]));
    expect(byId.get("gm-a1")).toBeNull();
    expect(byId.get("gm-a2")).toBeNull();
    expect(byId.get("gm-b1")).toBe(keyB);

    // 只删了 A 连接，B 仍在。
    expect((await getGmailConnections("u_ios_gmail")).map(item => item.id)).toEqual(["gconn_b"]);
  });

  it("P1-3 R2 删除失败时整体抛出，连接与引用都保留以供重试", async () => {
    await seedConn("gconn_a", "u_ios_gmail", "a@example.com");
    const keyA = "gmail-raw/u_ios_gmail/gconn_a/a.eml";
    objects.set(keyA, new Uint8Array([1]));
    await db
      .prepare(
        `INSERT INTO gmail_sync_messages
           (id, connection_id, gmail_message_id, user_id, raw_r2_key, status)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind("m_a", "gconn_a", "gm-a1", "u_ios_gmail", keyA, "skipped")
      .run();

    setWorkerEnv({
      SESSION_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "cs",
      ATTACHMENTS: {
        async delete() {
          throw new Error("R2 unavailable");
        },
        async list() {
          return { objects: [], truncated: false };
        },
      },
    });

    await expect(disconnectGmailConnection("gconn_a", "u_ios_gmail")).rejects.toThrow();
    // 连接未被删、引用未被清空，下次解绑可原样重试。
    expect((await getGmailConnections("u_ios_gmail")).map(item => item.id)).toEqual(["gconn_a"]);
    const row = await db
      .prepare("SELECT raw_r2_key FROM gmail_sync_messages WHERE id = 'm_a'")
      .first<{ raw_r2_key: string | null }>();
    expect(row?.raw_r2_key).toBe(keyA);

    setWorkerEnv({ ATTACHMENTS: trackingBucket() });
    await expect(disconnectGmailConnection("gconn_a", "u_ios_gmail"))
      .resolves.toEqual({ ok: true, id: "gconn_a" });
    expect(objects.has(keyA)).toBe(false);
    const cleaned = await db.prepare("SELECT connection_id, raw_r2_key FROM gmail_sync_messages WHERE id = 'm_a'")
      .first();
    expect(cleaned).toEqual({ connection_id: null, raw_r2_key: null });
  });
});
