// app/api/gmail/connect/route.ts — iOS：serverAuthCode 换 refresh token 并保存连接。
// GoogleSignIn server-side access：serverAuthCode 属 installed-app 流，
// 换 token 时 redirect_uri 为空串（Google 文档约定）。
import { readSession } from "@/lib/session";
import { exchangeCodeAndSaveConnection } from "@/lib/gmail/connect.server";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: { serverAuthCode?: string };
  try {
    body = (await request.json()) as { serverAuthCode?: string };
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const code = body.serverAuthCode?.trim();
  if (!code) {
    return Response.json({ error: "缺少 serverAuthCode" }, { status: 400 });
  }

  try {
    const result = await exchangeCodeAndSaveConnection({
      code,
      redirectUri: "",
      sessionUserId: session.id,
    });
    if (!result.ok) {
      const messages: Record<string, string> = {
        not_configured: "服务端 Google OAuth 未配置",
        token_exchange: "授权码换取 token 失败（可能已过期，请重试）",
        no_refresh_token: "Google 未返回 refresh token，请在授权页勾选并重试",
        id_token_invalid: "Google 身份校验失败",
        no_session_secret: "服务端未配置 SESSION_SECRET",
      };
      return Response.json(
        { error: messages[result.reason] ?? result.reason },
        { status: 400 },
      );
    }
    return Response.json({ ok: true, email: result.email });
  } catch (err) {
    console.error("[gmail-connect] unexpected error:", err);
    return Response.json({ error: "连接失败，请重试" }, { status: 500 });
  }
}
