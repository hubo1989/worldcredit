// app/api/push/test/route.ts — send a test Web Push to the signed-in user's
// subscriptions, for end-to-end verification of the VAPID setup.

import webpush from 'web-push'
import { getDb } from '@/lib/db'
import { getWorkerEnv } from '@/lib/db/client'
import { readSession } from '@/lib/session'
import { getLocalTodayString } from '@/lib/utils'

async function sessionUserId(request: Request): Promise<string | null> {
  const session = await readSession(request)
  return session?.id ?? null
}

export async function POST(request: Request) {
  const userId = await sessionUserId(request)
  if (!userId) return Response.json({ error: '未登录' }, { status: 401 })

  const env = getWorkerEnv()
  const publicKey = env.VAPID_PUBLIC_KEY
  const privateKey = env.VAPID_PRIVATE_KEY
  if (typeof publicKey !== 'string' || typeof privateKey !== 'string') {
    return Response.json({ error: '推送未配置（缺少 VAPID 密钥）' }, { status: 503 })
  }
  webpush.setVapidDetails(
    typeof env.VAPID_SUBJECT === 'string' ? env.VAPID_SUBJECT : 'mailto:admin@worldcredit.app',
    publicKey,
    privateKey
  )

  const db = getDb()
  const { results } = await db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>()
  const subs = results || []
  if (subs.length === 0) {
    return Response.json({ error: '当前用户没有推送订阅，请先在浏览器开启通知' }, { status: 404 })
  }

  const payload = JSON.stringify({
    title: 'WorldCredit 测试推送',
    body: '推送通道已就绪 ✅ 到期提醒将按时送达。',
    url: '/bills',
  })
  let sent = 0
  const staleIds: string[] = []
  const errors: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 3600 }
      )
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        staleIds.push(sub.id)
      } else {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
  }
  for (const id of staleIds) {
    await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run()
  }
  if (sent > 0) {
    const ts = new Date().toISOString()
    const todayStr = getLocalTodayString('Asia/Shanghai')
    try {
      await db
        .prepare(
          `INSERT INTO notification_history
             (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status, push_sent_at)
           VALUES (?, ?, ?, 'system', ?, ?, '/notifications', ?, ?, 'sent', ?)
           ON CONFLICT(user_id, notification_key) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             metadata_json = excluded.metadata_json,
             sent_at = excluded.sent_at,
             status = 'sent',
             push_sent_at = excluded.push_sent_at,
             -- 测试推送由用户在设置页显式触发，有意重置同日记录阅读/删除状态；勿复制到 Cron 路径
             read_at = NULL,
             deleted_at = NULL`
        )
        .bind(
          crypto.randomUUID(),
          userId,
          `test:${todayStr}`,
          'WorldCredit 测试推送',
          '推送通道已就绪 ✅ 到期提醒将按时送达。',
          JSON.stringify({ kind: 'system_test', sent }),
          ts,
          ts
        )
        .run()
    } catch (err) {
      console.warn('[push/test] failed to record notification_history:', err)
    }
  }
  return Response.json({ data: { subscriptions: subs.length, sent, removed: staleIds.length, errors }, error: null })
}
