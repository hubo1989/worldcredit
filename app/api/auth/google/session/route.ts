export async function GET(request: Request) {
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id')
  const email = url.searchParams.get('email')
  const name = url.searchParams.get('name')

  if (!userId || !email) {
    return Response.redirect(`${url.origin}/login?error=google_session_error`, 302)
  }

  const user = { id: userId, email, name: name || null, role: 'admin', created_at: new Date().toISOString() }
  // Set user in a cookie and redirect to dashboard
  const response = Response.redirect(`${url.origin}/dashboard`, 302)
  const headers = new Headers(response.headers)
  headers.set(
    'Set-Cookie',
    `wc_user=${encodeURIComponent(JSON.stringify(user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400*7`
  )
  return new Response(null, { status: 302, headers })
}
