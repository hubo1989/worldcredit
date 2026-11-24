// app/api/gmail/connect/route.ts — iOS：serverAuthCode 换 refresh token 并保存连接。
// GoogleSignIn server-side access：serverAuthCode 属 installed-app 流，
// 换 token 时 redirect_uri 为空串（Google 文档约定）。
//
// HUB-156 扩展（HUB-154 §3.3(3)）：可选 { defaultHolderId?, displayLabel? }。
//   - member 传他人 holder → 403；
//   - 单用户最多 10 条连接，超限拒绝（AC-05）。
import { readSession } from "@/lib/session";
import { exchangeCodeAndSaveConnection } from "@/lib/gmail/connect.server";
import {
  applyGmailConnectionDefaults,
  assertGmailConnectionCapacity,
} from "@/lib/api/gmail.server";
import {
  buildMemberContext,
  assertHolderAccess,
  MemberScopeError,
} from "@/lib/api/member-scope";
import { RpcDomainError } from "@/lib/api/errors";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: { serverAuthCode?: string; defaultHolderId?: string; displayLabel?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const code = body.serverAuthCode?.trim();
  if (!code) {
    return Response.json({ error: "缺少 serverAuthCode" }, { status: 400 });
  }

  const defaultHolderId =
    typeof body.defaultHolderId === "string" && body.defaultHolderId.trim()
      ? body.defaultHolderId.trim()
      : null;
  const displayLabel =
    typeof body.displayLabel === "string" && body.displayLabel.trim()
      ? body.displayLabel.trim().slice(0, 40)
      : null;

  try {
    if (defaultHolderId && session.role === "member") {
      const ctx = await buildMemberContext(session);
      assertHolderAccess(defaultHolderId, ctx);
    }
    await assertGmailConnectionCapacity(session.id);

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
      return Response.json({ error: messages[result.reason] ?? result.reason }, { status: 400 });
    }

    if (defaultHolderId || displayLabel) {
      await applyGmailConnectionDefaults(session.id, {
        defaultHolderId,
        displayLabel,
      });
    }
    return Response.json({ ok: true, email: result.email });
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RpcDomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[gmail-connect] unexpected error:", err);
    return Response.json({ error: "连接失败，请重试" }, { status: 500 });
  }
}
