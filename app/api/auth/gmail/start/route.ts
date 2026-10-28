// app/api/auth/gmail/start/route.ts — 连接 Gmail（增量授权 gmail.readonly）。
// 必须已登录：这是给当前会话用户挂邮箱授权，不是登录入口。
import { readSession } from '@/lib/session'
import { issueOAuthState } from '@/lib/oauth-state'
import { gmailRedirectUri, resolveAuthOrigin } from '@/lib/auth-origin'

export async function GET(request: Request) {
  const url = new URL(request.url)
  // 与 google-start 同理：state cookie 不跨域，发起授权的主机必须与回调主机一致。
  const origin = resolveAuthOrigin(request)
  if (url.origin !== origin) {
    return Response.redirect(`${origin}${url.pathname}`, 302)
  }

  const session = await readSession(request)
  if (!session) {
    return Response.redirect(`${origin}/login?error=login_required`, 302)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    console.error('[gmail-start] GOOGLE_CLIENT_ID not found in env')
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const { state, cookie: stateCookie } = await issueOAuthState()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(request),
    response_type: 'code',
    // gmail.readonly = 整个邮箱只读；Google 没有「只读银行邮件」的细分 scope。
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    state,
    nonce: state,
    access_type: 'offline',
    // consent 强制重新同意，保证每次连接都拿到 refresh_token（Google 默认
    // 只在首次授权时给 refresh_token）。
    prompt: 'consent select_account',
  })

  const headers = new Headers()
  headers.set('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  headers.append('Set-Cookie', stateCookie)
  return new Response(null, { status: 302, headers })
}
