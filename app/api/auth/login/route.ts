import { getDb } from '@/lib/db'
import { pbkdf2Verify } from '@/lib/auth-crypto'

export async function POST(request: Request) {
  const { email, password } = await request.json()
  if (!email || !password) {
    return Response.json({ error: '缺少邮箱或密码' }, { status: 400 })
  }
  const db = getDb()
  const user = await db
    .prepare('SELECT id, email, password_hash, name, role, created_at FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; name: string | null; role: string; created_at: string }>()
  if (!user || !(await pbkdf2Verify(password, user.password_hash))) {
    return Response.json({ error: '邮箱或密码错误' }, { status: 401 })
  }
  return Response.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at },
  })
}
