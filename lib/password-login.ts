import { getDb } from "@/lib/db";
import { pbkdf2Verify, pbkdf2DummyHash } from "@/lib/auth-crypto";
import { isAdminEmail } from "@/lib/admin-emails";
import type { SessionUser } from "@/lib/session";
import { passwordRateLimitRetryAfter, clearPasswordFailures } from "@/lib/auth-rate-limit";

interface PasswordUserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  created_at: string;
}

/** The two auth entry points share validation, uniform rejection and role derivation. */
export async function verifyPasswordLogin(
  email: string,
  password: string,
  request: Request,
): Promise<SessionUser | null | Response> {
  // 原子占位：放行的尝试已计入失败窗口，成功登录会清零。
  const retryAfter = await passwordRateLimitRetryAfter(request, email);
  if (retryAfter !== null) {
    return Response.json(
      { error: "尝试次数过多，请稍后重试" },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
      },
    );
  }
  const row = await getDb()
    .prepare("SELECT id, email, password_hash, name, created_at FROM users WHERE email = ?")
    .bind(email)
    .first<PasswordUserRow>();
  const verified = await pbkdf2Verify(password, row?.password_hash ?? pbkdf2DummyHash());
  if (!row || !verified) {
    // 放行时已原子计入失败窗口，此处不再二次递增。
    return null;
  }
  await clearPasswordFailures(request, email);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isAdminEmail(row.email) ? "admin" : "member",
    created_at: row.created_at,
  };
}

export function passwordLoginFailure(): Response {
  return Response.json(
    { error: "邮箱或密码错误" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
