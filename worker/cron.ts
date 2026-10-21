// worker/cron.ts — Scheduled handler for daily bill reminders + notification scan
// Deployed as part of the main Worker (cron trigger in wrangler.jsonc)

import webpush from 'web-push'
import { getLocalTodayString } from '../lib/utils'

interface CronEnv {
  DB: D1Database
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

interface BillWithCard {
  id: string
  card_id: string
  bill_month: string
  bill_amount: number
  min_payment: number | null
  due_date: string
  status: string
  holder_id: string
  created_by: string
  bank_name: string | null
  card_name: string | null
  /** 卡级别名称覆盖（NULL = 使用卡产品默认名称）。 */
  name_override: string | null
}

export async function handleScheduled(_event: ScheduledEvent, env: CronEnv, _ctx: ExecutionContext): Promise<void> {
  console.log('[cron] Running daily notification scan...')

  const db = env.DB
  const today = getLocalTodayString('Asia/Shanghai')

  // 1. Get all unpaid/overdue bills with card + holder info
  const bills = await db.prepare(`
    SELECT b.id, b.card_id, b.bill_month,
           COALESCE(b.bill_amount_override, b.bill_amount) AS bill_amount,
           b.min_payment, b.due_date, b.status,
           ch.id AS holder_id, ch.created_by,
           cp.bank_name, cp.card_name, cc.name_override
    FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    LEFT JOIN card_products cp ON cc.card_product_id = cp.id
    WHERE b.status IN ('unpaid', 'partial', 'overdue')
  `).all<BillWithCard>()
  const allBills = bills.results || []

  // 2. Get all notification preferences
  const prefs = await db.prepare(
    'SELECT user_id, bill_due_enabled, overdue_enabled, due_days_before FROM notification_preferences'
  ).all<{ user_id: string; bill_due_enabled: number; overdue_enabled: number; due_days_before: number }>()
  const allPrefs = prefs.results || []

  if (!allPrefs.length || !allBills.length) {
    console.log('[cron] No preferences or no bills. Done.')
    return
  }

  // 3. Get all push subscriptions
  const subs = await db.prepare(
    'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions'
  ).all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>()
  const subscriptions = subs.results || []
  if (!subscriptions.length) {
    console.log('[cron] No push subscriptions.')
    return
  }

  // 4. Process each user
  let sentCount = 0
  for (const pref of allPrefs) {
    const userId = pref.user_id
    const userSubs = subscriptions.filter(s => s.user_id === userId)
    if (!userSubs.length) continue

    for (const bill of allBills) {
      // Skip bills not belonging to this user
      if (bill.created_by !== userId) continue
      if (bill.status === 'paid') continue

      const dueDate = new Date(bill.due_date)
      const todayDate = new Date(today)
      const daysUntil = Math.ceil((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))

      let title: string | null = null
      let body: string | null = null
      const notificationKey = `bill:${bill.id}:${today}`
      // 修改内容优先：卡级别名称覆盖 > 卡产品默认名称
      const cardName = bill.name_override || bill.card_name || ''

      if (daysUntil < 0 && pref.overdue_enabled === 1) {
        title = `已逾期：${bill.bank_name || ''} ${cardName}`
        body = `账单 ¥${bill.bill_amount} 已逾期 ${Math.abs(daysUntil)} 天`
      } else if (daysUntil >= 0 && daysUntil <= pref.due_days_before && pref.bill_due_enabled === 1) {
        if (daysUntil === 0) {
          title = `今天到期：${bill.bank_name || ''} ${cardName}`
          body = `账单 ¥${bill.bill_amount} 今天到期`
        } else {
          title = `${daysUntil}天后还款：${bill.bank_name || ''} ${cardName}`
          body = `账单 ¥${bill.bill_amount} ${daysUntil}天后到期`
        }
      }

      if (!title || !body) continue

      // 5. Check dedup
      const existing = await db.prepare(
        'SELECT id FROM notification_history WHERE user_id = ? AND notification_key = ?'
      ).bind(userId, notificationKey).first()
      if (existing) continue

      // 6. Send push notification
      try {
        const { staleIds } = await sendPushToSubscriptions(env, userSubs, title, body)
        // Drop subscriptions the push service reports as gone (404/410).
        for (const id of staleIds) {
          await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run()
        }
        await db.prepare(
          'INSERT INTO notification_history (id, user_id, notification_key, title, body, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), userId, notificationKey, title, body, 'sent').run()
        sentCount++
      } catch (err) {
        console.error(`[cron] Failed to send notification for bill ${bill.id}:`, err)
        await db.prepare(
          'INSERT INTO notification_history (id, user_id, notification_key, title, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), userId, notificationKey, title, body, 'failed', err instanceof Error ? err.message : String(err)).run()
      }
    }
  }

  console.log(`[cron] Notification scan complete. Sent ${sentCount} notifications.`)
}

async function sendPushToSubscriptions(
  env: CronEnv,
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
  title: string,
  body: string
): Promise<{ sent: number; staleIds: string[] }> {
  const publicKey = env.VAPID_PUBLIC_KEY
  const privateKey = env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys not configured (npx wrangler secret put VAPID_PRIVATE_KEY)')
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@worldcredit.app', publicKey, privateKey)

  const payload = JSON.stringify({ title, body, url: '/bills' })
  let sent = 0
  const staleIds: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 }
      )
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        // Subscription expired or removed — let the caller clean it up.
        staleIds.push(sub.id)
      } else {
        throw err
      }
    }
  }
  return { sent, staleIds }
}
