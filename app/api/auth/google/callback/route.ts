import { getDb } from '@/lib/db'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return Response.redirect(`${url.origin}/login?error=google_no_code`, 302)
  }

  const clientId = (globalThis as any).__cloudflare_env__?.GOOGLE_CLIENT_ID
  const clientSecret = (globalThis as any).__cloudflare_env__?.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return Response.redirect(`${url.origin}/login?error=google_not_configured`, 302)
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('[google-callback] Token exchange failed:', errText)
      return Response.redirect(`${url.origin}/login?error=google_token_exchange`, 302)
    }
    const tokens = await tokenRes.json() as { id_token?: string; access_token?: string }
    if (!tokens.id_token) {
      return Response.redirect(`${url.origin}/login?error=google_no_id_token`, 302)
    }

    // Decode ID token payload (JWT base64url)
    const [, payloadB64] = tokens.id_token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    const { email, name, sub: googleId } = payload as { email: string; name?: string; sub: string }
    if (!email) {
      return Response.redirect(`${url.origin}/login?error=google_no_email`, 302)
    }

    // Look up or create user in D1
    const db = getDb()
    let user = await db
      .prepare('SELECT id, email, name, role, created_at FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; email: string; name: string | null; role: string; created_at: string }>()

    if (!user) {
      // Auto-register Google user as admin
      const id = crypto.randomUUID()
      await db
        .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, `google:${googleId}`, name || null, 'admin')
        .run()
      user = { id, email, name: name || null, role: 'admin', created_at: new Date().toISOString() }
    }

    // Redirect to dashboard with user info in URL (session cookie not yet implemented)
    const params = new URLSearchParams({
      google_login: '1',
      user_id: user.id,
      email: user.email,
      name: user.name || '',
    })
    return Response.redirect(`${url.origin}/api/auth/google/session?${params.toString()}`, 302)
  } catch (err) {
    console.error('[google-callback] Error:', err)
    return Response.redirect(`${url.origin}/login?error=google_callback_error`, 302)
  }
}
