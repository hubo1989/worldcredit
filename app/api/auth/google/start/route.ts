import { googleRedirectUri } from '@/lib/auth-origin'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    console.error('[google-start] GOOGLE_CLIENT_ID not found in env')
    return Response.json({ error: 'Google login not configured' }, { status: 500 })
  }

  // 回调域名由 APP_ORIGIN 决定，而不是浏览器当前访问的域名；否则换个域名进来
  // （自定义域名 / workers.dev）就会生成一个 Google 未登记的 redirect_uri。
  const redirectUri = googleRedirectUri(request)
  console.log(`[google-start] origin=${url.origin} redirect_uri=${redirectUri}`)
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
