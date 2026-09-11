import { getDb } from '@/lib/db'
import { pbkdf2Verify } from '@/lib/auth-crypto'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return Response.json({ error: '缺少邮箱或密码' }, { status: 400 })
    }
    const db = getDb()
    const result = await db
      .prepare('SELECT id, email, password_hash, name, role, created_at FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; email: string; password_hash: string; name: string | null; role: string; created_at: string }>()

    if (!result) {
      return Response.json({ error: '邮箱不存在' }, { status: 401 })
    }

    const verified = await pbkdf2Verify(password, result.password_hash)
    if (!verified) {
      return Response.json({ error: '密码错误' }, { status: 401 })
    }

    return Response.json({
      user: { id: result.id, email: result.email, name: result.name, role: result.role, created_at: result.created_at },
    })
  } catch (err) {
    console.error('[login] Error:', err)
    return Response.json({
      error: '登录失败',
      detail: err instanceof Error ? err.message : String(err)
    }, { status: 500 })
  }
}
