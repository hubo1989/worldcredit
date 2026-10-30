// app/api/auth/logout/route.ts — 登出：清 cookie + 吊销全部 refresh token。
import { clearSessionCookieHeader, readSession } from '@/lib/session'
import { revokeAllRefreshTokens } from '@/lib/refresh-tokens.server'

export async function POST(request: Request) {
  const session = await readSession(request)
  if (session) {
    try {
      await revokeAllRefreshTokens(session.id)
    } catch (err) {
      // 吊销失败不阻塞登出；token 仍有过期兑底
      console.error('[auth/logout] revoke refresh tokens failed:', err)
    }
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookieHeader() } }
  )
}
