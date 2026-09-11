export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    console.error('[google-start] GOOGLE_CLIENT_ID not found in env')
    return Response.json({ error: 'Google login not configured' }, { status: 500 })
  }

  const redirectUri = `${origin}/api/auth/google/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: crypto.randomUUID(),
    access_type: 'offline',
    prompt: 'select_account',
  })

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302)
}
