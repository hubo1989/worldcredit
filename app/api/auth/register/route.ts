import { getDb, uuid } from '@/lib/db'
import { pbkdf2Hash } from '@/lib/auth-crypto'
import { createSessionValue, sessionCookieHeader, type SessionUser } from '@/lib/session'

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
    // Bootstrap: the first registered user becomes admin; everyone after is a
    // family member. Existing deployments already have their admin user.
    const count = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    const role = (count?.n ?? 0) === 0 ? 'admin' : 'member'
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
