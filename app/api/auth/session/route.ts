import { readSession } from '@/lib/session'
import { queryOne } from '@/lib/db'

export async function GET(request: Request) {
  const rawCookie = request.headers.get('Cookie') ?? ''
  const hasCookie = /(?:^|;\s*)wc_user=/.test(rawCookie)
  const user = await readSession(request)
  const wcMatch = rawCookie.match(/wc_user=([^;]*)/)
  const wcValue = wcMatch?.[1] ?? ''
  const shape = `len=${wcValue.length} hasDot=${wcValue.includes(".")} head=${wcValue.slice(0, 8)}`
  console.log(`[session] cookiePresent=${hasCookie} verified=${!!user}${user ? ` role=${user.role}` : ''} cookieCount=${(rawCookie.match(/wc_user=/g) || []).length} ${shape}`)
  // 名字以库为准：session cookie 登录时签名，改库后最长 7 天才自然刷新；
  // 这里一次点查把最新名字带出来，乱码修正不需要用户重登。
  if (user) {
    const { data: row } = await queryOne<{ name: string | null }>(
      'SELECT name FROM users WHERE id = ?',
      [user.id]
    )
    if (row) user.name = row.name
  }
  return Response.json({ user })
}
