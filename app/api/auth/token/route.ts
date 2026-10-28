import { getDb } from "@/lib/db";
import { createSessionValue, SESSION_TTL_SECONDS, type SessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin-emails";
import { verifyGoogleIdToken } from "@/lib/google-id-token";
import { passwordLoginFailure, verifyPasswordLogin } from "@/lib/password-login";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function issueTokenResponse(user: SessionUser): Promise<Response> {
  const token = await createSessionValue(user);
  return Response.json(
    {
      token,
      token_type: "Bearer",
      expires_in: SESSION_TTL_SECONDS,
      user,
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      grant_type?: string;
      email?: string;
      password?: string;
      id_token?: string;
      nonce?: string;
    };

    const grantType = body.grant_type || "password";

    if (grantType === "password") {
      const { email, password } = body;
      if (!email || !password) {
        return Response.json(
          { error: "缺少邮箱或密码" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      const user = await verifyPasswordLogin(email, password, request);
      if (user instanceof Response) return user;
      if (!user) return passwordLoginFailure();
      return issueTokenResponse(user);
    }

    if (grantType === "google") {
      const { id_token, nonce } = body;
      if (!id_token) {
        return Response.json(
          { error: "缺少 id_token" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      const webClientId = process.env.GOOGLE_CLIENT_ID;
      const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID;
      const allowedClientIds = [webClientId, iosClientId].filter((c): c is string => Boolean(c));

      if (!allowedClientIds.length) {
        return Response.json(
          { error: "服务端未配置 Google Client ID" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      const verified = await verifyGoogleIdToken(id_token, {
        clientId: allowedClientIds,
        ...(typeof nonce === "string" && nonce ? { nonce } : {}),
      });
      if (!verified.ok) {
        return Response.json(
          { error: `Google ID token 验证失败: ${verified.reason}` },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }

      const { email, name, sub: googleId } = verified.identity;
      const db = getDb();
      let row = await db
        .prepare("SELECT id, email, name, created_at FROM users WHERE email = ?")
        .bind(email)
        .first<{
          id: string;
          email: string;
          name: string | null;
          created_at: string;
        }>();

      if (!row) {
        const id = crypto.randomUUID();
        const role = isAdminEmail(email) ? "admin" : "member";
        const createdAt = new Date().toISOString();
        await db
          .prepare(
            "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
          )
          .bind(id, email, `google:${googleId}`, name || null, role, createdAt)
          .run();
        row = await db
          .prepare("SELECT id, email, name, created_at FROM users WHERE email = ?")
          .bind(email)
          .first<{
            id: string;
            email: string;
            name: string | null;
            created_at: string;
          }>();
        if (!row) {
          throw new Error("Google 用户创建失败");
        }
      }

      // 角色一律以白名单为准，不信任数据库历史 role 列，旧 admin 行自动降级。
      const user: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: isAdminEmail(row.email) ? "admin" : "member",
        created_at: row.created_at,
      };
      return issueTokenResponse(user);
    }

    return Response.json({ error: `不支持的 grant_type: ${grantType}` }, { status: 400 });
  } catch (err) {
    console.error("[auth/token] Error:", err);
    return Response.json({ error: "登录失败" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
