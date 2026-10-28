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
import { encryptToken } from "../gmail/token-crypto";

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
      .prepare("INSERT INTO users (id, email, password_hash) VALUES ('u_ios_gmail', 'ios@example.com', 'x')")
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
    expect((await disconnectHandler(new Request(`${base}/disconnect`, { method: "POST" }))).status).toBe(401);
  });

  it("status 未连接时返回 fail-safe 形状", async () => {
    const res = await statusHandler(
      new Request("https://app.all-bill.com/api/gmail/status", authed()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false, email: null, status: null,
      last_sync_at: null, last_sync_summary: null, last_error: null,
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
      new Request("https://app.all-bill.com/api/gmail/connect", authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("serverAuthCode");
  });

  it("connect 坏授权码走 token_exchange 失败路径", async () => {
    // 注入 fetch：Google 对坏 code 返回 400，路由应透传 token_exchange 而不是打真实网络
    __setGmailConnectDeps((async () => new Response("invalid_grant", { status: 400 })) as typeof fetch);
    const res = await connectHandler(
      new Request("https://app.all-bill.com/api/gmail/connect", authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverAuthCode: "4/0bad-code" }),
      })),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("token");
    // 失败不落库
    const rows = await db.prepare("SELECT COUNT(*) c FROM gmail_connections").first<{ c: number }>();
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
