import { createSessionValue, sessionCookieHeader, type SessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin-emails";
import { passwordLoginFailure, verifyPasswordLogin } from "@/lib/password-login";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return Response.json({ error: "缺少邮箱或密码" }, { status: 400 });
    }
    const result = await verifyPasswordLogin(email, password, request);
    if (result instanceof Response) return result;
    if (!result) return passwordLoginFailure();
    // 角色以白名单为准，不照抄 users.role：历史 admin 行在下次登录时自动降级。
    const user: SessionUser = { ...result, role: isAdminEmail(result.email) ? "admin" : "member" };
    const cookieValue = await createSessionValue(user);
    return Response.json(
      { user },
      {
        headers: {
          "Set-Cookie": sessionCookieHeader(cookieValue),
        },
      },
    );
  } catch (err) {
    console.error("[login] Error:", err);
    return Response.json({ error: "登录失败" }, { status: 500 });
  }
}
