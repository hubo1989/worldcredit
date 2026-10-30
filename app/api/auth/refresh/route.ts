// POST /api/auth/refresh — App 端静默续期：refresh token 换新 access token。
// 一次性轮换：旧 refresh token 立即吊销，响应携带新的。
import { getDb } from "@/lib/db";
import { createSessionValue, SESSION_TTL_SECONDS, type SessionUser } from "@/lib/session";
import { rotateRefreshToken } from "@/lib/refresh-tokens.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { refresh_token?: string };
    const refreshToken = body.refresh_token?.trim();
    if (!refreshToken) {
      return Response.json({ error: "缺少 refresh_token" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated.ok || !rotated.userId) {
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
