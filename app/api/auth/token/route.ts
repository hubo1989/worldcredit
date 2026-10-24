import { getDb } from '@/lib/db'
import { pbkdf2Verify } from '@/lib/auth-crypto'
import { createSessionValue, type SessionUser } from '@/lib/session'
import { isAdminEmail } from '@/lib/admin-emails'
import { verifyGoogleIdToken } from '@/lib/google-id-token'

const TOKEN_EXPIRES_IN = 7 * 24 * 3600

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      grant_type?: string
      email?: string
      password?: string
      id_token?: string
    }

    const grantType = body.grant_type || 'password'

    if (grantType === 'password') {
      const { email, password } = body
      if (!email || !password) {
        return Response.json({ error: '缺少邮箱或密码' }, { status: 400 })
      }
      const db = getDb()
      const row = await db
        .prepare('SELECT id, email, password_hash, name, role, created_at FROM users WHERE email = ?')
        .bind(email)
        .first<{ id: string; email: string; password_hash: string; name: string | null; role: string; created_at: string }>()

      if (!row) {
        return Response.json({ error: '邮箱不存在' }, { status: 401 })
      }

      const verified = await pbkdf2Verify(password, row.password_hash)
      if (!verified) {
        return Response.json({ error: '密码错误' }, { status: 401 })
      }

      const user: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: isAdminEmail(row.email) ? 'admin' : 'member',
        created_at: row.created_at,
      }
      const token = await createSessionValue(user)

      return Response.json({
        token,
        token_type: 'Bearer',
        expires_in: TOKEN_EXPIRES_IN,
        user,
      })
    }

    if (grantType === 'google') {
      const { id_token } = body
      if (!id_token) {
        return Response.json({ error: '缺少 id_token' }, { status: 400 })
      }

      const webClientId = process.env.GOOGLE_CLIENT_ID
      const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID
      const allowedClientIds = [webClientId, iosClientId].filter((c): c is string => Boolean(c))

      if (!allowedClientIds.length) {
        return Response.json({ error: '服务端未配置 Google Client ID' }, { status: 500 })
      }

      const verified = await verifyGoogleIdToken(id_token, { clientId: allowedClientIds })
      if (!verified.ok) {
        return Response.json({ error: `Google ID token 验证失败: ${verified.reason}` }, { status: 401 })
      }

      const { email, name, sub: googleId } = verified.identity
      const db = getDb()
      let row = await db
        .prepare('SELECT id, email, name, role, created_at FROM users WHERE email = ?')
        .bind(email)
        .first<{ id: string; email: string; name: string | null; role: string; created_at: string }>()

      if (!row) {
        const id = crypto.randomUUID()
        const role = isAdminEmail(email) ? 'admin' : 'member'
        const createdAt = new Date().toISOString()
        await db
          .prepare('INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, email, `google:${googleId}`, name || null, role, createdAt)
          .run()
        row = { id, email, name: name || null, role, created_at: createdAt }
      }

      const user: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: isAdminEmail(row.email) ? 'admin' : 'member',
        created_at: row.created_at,
      }
      const token = await createSessionValue(user)

      return Response.json({
        token,
        token_type: 'Bearer',
        expires_in: TOKEN_EXPIRES_IN,
        user,
      })
    }

    return Response.json({ error: `不支持的 grant_type: ${grantType}` }, { status: 400 })
  } catch (err) {
    console.error('[auth/token] Error:', err)
    return Response.json({ error: '登录失败' }, { status: 500 })
  }
}
