import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { setDb, setWorkerEnv } from "../db/client";
import { verifySessionValue, SESSION_TTL_SECONDS, SESSION_COOKIE } from "../session";
import { ADMIN_EMAILS } from "../admin-emails";
import { POST as registerHandler } from "../../app/api/auth/register/route";
import { POST as refreshHandler } from "../../app/api/auth/refresh/route";
import { POST as pullHandler } from "../../app/api/sync/pull/route";

describe("POST /api/auth/register dual cookie and Bearer+refresh token flow", () => {
  let db: SqliteD1;

  beforeAll(() => {
    setWorkerEnv({ SESSION_SECRET: "auth-register-token-test-secret-16" });
  });

  beforeEach(() => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);
  });

  afterEach(() => {
    setDb(null);
    db.close();
  });

  function registerReq(body: Record<string, unknown>) {
    return new Request("https://app.all-bill.com/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("preserves legacy Web Cookie registration when issue_token is omitted", async () => {
    const res = await registerHandler(
      registerReq({
        email: "web-user@example.test",
        password: "strong-password-123",
        name: "Web User",
      })
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");

    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toEqual({
      user: {
        id: expect.any(String),
        email: "web-user@example.test",
        name: "Web User",
        role: "member",
        created_at: expect.any(String),
      },
    });
    expect(data.token).toBeUndefined();
    expect(data.refresh_token).toBeUndefined();

    // No refresh token row issued in DB
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM session_refresh_tokens").get()).toEqual({
      n: 0,
    });

    // Cookie session value is valid
    const cookieMatch = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    const verified = await verifySessionValue(cookieMatch?.[1]);
    expect(verified?.email).toBe("web-user@example.test");
    expect(verified?.role).toBe("member");
  });

  it("does not issue Bearer tokens for non-boolean issue_token values", async () => {
    const res = await registerHandler(
      registerReq({
        email: "string-flag@example.test",
        password: "strong-password-123",
        issue_token: "true",
      })
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.token).toBeUndefined();
    expect(data.refresh_token).toBeUndefined();
  });

  it("issues Bearer + refresh_token matching /api/auth/token when issue_token is true", async () => {
    const res = await registerHandler(
      registerReq({
        email: "ios-user@example.test",
        password: "strong-password-123",
        name: "iOS User",
        issue_token: true,
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=`);

    const data = (await res.json()) as {
      token: string;
      token_type: string;
      expires_in: number;
      user: { id: string; email: string; name: string | null; role: string; created_at: string };
      refresh_token: string;
    };

    expect(data.token_type).toBe("Bearer");
    expect(data.expires_in).toBe(SESSION_TTL_SECONDS);
    expect(data.token).toBeTruthy();
    expect(data.refresh_token).toBeTruthy();
    expect(data.user).toEqual({
      id: expect.any(String),
      email: "ios-user@example.test",
      name: "iOS User",
      role: "member",
      created_at: expect.any(String),
    });

    // Refresh token is stored hashed (never plaintext) in session_refresh_tokens
    const stored = db.raw
      .prepare("SELECT user_id, token_hash FROM session_refresh_tokens")
      .get() as { user_id: string; token_hash: string } | undefined;
    expect(stored?.user_id).toBe(data.user.id);
    expect(stored?.token_hash).not.toBe(data.refresh_token);

    // Bearer token authenticates protected sync endpoint immediately
    const pullRes = await pullHandler(
      new Request("https://app.all-bill.com/api/sync/pull", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` },
        body: JSON.stringify({ cursor: 0 }),
      })
    );
    expect(pullRes.status).toBe(200);

    // Refresh token works end-to-end with /api/auth/refresh
    const refreshRes = await refreshHandler(
      new Request("https://app.all-bill.com/api/auth/refresh", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.42" },
        body: JSON.stringify({ refresh_token: data.refresh_token }),
      })
    );
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as {
      token: string;
      refresh_token: string;
      user: { id: string };
    };
    expect(refreshed.user.id).toBe(data.user.id);
    expect(refreshed.token).toBeTruthy();
    expect(refreshed.refresh_token).not.toBe(data.refresh_token);
  });

  it("assigns admin role only for allowlisted emails and preserves validation/conflict errors", async () => {
    const adminRes = await registerHandler(
      registerReq({
        email: ADMIN_EMAILS[0],
        password: "admin-password-123",
        issue_token: true,
      })
    );
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { user: { role: string } };
    expect(adminBody.user.role).toBe("admin");

    // Duplicate email returns 409 with no-store when issue_token is true
    const dupRes = await registerHandler(
      registerReq({
        email: ADMIN_EMAILS[0],
        password: "admin-password-123",
        issue_token: true,
      })
    );
    expect(dupRes.status).toBe(409);
    expect(dupRes.headers.get("Cache-Control")).toBe("no-store");

    // Missing credentials returns 400
    const badRes = await registerHandler(
      registerReq({
        email: "missing-pw@example.test",
        issue_token: true,
      })
    );
    expect(badRes.status).toBe(400);
    expect(badRes.headers.get("Cache-Control")).toBe("no-store");
  });
});
