import { googleRedirectUri, resolveAuthOrigin } from '@/lib/auth-origin'
import { issueOAuthState } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const clientId = process.env.GOOGLE_CLIENT_ID

  // state/nonce 存在 HttpOnly cookie 里，cookie 不跨父域，所以「下发 state 的主机」
  // 必须与「收到回调的主机」一致。回调固定在 APP_ORIGIN，那么从其他域名进来的
  // 请求（workers.dev、未来的别名域名）先跳回规范域名再发起授权——否则浏览器在
  // workers.dev 上拿到 state cookie，回调却落在 APP_ORIGIN，校验必然失败。
  const canonicalOrigin = resolveAuthOrigin(request)
  if (url.origin !== canonicalOrigin) {
    console.log(`[google-start] 入口 origin=${url.origin} 非规范域名，转交 ${canonicalOrigin}`)
    return Response.redirect(`${canonicalOrigin}${url.pathname}`, 302)
  }

  if (!clientId) {
    console.error('[google-start] GOOGLE_CLIENT_ID not found in env')
    return Response.json({ error: 'Google login not configured' }, { status: 500 })
  }

  // 回调域名由 APP_ORIGIN 决定，而不是浏览器当前访问的域名；否则换个域名进来
  // （自定义域名 / workers.dev）就会生成一个 Google 未登记的 redirect_uri。
  const redirectUri = googleRedirectUri(request)
  console.log(`[google-start] origin=${url.origin} redirect_uri=${redirectUri}`)
  // state 既是 CSRF 令牌（随签名 cookie 下发、回调时比对）也是 ID token 的 nonce，
  // 这样回调里的身份断言只对本次授权有效。
  const { state, cookie: stateCookie } = await issueOAuthState()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce: state,
    access_type: 'offline',
    prompt: 'select_account',
  })

  const headers = new Headers()
  headers.set('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  headers.append('Set-Cookie', stateCookie)
  return new Response(null, { status: 302, headers })
}
