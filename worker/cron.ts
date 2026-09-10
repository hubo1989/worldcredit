// worker/cron.ts — Scheduled handler for daily bill reminders + notification scan
// Deployed as part of the main Worker (cron trigger in wrangler.jsonc)

interface CronEnv {
  DB: D1Database
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
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
}

export async function handleScheduled(_event: ScheduledEvent, env: CronEnv, _ctx: ExecutionContext): Promise<void> {
  console.log('[cron] Running daily notification scan...')

  const db = env.DB
  const today = new Date().toISOString().slice(0, 10)

  // 1. Get all unpaid/overdue bills with card + holder info
  const bills = await db.prepare(`
    SELECT b.id, b.card_id, b.bill_month, b.bill_amount, b.min_payment, b.due_date, b.status,
           ch.id AS holder_id, ch.created_by,
           cp.bank_name, cp.card_name
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

      if (daysUntil < 0 && pref.overdue_enabled === 1) {
        title = `已逾期：${bill.bank_name || ''} ${bill.card_name || ''}`
        body = `账单 ¥${bill.bill_amount} 已逾期 ${Math.abs(daysUntil)} 天`
      } else if (daysUntil >= 0 && daysUntil <= pref.due_days_before && pref.bill_due_enabled === 1) {
        if (daysUntil === 0) {
          title = `今天到期：${bill.bank_name || ''} ${bill.card_name || ''}`
          body = `账单 ¥${bill.bill_amount} 今天到期`
        } else {
          title = `${daysUntil}天后还款：${bill.bank_name || ''} ${bill.card_name || ''}`
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
        await sendPushToSubscriptions(userSubs, title, body)
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
  subs: { endpoint: string; p256dh: string; auth: string }[],
  title: string,
  body: string
): Promise<void> {
  const payload = JSON.stringify({ title, body })
  // Web Push requires VAPID keys and web-push library.
  // For now, log and mark as sent. TODO(Phase-4): integrate web-push with VAPID.
  console.log(`[cron] Would send push to ${subs.length} subscription(s): ${title}`)
}
