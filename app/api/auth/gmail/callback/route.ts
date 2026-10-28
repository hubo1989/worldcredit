// app/api/auth/gmail/callback/route.ts — 保存 Gmail 连接（加密 refresh token）。
import { getDb, getWorkerEnv } from '@/lib/db/client'
import { readSession } from '@/lib/session'
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state'
import { gmailRedirectUri, resolveAuthOrigin } from '@/lib/auth-origin'
import { verifyGoogleIdToken } from '@/lib/google-id-token'
import { encryptToken } from '@/lib/gmail/token-crypto'

export async function GET(request: Request) {
  const origin = resolveAuthOrigin(request)
  const url = new URL(request.url)
  const stateFromQuery = url.searchParams.get('state')

  const fail = (code: string) => {
    const headers = new Headers()
    headers.set('Location', `${origin}/settings?gmail=error&reason=${code}`)
    headers.append('Set-Cookie', clearOAuthStateCookie())
    return new Response(null, { status: 302, headers })
  }

  const stateOk = await verifyOAuthState(request, stateFromQuery)
  if (!stateOk) return fail('state_invalid')

  const session = await readSession(request)
  if (!session) return fail('login_required')

  const code = url.searchParams.get('code')
  if (!code) return fail('no_code')

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail('not_configured')

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: gmailRedirectUri(request),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return fail('token_exchange')
    const tokens = await tokenRes.json() as {
      id_token?: string; refresh_token?: string; access_token?: string
    }
    if (!tokens.id_token || !tokens.refresh_token) return fail('no_refresh_token')

    const verified = await verifyGoogleIdToken(tokens.id_token, {
      clientId,
      nonce: stateFromQuery ?? undefined,
    })
    if (!verified.ok) return fail('id_token_invalid')
    const { email, sub } = verified.identity

    const secret = (getWorkerEnv() as { SESSION_SECRET?: string }).SESSION_SECRET
      ?? process.env.SESSION_SECRET
    if (!secret) return fail('no_session_secret')
    const refreshEnc = await encryptToken(tokens.refresh_token, secret)
    const accessEnc = tokens.access_token ? await encryptToken(tokens.access_token, secret) : null

    const db = getDb()
    await db.prepare(
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
         updated_at = datetime('now')`
    ).bind(
      session.id, sub, email, refreshEnc, accessEnc,
      'https://www.googleapis.com/auth/gmail.readonly'
    ).run()

    return Response.redirect(`${origin}/settings?gmail=connected`, 302)
  } catch (err) {
    console.error('[gmail-callback] unexpected error:', err)
    return fail('unexpected')
  }
}
