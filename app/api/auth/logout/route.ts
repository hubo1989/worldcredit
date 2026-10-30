// app/api/auth/logout/route.ts — 登出：清 cookie + 吊销凭据。
// 语义：默认吊销该用户全部 refresh token（全端下线，语义与 Web 登出一致）；
// 请求体携带 refresh_token 时只吊销该单设备凭据（多设备并存互不影响），
// 且会话已过期（readSession 为 null）时也能凭 refresh_token 吊销，
// 避免「登出时 access token 恰好过期 → 180 天凭据残留」。
import { clearSessionCookieHeader, readSession } from '@/lib/session'
import { revokeAllRefreshTokens, revokeRefreshToken } from '@/lib/refresh-tokens.server'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { refresh_token?: string }
  const session = await readSession(request)
  try {
    if (session) {
      if (body.refresh_token?.trim()) {
        // 单设备登出：只吊销请求体指定的凭据，其他设备不受影响
        await revokeRefreshToken(body.refresh_token.trim())
      } else {
        await revokeAllRefreshTokens(session.id)
      }
    } else if (body.refresh_token?.trim()) {
      // 会话已过期也能按凭据吊销，避免长期凭据在登出后残留
      await revokeRefreshToken(body.refresh_token.trim())
    }
  } catch (err) {
    // 吊销失败不阻塞登出；token 仍有过期兜底
    console.error('[auth/logout] revoke refresh tokens failed:', err)
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookieHeader() } }
  )
}
