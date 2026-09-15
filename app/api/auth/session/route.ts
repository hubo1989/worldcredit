import { readSession } from '@/lib/session'

export async function GET(request: Request) {
  const rawCookie = request.headers.get('Cookie') ?? ''
  const hasCookie = /(?:^|;\s*)wc_user=/.test(rawCookie)
  const user = await readSession(request)
  const wcMatch = rawCookie.match(/wc_user=([^;]*)/)
  const wcValue = wcMatch?.[1] ?? ''
  const shape = `len=${wcValue.length} hasDot=${wcValue.includes(".")} head=${wcValue.slice(0, 8)}`
  console.log(`[session] cookiePresent=${hasCookie} verified=${!!user}${user ? ` role=${user.role}` : ''} cookieCount=${(rawCookie.match(/wc_user=/g) || []).length} ${shape}`)
  return Response.json({ user })
}
