import { getDb, uuid } from '@/lib/db'
import { pbkdf2Hash } from '@/lib/auth-crypto'
import {
  createSessionValue,
  sessionCookieHeader,
  SESSION_TTL_SECONDS,
  type SessionUser,
} from '@/lib/session'
import { isAdminEmail } from '@/lib/admin-emails'
import { prepareIssueRefreshToken } from '@/lib/refresh-tokens.server'

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
    const user: SessionUser = { id, email, name: name || null, role, created_at: createdAt }
    // createSessionValue 仅依赖本地构建的 user，不涉及 DB：先签发再入库，
    // 签名失败时直接走 500 分支且库中尚无用户行，避免孤儿账号重试恒 409
    const token = await createSessionValue(user)
    const insertUserStmt = db
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, email, hash, name || null, role, createdAt)
    const preparedRefresh = issueToken ? await prepareIssueRefreshToken(id) : null
    try {
      if (preparedRefresh) {
        // 与 INSERT users 放入同一 db.batch（D1 隐式事务），任一失败整批回滚，消除孤儿账号窗口
        await db.batch([insertUserStmt, preparedRefresh.statement])
      } else {
        await insertUserStmt.run()
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr)
      // users.email 为内联 UNIQUE，D1 固定报 "UNIQUE constraint failed: users.email"；
      // 其余 users 表（如 users.id）或 refresh token 约束冲突继续抛出走 500
      if (msg.includes('UNIQUE constraint failed: users.email')) {
        return Response.json(
          { error: '该邮箱已注册' },
          { status: 409, headers: withHeaders() }
        )
      }
      throw insertErr
    }

    if (preparedRefresh) {
      // App 端静默续期凭据：原文仅此一次下发（库内只存哈希），与 /api/auth/token 同构
      return Response.json(
        {
          token,
          token_type: 'Bearer',
          expires_in: SESSION_TTL_SECONDS,
          user,
          refresh_token: preparedRefresh.token,
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
