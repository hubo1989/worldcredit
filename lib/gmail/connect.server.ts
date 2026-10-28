// lib/gmail/connect.server.ts — Google OAuth code → 加密连接（Web callback 与 iOS connect 共用）。
//
// 两条入口殊途同归：
//   - Web：/api/auth/gmail/callback，redirect_uri = APP_ORIGIN + GMAIL_CALLBACK_PATH
//   - iOS：/api/gmail/connect，serverAuthCode 走 installed-app 流，redirect_uri 为空串
// 共用本模块：code 换 token → verifyGoogleIdToken 验身份 → encryptToken → upsert gmail_connections。

import { getDb, getWorkerEnv } from "../db/client";
import { verifyGoogleIdToken } from "../google-id-token";
import { encryptToken } from "./token-crypto";

let fetchOverride: typeof fetch | null = null;
/** 仅测试用：注入 fetch，避免打真实 Google 端点。 */
export function __setGmailConnectDeps(fetchImpl: typeof fetch | null) {
  fetchOverride = fetchImpl;
}

export type ConnectFailure =
  | "not_configured"
  | "token_exchange"
  | "no_refresh_token"
  | "id_token_invalid"
  | "no_session_secret";

export interface ConnectResult {
  ok: true;
  email: string;
  sub: string;
}

/** code 换 token 并把加密后的凭据 upsert 进 gmail_connections。 */
export async function exchangeCodeAndSaveConnection(params: {
  code: string;
  /** Web 回调传完整 URL；iOS installed-app 流传空串。 */
  redirectUri: string;
  sessionUserId: string;
  idTokenNonce?: string;
}): Promise<ConnectResult | { ok: false; reason: ConnectFailure }> {
  // 生产由 worker env 注入（vite 构建静态替换 process.env）；测试经 setWorkerEnv 注入。
  const env = getWorkerEnv() as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
  const clientId = env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, reason: "not_configured" };

  const tokenRes = await (fetchOverride ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return { ok: false, reason: "token_exchange" };
  const tokens = (await tokenRes.json()) as {
    id_token?: string;
    refresh_token?: string;
    access_token?: string;
  };
  if (!tokens.id_token || !tokens.refresh_token) return { ok: false, reason: "no_refresh_token" };

  const verified = await verifyGoogleIdToken(tokens.id_token, {
    clientId,
    nonce: params.idTokenNonce,
  });
  if (!verified.ok) return { ok: false, reason: "id_token_invalid" };
  const { email, sub } = verified.identity;

  const secret =
    (getWorkerEnv() as { SESSION_SECRET?: string }).SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) return { ok: false, reason: "no_session_secret" };
  const refreshEnc = await encryptToken(tokens.refresh_token, secret);
  const accessEnc = tokens.access_token ? await encryptToken(tokens.access_token, secret) : null;

  const db = getDb();
  await db
    .prepare(
      `INSERT INTO gmail_connections
         (user_id, google_sub, email, refresh_token_enc, access_token_enc, scopes, status, updated_at)
       VALUES (?,?,?,?,?,?, 'active', datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         google_sub = excluded.google_sub,
         email = excluded.email,
         refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc,
         scopes = excluded.scopes,
         status = 'active',
         last_error = NULL,
         updated_at = datetime('now')`,
    )
    .bind(
      params.sessionUserId,
      sub,
      email,
      refreshEnc,
      accessEnc,
      "https://www.googleapis.com/auth/gmail.readonly",
    )
    .run();

  return { ok: true, email, sub };
}
