import { getDb } from '@/lib/db'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const clientId = (globalThis as any).__cloudflare_env__?.GOOGLE_CLIENT_ID
    ?? (typeof process !== 'undefined' ? process.env?.GOOGLE_CLIENT_ID : undefined)

  if (!clientId) {
    return Response.json({ error: 'GOOGLE_CLIENT_ID not configured' }, { status: 500 })
  }

  const redirectUri = `${origin}/api/auth/google/callback`
  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return Response.redirect(googleAuthUrl, 302)
}
