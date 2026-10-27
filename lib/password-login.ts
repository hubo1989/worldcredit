import { getDb } from "@/lib/db";
import { pbkdf2Verify, pbkdf2DummyHash } from "@/lib/auth-crypto";
import { isAdminEmail } from "@/lib/admin-emails";
import type { SessionUser } from "@/lib/session";
import {
  passwordRateLimitRetryAfter,
  recordPasswordFailure,
  clearPasswordFailures,
} from "@/lib/auth-rate-limit";

interface PasswordUserRow extends SessionUser {
  password_hash: string;
}

/** The two auth entry points share validation, uniform rejection and role derivation. */
export async function verifyPasswordLogin(
  email: string,
  password: string,
  request: Request,
): Promise<SessionUser | null | Response> {
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
    await recordPasswordFailure(request, email);
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
