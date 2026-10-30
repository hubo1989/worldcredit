// lib/refresh-tokens.server.ts — refresh token 的签发、校验、轮换与吊销。
//
// 设计：token 原文是 256-bit 随机值的 base64url，只在下发响应里出现一次；
// 库里只存 SHA-256 哈希。每次 refresh 一次性轮换（旧的立即吊销 + 签发新的），
// 防止旧 token 被重放。有效期 180 天，远长于 access token 的 7 天滑动窗口。

import { getDb } from "@/lib/db";

export const REFRESH_TOKEN_TTL_DAYS = 180;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000;

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function expiryDate(now = Date.now()): string {
  return new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();
}

export interface IssuedRefreshToken {
  /** 下发给客户端的原文，仅此一次 */
  token: string;
  id: string;
}

/** 为用户签发一个新 refresh token（不吊销其他在用 token，多设备并存）。 */
export async function issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(raw)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      "INSERT INTO session_refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, userId, await hashToken(token), expiryDate(), now)
    .run();
  return { token, id };
}

export interface RefreshResult {
  ok: boolean;
  userId?: string;
  /** ok 时为轮换出的新 token 原文 */
  rotatedToken?: string;
  reason?: "invalid" | "expired";
}

/** 校验并一次性轮换：旧 token 命中即吊销，成功时返回新 token。 */
export async function rotateRefreshToken(token: string): Promise<RefreshResult> {
  if (!token) return { ok: false, reason: "invalid" };
  const hash = await hashToken(token);
  const db = getDb();
  const row = await db
    .prepare(
      "SELECT id, user_id, expires_at FROM session_refresh_tokens WHERE token_hash = ?",
    )
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string }>();
  if (!row) return { ok: false, reason: "invalid" };

  const nowIso = new Date().toISOString();
  // 一次性轮换：无论后续判断如何，命中即删除，旧 token 不可二次使用。
  await db.prepare("DELETE FROM session_refresh_tokens WHERE id = ?").bind(row.id).run();

  if (row.expires_at <= nowIso) return { ok: false, reason: "expired" };

  const next = await issueRefreshToken(row.user_id);
  await db
    .prepare("UPDATE session_refresh_tokens SET last_used_at = ? WHERE id = ?")
    .bind(nowIso, next.id)
    .run();
  return { ok: true, userId: row.user_id, rotatedToken: next.token };
}

/** 吊销用户全部 refresh token（登出/改密时调用）。 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await getDb()
    .prepare("DELETE FROM session_refresh_tokens WHERE user_id = ?")
    .bind(userId)
    .run();
}
