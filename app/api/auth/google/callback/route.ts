import { getDb } from '@/lib/db'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return Response.redirect(`${url.origin}/login?error=google_no_code`, 302)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[google-callback] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET')
    return Response.redirect(`${url.origin}/login?error=google_not_configured`, 302)
  }

  try {
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
      console.error('[google-callback] Token exchange failed:', errText.slice(0, 500))
      return Response.redirect(`${url.origin}/login?error=google_token_exchange`, 302)
    }
    const tokens = await tokenRes.json() as { id_token?: string }
    if (!tokens.id_token) {
      return Response.redirect(`${url.origin}/login?error=google_no_id_token`, 302)
    }

    const [, payloadB64] = tokens.id_token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    const { email, name, sub: googleId } = payload as { email: string; name?: string; sub: string }
    if (!email) {
      return Response.redirect(`${url.origin}/login?error=google_no_email`, 302)
    }

    const db = getDb()
    let user = await db
      .prepare('SELECT id, email, name, role, created_at FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; email: string; name: string | null; role: string; created_at: string }>()

    if (!user) {
      const id = crypto.randomUUID()
      await db
        .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, `google:${googleId}`, name || null, 'admin')
        .run()
      user = { id, email, name: name || null, role: 'admin', created_at: new Date().toISOString() }
    }

    const userJson = JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at })
    const headers = new Headers()
    headers.set('Location', `${url.origin}/dashboard`)
    headers.set('Set-Cookie', `wc_user=${encodeURIComponent(userJson)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`)
    return new Response(null, { status: 302, headers })
  } catch (err) {
    console.error('[google-callback] Error:', err)
    return Response.redirect(`${url.origin}/login?error=google_callback_error`, 302)
  }
}
