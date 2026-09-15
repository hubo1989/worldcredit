// app/api/push/public-key/route.ts — the VAPID public key is public by
// definition and served at runtime so the PWA can subscribe without a rebuild.

import { getWorkerEnv } from '@/lib/db/client'

export async function GET() {
  const env = getWorkerEnv()
  const publicKey = typeof env.VAPID_PUBLIC_KEY === 'string' ? env.VAPID_PUBLIC_KEY : undefined
  if (!publicKey) {
    return Response.json({ error: '推送未配置' }, { status: 503 })
  }
  return Response.json(
    { publicKey },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
