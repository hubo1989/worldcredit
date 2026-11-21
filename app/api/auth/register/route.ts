import { getDb, uuid } from '@/lib/db'
import { pbkdf2Hash } from '@/lib/auth-crypto'
import {
  createSessionValue,
  sessionCookieHeader,
  SESSION_TTL_SECONDS,
  type SessionUser,
} from '@/lib/session'
import { isAdminEmail } from '@/lib/admin-emails'
import { issueRefreshToken } from '@/lib/refresh-tokens.server'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const withHeaders = (extra?: Record<string, string>) => ({
    ...NO_STORE_HEADERS,
    ...extra,
  })

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown
      password?: unknown
      name?: unknown
      issue_token?: unknown
    }
    const issueToken = body.issue_token === true
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name : null

    if (!email || !password) {
      return Response.json(
        { error: '缺少邮箱或密码' },
        { status: 400, headers: withHeaders() }
      )
    }
    const db = getDb()
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) {
      return Response.json(
        { error: '该邮箱已注册' },
        { status: 409, headers: withHeaders() }
      )
    }
    // Admin is granted only from the explicit allowlist. The previous
    // "first row in the table wins" bootstrap was a race: two concurrent
    // registrations on an empty database both read n=0 and both became admin,
    // and it re-armed on every fresh database.
    const role = isAdminEmail(email) ? 'admin' : 'member'
    const hash = await pbkdf2Hash(password)
    const id = uuid()
    const createdAt = new Date().toISOString()
    try {
      await db
        .prepare(
          'INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(id, email, hash, name || null, role, createdAt)
        .run()
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr)
      if (
        msg.includes('UNIQUE constraint failed: users.email') ||
        (msg.includes('UNIQUE constraint failed') && !msg.includes('users.'))
      ) {
        return Response.json(
          { error: '该邮箱已注册' },
          { status: 409, headers: withHeaders() }
        )
      }
      throw insertErr
    }

    const user: SessionUser = { id, email, name: name || null, role, created_at: createdAt }
    const token = await createSessionValue(user)
    if (issueToken) {
      // App 端静默续期凭据：原文仅此一次下发（库内只存哈希），与 /api/auth/token 同构
      // 签发失败时回滚刚插入的用户行，避免留下无凭据且重试即 409 冲突的孤儿账号
      let refresh: Awaited<ReturnType<typeof issueRefreshToken>>
      try {
        refresh = await issueRefreshToken(id)
      } catch (refreshErr) {
        await db
          .prepare('DELETE FROM users WHERE id = ?')
          .bind(id)
          .run()
          .catch((rollbackErr) => {
            console.error('[register] 回滚用户行失败，可能残留孤儿账号:', id, rollbackErr)
          })
        throw refreshErr
      }
      return Response.json(
        {
          token,
          token_type: 'Bearer',
          expires_in: SESSION_TTL_SECONDS,
          user,
          refresh_token: refresh.token,
        },
        {
          headers: withHeaders({
            'Set-Cookie': sessionCookieHeader(token),
          }),
        }
      )
    }

    return Response.json(
      { user },
      {
        headers: withHeaders({
          'Set-Cookie': sessionCookieHeader(token),
        }),
      }
    )
  } catch (err) {
    console.error('[register] Error:', err)
    return Response.json(
      { error: '注册失败' },
      { status: 500, headers: withHeaders() }
    )
  }
}
