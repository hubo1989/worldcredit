import { getDb, uuid } from '@/lib/db'
import { pbkdf2Hash } from '@/lib/auth-crypto'

export async function POST(request: Request) {
  const { email, password, name } = await request.json()
  if (!email || !password) {
    return Response.json({ error: '缺少邮箱或密码' }, { status: 400 })
  }
  const db = getDb()
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) {
    return Response.json({ error: '该邮箱已注册' }, { status: 409 })
  }
  const hash = await pbkdf2Hash(password)
  const id = uuid()
  await db
    .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, hash, name || null, 'admin')
    .run()
  return Response.json({ user: { id, email, name: name || null, role: 'admin' } })
}
