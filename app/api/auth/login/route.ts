import { getDb } from '@/lib/db'
import { pbkdf2Verify } from '@/lib/auth-crypto'
import { createSessionValue, sessionCookieHeader, type SessionUser } from '@/lib/session'
import { isAdminEmail } from '@/lib/admin-emails'

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

    // 角色以白名单为准，不照抄 users.role：这样历史遗留的 admin 行（例如早先
    // 自动提权产生的测试账号）在下次登录时自动降级，无需手动改库。
    const user: SessionUser = { id: result.id, email: result.email, name: result.name, role: isAdminEmail(result.email) ? 'admin' : 'member', created_at: result.created_at }
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
    console.error('[login] Error:', err)
    return Response.json({ error: '登录失败' }, { status: 500 })
  }
}
