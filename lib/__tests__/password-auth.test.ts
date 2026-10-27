import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb, setWorkerEnv } from "../db/client";
import { pbkdf2Hash, pbkdf2Verify } from "../auth-crypto";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { POST as tokenLogin } from "../../app/api/auth/token/route";
import { POST as cookieLogin } from "../../app/api/auth/login/route";

let db: SqliteD1;

beforeAll(() => {
  setWorkerEnv({ SESSION_SECRET: "test-password-auth-session-secret" });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);
  const hash = await pbkdf2Hash("correct-password");
  await db
    .prepare("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)")
    .bind("auth-user", "member@example.test", hash, "Member", "member", "2026-10-01T00:00:00Z")
    .run();
});

function tokenRequest(email: string, password: string) {
  return new Request("https://app.all-bill.com/api/auth/token", {
    method: "POST",
    body: JSON.stringify({ grant_type: "password", email, password }),
  });
}

function cookieRequest(email: string, password: string) {
  return new Request("https://app.all-bill.com/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

describe("password authentication", () => {
  it("does not reveal whether a token-login email exists", async () => {
    const missing = await tokenLogin(tokenRequest("missing@example.test", "wrong-password"));
    const wrong = await tokenLogin(tokenRequest("member@example.test", "wrong-password"));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expect(wrong.headers.get("Cache-Control")).toBe("no-store");
  });

  it("runs the same PBKDF2 work for a missing email and a wrong password", async () => {
    const verify = vi.spyOn(await import("../auth-crypto"), "pbkdf2Verify");
    await tokenLogin(tokenRequest("missing@example.test", "wrong-password"));
    await tokenLogin(tokenRequest("member@example.test", "wrong-password"));
    expect(verify).toHaveBeenCalledTimes(2);
    const storedHashes = verify.mock.calls.map((call) => call[1]);
    expect(storedHashes[0]).toMatch(/^pbkdf2\$100000\$/);
    expect(storedHashes[0]).not.toBe(storedHashes[1]);
    expect(storedHashes[1]).toMatch(/^pbkdf2\$100000\$/);
    expect(await pbkdf2Verify("correct-password", storedHashes[0])).toBe(false);
  });

  it("keeps valid password login working and prevents browser caching of token responses", async () => {
    const response = await tokenLogin(tokenRequest("member@example.test", "correct-password"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      token_type: "Bearer",
      user: { id: "auth-user" },
    });
  });

  it("applies the same generic rejection to the cookie login endpoint", async () => {
    const missing = await cookieLogin(cookieRequest("missing@example.test", "wrong-password"));
    const wrong = await cookieLogin(cookieRequest("member@example.test", "wrong-password"));
    expect(await missing.json()).toEqual(await wrong.json());
  });

  it("limits repeated password failures without identifying whether the account exists", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await tokenLogin(tokenRequest("missing@example.test", "wrong-password"));
      expect(response.status, `attempt ${attempt}`).toBe(401);
    }
    const blocked = await tokenLogin(tokenRequest("missing@example.test", "wrong-password"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    const blockedKnownAccount = await tokenLogin(
      tokenRequest("member@example.test", "wrong-password"),
    );
    expect(blockedKnownAccount.status).toBe(401);
  });

  it("caps concurrent password attempts at the failure limit", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => tokenLogin(tokenRequest("burst@example.test", "wrong"))),
    );
    const statuses = attempts.map((r) => r.status).sort();
    // Exactly five attempts reach verification; the rest are rejected as rate-limited.
    expect(statuses.filter((s) => s === 401).length).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBe(3);
    const blocked = await tokenLogin(tokenRequest("burst@example.test", "wrong"));
    expect(blocked.status).toBe(429);
  });

  it("clears the failure window after a successful password login", async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await tokenLogin(tokenRequest("member@example.test", "wrong-password"))).status).toBe(
        401,
      );
    }
    expect((await tokenLogin(tokenRequest("member@example.test", "correct-password"))).status).toBe(
      200,
    );
    expect((await tokenLogin(tokenRequest("member@example.test", "correct-password"))).status).toBe(
      200,
    );
  });

  it("forwards Google nonce and tolerates concurrent first-time Google user creation", async () => {
    process.env.GOOGLE_CLIENT_ID = "web-client-id";
    const googleMod = await import("../google-id-token");
    const verifySpy = vi.spyOn(googleMod, "verifyGoogleIdToken").mockResolvedValue({
      ok: true,
      identity: { email: "new-google@example.test", name: "Google User", sub: "google-sub-1" },
    });

    const prepare = db.prepare.bind(db);
    let seenSelects = 0;
    let releaseSelects: (() => void) | undefined;
    const bothMissed = new Promise<void>((resolve) => {
      releaseSelects = resolve;
    });
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (sql.startsWith("SELECT id, email, name") && sql.includes("FROM users WHERE email = ?")) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...values: unknown[]) => {
          const bound = bind(...values);
          const first = bound.first.bind(bound);
          bound.first = async <T = Record<string, unknown>>() => {
            const row = await first<T>();
            seenSelects++;
            if (seenSelects >= 2) releaseSelects?.();
            if (seenSelects <= 2 && row === null) await bothMissed;
            return row;
          };
          return bound;
        };
      }
      return statement;
    });

    const req = () =>
      new Request("https://app.all-bill.com/api/auth/token", {
        method: "POST",
        body: JSON.stringify({ grant_type: "google", id_token: "id-tok", nonce: "nonce-123" }),
      });
    const [r1, r2] = await Promise.all([tokenLogin(req()), tokenLogin(req())]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(verifySpy).toHaveBeenCalledWith("id-tok", {
      clientId: ["web-client-id"],
      nonce: "nonce-123",
    });
    const [b1, b2] = (await Promise.all([r1.json(), r2.json()])) as Array<{
      user: { id: string };
      expires_in: number;
    }>;
    expect(b1.user.id).toBe(b2.user.id);
    const { SESSION_TTL_SECONDS } = await import("../session");
    expect(b1.expires_in).toBe(SESSION_TTL_SECONDS);
  });
});
