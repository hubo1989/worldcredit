import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb, setWorkerEnv } from "../db/client";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { POST as refreshEndpoint } from "../../app/api/auth/refresh/route";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
} from "../refresh-tokens.server";

let db: SqliteD1;

beforeAll(() => {
  setWorkerEnv({ SESSION_SECRET: "test-password-auth-session-secret" });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);
  await db
    .prepare("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)")
    .bind("u-refresh", "r@example.test", "x", "R", "member", "2026-10-01T00:00:00Z")
    .run();
});

function refreshRequest(token: string, ip = "203.0.113.10") {
  return new Request("https://app.all-bill.com/api/auth/refresh", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: JSON.stringify({ refresh_token: token }),
  });
}

describe("refresh token rotation", () => {
  it("rotates one-shot: the old token cannot be used twice", async () => {
    const first = await issueRefreshToken("u-refresh");
    const second = await rotateRefreshToken(first.token);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.rotatedToken).toBeTruthy();

    const replay = await rotateRefreshToken(first.token);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("replayed");
  });

  it("replay of a rotated token revokes every token of that user", async () => {
    const victim = await issueRefreshToken("u-refresh");
    const attacker = await issueRefreshToken("u-refresh"); // 另一台设备
    const rotated = await rotateRefreshToken(victim.token);
    expect(rotated.ok).toBe(true);

    // 被盗的旧 token 重放 → 墓碑命中 → 全量吊销（含攻击者设备的新 token）
    const replay = await rotateRefreshToken(victim.token);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("replayed");

    const afterReplay = await rotateRefreshToken(attacker.token);
    expect(afterReplay.ok).toBe(false);
    const afterRotated = await rotateRefreshToken(rotated.ok ? rotated.rotatedToken! : "");
    expect(afterRotated.ok).toBe(false);
  });

  it("issues a fresh access token and user via the endpoint", async () => {
    const issued = await issueRefreshToken("u-refresh");
    const res = await refreshEndpoint(refreshRequest(issued.token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { id: string }; refresh_token: string };
    expect(body.user.id).toBe("u-refresh");
    expect(body.token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(issued.token);
  });

  it("rejects unknown tokens with 401 and no-leak wording", async () => {
    const res = await refreshEndpoint(refreshRequest("nonexistent"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("无效或已过期");
  });

  it("rate-limits repeated attempts from one IP", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await refreshEndpoint(refreshRequest("noise-" + i));
      expect(res.status).toBe(401);
    }
    const limited = await refreshEndpoint(refreshRequest("noise-final"));
    expect(limited.status).toBe(429);
  });

  it("revoked user cannot refresh anymore", async () => {
    const issued = await issueRefreshToken("u-refresh");
    await revokeAllRefreshTokens("u-refresh");
    const res = await refreshEndpoint(refreshRequest(issued.token));
    expect(res.status).toBe(401);
  });
});
