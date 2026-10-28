import { getDb } from "@/lib/db";

export const AUTH_FAILURE_LIMIT = 5;
export const AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;

async function bucketKey(request: Request, email: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const normalizedEmail = email.trim().toLowerCase().slice(0, 320);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}\n${normalizedEmail}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordRateLimitRetryAfter(
  request: Request,
  email: string,
): Promise<number | null> {
  const key = await bucketKey(request, email);
  const now = Math.floor(Date.now() / 1000);
  // 原子占位递增：放行判定与计数在同一条语句内，消掉「先查后写」的 TOCTOU 竞态。
  // 窗口过期自动重置为 1；返回值即本次递增后的失败次数。
  const row = await getDb()
    .prepare(
      `INSERT INTO auth_login_attempts (bucket_key, failure_count, window_expires_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         failure_count = CASE
           WHEN auth_login_attempts.window_expires_at <= excluded.updated_at THEN 1
           ELSE auth_login_attempts.failure_count + 1 END,
         window_expires_at = CASE
           WHEN auth_login_attempts.window_expires_at <= excluded.updated_at THEN excluded.window_expires_at
           ELSE auth_login_attempts.window_expires_at END,
         updated_at = excluded.updated_at
       RETURNING failure_count, window_expires_at`,
    )
    .bind(key, now + AUTH_FAILURE_WINDOW_SECONDS, now)
    .first<{ failure_count: number; window_expires_at: number }>();
  if (!row || row.failure_count <= AUTH_FAILURE_LIMIT) return null;
  return Math.max(1, row.window_expires_at - now);
}

export async function clearPasswordFailures(request: Request, email: string): Promise<void> {
  await getDb()
    .prepare("DELETE FROM auth_login_attempts WHERE bucket_key = ?")
    .bind(await bucketKey(request, email))
    .run();
}
