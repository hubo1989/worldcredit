// app/api/auth/gmail/callback/route.ts — 保存 Gmail 连接（加密 refresh token）。
import { readSession } from "@/lib/session";
import { clearOAuthStateCookie, verifyOAuthState } from "@/lib/oauth-state";
import { gmailRedirectUri, resolveAuthOrigin } from "@/lib/auth-origin";
import { exchangeCodeAndSaveConnection } from "@/lib/gmail/connect.server";

export async function GET(request: Request) {
  const origin = resolveAuthOrigin(request);
  const url = new URL(request.url);
  const stateFromQuery = url.searchParams.get("state");

  const fail = (code: string) => {
    const headers = new Headers();
    headers.set("Location", `${origin}/settings?gmail=error&reason=${code}`);
    headers.append("Set-Cookie", clearOAuthStateCookie());
    return new Response(null, { status: 302, headers });
  };

  const stateOk = await verifyOAuthState(request, stateFromQuery);
  if (!stateOk) return fail("state_invalid");

  const session = await readSession(request);
  if (!session) return fail("login_required");

  const code = url.searchParams.get("code");
  if (!code) return fail("no_code");

  try {
    const result = await exchangeCodeAndSaveConnection({
      code,
      redirectUri: gmailRedirectUri(request),
      sessionUserId: session.id,
      idTokenNonce: stateFromQuery ?? undefined,
    });
    if (!result.ok) return fail(result.reason);

    return Response.redirect(`${origin}/settings?gmail=connected`, 302);
  } catch (err) {
    console.error("[gmail-callback] unexpected error:", err);
    return fail("unexpected");
  }
}
