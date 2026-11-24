// app/api/auth/gmail/callback/route.ts — 保存 Gmail 连接（加密 refresh token）。
//
// HUB-156 扩展：读取 /api/auth/gmail/start 写下的签名上下文 Cookie，把
// defaultHolderId / displayLabel 补写到新连接上；单用户连接数超限时拒绝。
import { readSession } from "@/lib/session";
import { clearOAuthStateCookie, verifyOAuthState } from "@/lib/oauth-state";
import { gmailRedirectUri, resolveAuthOrigin } from "@/lib/auth-origin";
import { exchangeCodeAndSaveConnection } from "@/lib/gmail/connect.server";
import {
  applyGmailConnectionDefaults,
  assertGmailConnectionCapacity,
} from "@/lib/api/gmail.server";
import {
  clearGmailConnectContextCookie,
  readGmailConnectContext,
} from "@/lib/api/gmail-oauth-context";
import { RpcDomainError } from "@/lib/api/errors";

export async function GET(request: Request) {
  const origin = resolveAuthOrigin(request);
  const url = new URL(request.url);
  const stateFromQuery = url.searchParams.get("state");

  const fail = (code: string) => {
    const headers = new Headers();
    headers.set("Location", `${origin}/settings?gmail=error&reason=${code}`);
    headers.append("Set-Cookie", clearOAuthStateCookie());
    headers.append("Set-Cookie", clearGmailConnectContextCookie());
    return new Response(null, { status: 302, headers });
  };

  const stateOk = await verifyOAuthState(request, stateFromQuery);
  if (!stateOk) return fail("state_invalid");

  const session = await readSession(request);
  if (!session) return fail("login_required");

  const code = url.searchParams.get("code");
  if (!code) return fail("no_code");

  try {
    await assertGmailConnectionCapacity(session.id);
    const result = await exchangeCodeAndSaveConnection({
      code,
      redirectUri: gmailRedirectUri(request),
      sessionUserId: session.id,
      idTokenNonce: stateFromQuery ?? undefined,
    });
    if (!result.ok) return fail(result.reason);

    const context = await readGmailConnectContext(request);
    if (context) {
      await applyGmailConnectionDefaults(session.id, {
        defaultHolderId: context.defaultHolderId,
        displayLabel: context.label,
      });
    }

    const headers = new Headers();
    headers.set("Location", `${origin}/settings?gmail=connected`);
    headers.append("Set-Cookie", clearGmailConnectContextCookie());
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof RpcDomainError) return fail("connection_limit");
    console.error("[gmail-callback] unexpected error:", err);
    return fail("unexpected");
  }
}
