// POST /api/auth/refresh — App 端静默续期：refresh token 换新 access token。
// 一次性轮换：旧 refresh token 移入墓碑，响应携带新的。
// 公开入口按客户端 IP 简单限流（复用 auth_login_attempts 的窗口机制）。
import { getDb } from "@/lib/db";
import { createSessionValue, SESSION_TTL_SECONDS, type SessionUser } from "@/lib/session";
import { rotateRefreshToken } from "@/lib/refresh-tokens.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// 与 auth_login_attempts 同款 durable 窗口：每 IP 每小时至多 30 次尝试
const REFRESH_LIMIT = 30;
const REFRESH_WINDOW_SECONDS = 3600;

async function rateLimited(request: Request): Promise<boolean> {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % REFRESH_WINDOW_SECONDS);
  const bucketKey = `refresh:${ip}:${windowStart}`;
  const db = getDb();
  const row = await db
    .prepare("SELECT failure_count FROM auth_login_attempts WHERE bucket_key = ?")
    .bind(bucketKey)
    .first<{ failure_count: number }>();
  if (row && row.failure_count >= REFRESH_LIMIT) return true;
  await db
    .prepare(
      `INSERT INTO auth_login_attempts (bucket_key, failure_count, window_expires_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET failure_count = failure_count + 1, updated_at = ?`,
    )
    .bind(bucketKey, windowStart + REFRESH_WINDOW_SECONDS, now, now)
    .run();
  return false;
}

export async function POST(request: Request) {
  try {
    if (await rateLimited(request)) {
      return Response.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429, headers: NO_STORE_HEADERS });
    }

    const body = (await request.json().catch(() => ({}))) as { refresh_token?: string };
    const refreshToken = body.refresh_token?.trim();
    if (!refreshToken) {
      return Response.json({ error: "缺少 refresh_token" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated.ok) {
      // 重放命中墓碑：该用户凭据可能失窃，已全量吊销（rotateRefreshToken 内处理），
      // 错误文案与普通失效一致，不向攻击者泄露失窃检测的存在
      return Response.json({ error: "refresh token 无效或已过期" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const row = await getDb()
      .prepare("SELECT id, email, name, role, created_at FROM users WHERE id = ?")
      .bind(rotated.userId)
      .first<{ id: string; email: string; name: string | null; role: "admin" | "member"; created_at: string }>();
    if (!row) {
      return Response.json({ error: "用户不存在" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role, created_at: row.created_at };
    const token = await createSessionValue(user);
    return Response.json(
      { token, token_type: "Bearer", expires_in: SESSION_TTL_SECONDS, user, refresh_token: rotated.rotatedToken },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("[auth/refresh] Error:", err);
    return Response.json({ error: "服务器错误" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
