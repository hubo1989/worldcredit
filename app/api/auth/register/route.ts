import { getDb, uuid } from '@/lib/db'
import { pbkdf2Hash } from '@/lib/auth-crypto'
import { createSessionValue, sessionCookieHeader, type SessionUser } from '@/lib/session'
import { isAdminEmail } from '@/lib/admin-emails'

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json()
    if (!email || !password) {
      return Response.json({ error: '缺少邮箱或密码' }, { status: 400 })
    }
    const db = getDb()
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) {
      return Response.json({ error: '该邮箱已注册' }, { status: 409 })
    }
    // Admin is granted only from the explicit allowlist. The previous
    // "first row in the table wins" bootstrap was a race: two concurrent
    // registrations on an empty database both read n=0 and both became admin,
    // and it re-armed on every fresh database.
    const role = isAdminEmail(email) ? 'admin' : 'member'
    const hash = await pbkdf2Hash(password)
    const id = uuid()
    await db
      .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .bind(id, email, hash, name || null, role)
      .run()

    const user: SessionUser = { id, email, name: name || null, role, created_at: new Date().toISOString() }
    const cookieValue = await createSessionValue(user)
    return Response.json(
      { user },
      {
        headers: {
          'Set-Cookie': sessionCookieHeader(cookieValue),
        },
      }
    )
  } catch (err) {
    console.error('[register] Error:', err)
    return Response.json({ error: '注册失败' }, { status: 500 })
  }
}
