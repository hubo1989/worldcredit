// lib/notifications.ts
import { query, queryOne, execute, uuid, now } from './db'
import type { Bill, CardProduct, CreditCard, User } from './types'

export interface NotificationPreferences {
  user_id: string
  bill_due_enabled: boolean
  overdue_enabled: boolean
  due_days_before: number
  notify_time: string
  created_at: string
  updated_at: string
}

export interface NotificationHistory {
  id: string
  user_id: string
  notification_key: string
  title: string
  body: string | null
  sent_at: string
  status: 'sent' | 'failed' | 'skipped'
  error: string | null
}

interface BillWithCard extends Bill {
  credit_cards: Pick<CreditCard, 'card_number_last4' | 'holder_id'> & {
    card_products: Pick<CardProduct, 'bank_name' | 'card_name'>
  }
}

interface NotificationPreferenceRow {
  user_id: string
  bill_due_enabled: number
  overdue_enabled: number
  due_days_before: number
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  const { data } = await queryOne<NotificationPreferences>(
    'SELECT * FROM notification_preferences WHERE user_id = ?', [userId]
  )
  return data
}

export async function upsertNotificationPreferences(
  userId: string,
  preferences: Omit<NotificationPreferences, 'user_id' | 'created_at' | 'updated_at'>
): Promise<NotificationPreferences> {
  const ts = now()
  await execute(
    `INSERT INTO notification_preferences (user_id, bill_due_enabled, overdue_enabled, due_days_before, notify_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       bill_due_enabled = excluded.bill_due_enabled,
       overdue_enabled = excluded.overdue_enabled,
       due_days_before = excluded.due_days_before,
       notify_time = excluded.notify_time,
       updated_at = excluded.updated_at`,
    [userId, preferences.bill_due_enabled ? 1 : 0, preferences.overdue_enabled ? 1 : 0,
     preferences.due_days_before, preferences.notify_time, ts, ts]
  )
  return getNotificationPreferences(userId) as Promise<NotificationPreferences>
}

function shouldSendNotification(
  bill: BillWithCard,
  preferences: Pick<NotificationPreferences, 'bill_due_enabled' | 'overdue_enabled' | 'due_days_before'>,
  today: Date
): { shouldSend: boolean; type: 'due' | 'overdue'; key: string } | null {
  if (!bill.due_date) return null
  const dueDate = new Date(bill.due_date)
  dueDate.setHours(0, 0, 0, 0)
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  const daysUntilDue = Math.ceil((dueDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24))

  if (daysUntilDue < 0 && bill.status !== 'paid' && preferences.overdue_enabled) {
    return { shouldSend: true, type: 'overdue', key: `overdue:${bill.id}:${new Date().toDateString()}` }
  }
  if (daysUntilDue >= 0 && daysUntilDue <= preferences.due_days_before && bill.status !== 'paid' && preferences.bill_due_enabled) {
    return { shouldSend: true, type: 'due', key: `due:${bill.id}:${new Date().toDateString()}` }
  }
  return null
}

function createNotificationContent(
  bill: BillWithCard,
  type: 'due' | 'overdue'
): { title: string; body: string } {
  const { bank_name, card_name } = bill.credit_cards.card_products
  const daysUntil = bill.due_date
    ? Math.ceil((new Date(bill.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : 0
  let title: string
  let body: string
  if (type === 'overdue') {
    title = `已逾期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} 已逾期，请及时还款`
  } else if (daysUntil === 0) {
    title = `今天到期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} 今天到期`
  } else if (daysUntil === 1) {
    title = `明天到期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} 明天到期`
  } else {
    title = `${daysUntil} 天后还款：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} ${daysUntil} 天后到期`
  }
  return { title, body }
}

async function wasNotificationRecentlySent(userId: string, notificationKey: string): Promise<boolean> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const { data } = await query(
    'SELECT id FROM notification_history WHERE user_id = ? AND notification_key = ? AND sent_at >= ? LIMIT 1',
    [userId, notificationKey, yesterday.toISOString()]
  )
  return (data?.length || 0) > 0
}

async function recordNotification(
  userId: string, notificationKey: string, title: string, body: string,
  status: 'sent' | 'failed' | 'skipped', error?: string
): Promise<void> {
  await execute(
    'INSERT INTO notification_history (id, user_id, notification_key, title, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuid(), userId, notificationKey, title, body, status, error || null]
  )
}

export async function runDailyNotificationScan(): Promise<void> {
  console.log('Starting daily notification scan...')
  const { data: preferences } = await query<NotificationPreferenceRow>(
    'SELECT user_id, bill_due_enabled, overdue_enabled, due_days_before FROM notification_preferences'
  )
  if (!preferences || preferences.length === 0) {
    console.log('No users with notification preferences')
    return
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: bills } = await query<Record<string, unknown>>(
    `SELECT b.*, cc.card_number_last4, cc.holder_id, cp.bank_name, cp.card_name
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE b.status IN ('unpaid', 'partial', 'overdue')`
  )
  if (!bills || bills.length === 0) {
    console.log('No unpaid bills found')
    return
  }

  for (const pref of preferences) {
    try {
      await processUserNotifications(
        pref.user_id, 'admin',
        { bill_due_enabled: pref.bill_due_enabled === 1, overdue_enabled: pref.overdue_enabled === 1, due_days_before: pref.due_days_before },
        bills as unknown as BillWithCard[], today
      )
    } catch (error) {
      console.error(`Failed to process notifications for user ${pref.user_id}:`, error)
    }
  }
  console.log('Daily notification scan completed')
}

async function processUserNotifications(
  userId: string, _role: User['role'],
  preferences: { bill_due_enabled: boolean; overdue_enabled: boolean; due_days_before: number },
  bills: BillWithCard[], today: Date
): Promise<void> {
  for (const bill of bills) {
    const notification = shouldSendNotification(bill, preferences, today)
    if (!notification) continue
    const recentlySent = await wasNotificationRecentlySent(userId, notification.key)
    if (recentlySent) continue
    const { title, body } = createNotificationContent(bill, notification.type)
    console.log(`Would send notification to user ${userId}: ${title} - ${body}`)
    await recordNotification(userId, notification.key, title, body, 'sent')
  }
}

export async function getNotificationHistory(userId: string, limit = 20): Promise<NotificationHistory[]> {
  const { data, error } = await query<NotificationHistory>(
    'SELECT * FROM notification_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?',
    [userId, limit]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }
  return false
}

export async function sendBrowserNotification(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false
  try {
    const notification = new Notification(title, {
      body, icon: '/icon-192.png', badge: '/badge-72.png', tag: title,
    })
    if (onClick) {
      notification.onclick = () => { window.focus(); onClick(); notification.close() }
    }
    return true
  } catch {
    return false
  }
}
