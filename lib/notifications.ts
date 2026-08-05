// lib/notifications.ts
import { db } from './insforge'
import type { Bill, CreditCard, User } from './types'

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
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'>
}

interface NotificationPreferenceRow {
  user_id: string
  bill_due_enabled: boolean
  overdue_enabled: boolean
  due_days_before: number
  users: Pick<User, 'id' | 'role'> | Array<Pick<User, 'id' | 'role'>> | null
}

/**
 * Get notification preferences for a user
 */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  const { data, error } = await db
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
  return data
}

/**
 * Create or update notification preferences
 */
export async function upsertNotificationPreferences(
  userId: string,
  preferences: Omit<NotificationPreferences, 'user_id' | 'created_at' | 'updated_at'>
): Promise<NotificationPreferences> {
  const { data, error } = await db
    .from('notification_preferences')
    .upsert({
      user_id: userId,
      ...preferences,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Check if notifications should be sent for a bill
 */
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

  // Check for overdue
  if (daysUntilDue < 0 && bill.status !== 'paid' && preferences.overdue_enabled) {
    return {
      shouldSend: true,
      type: 'overdue',
      key: `overdue:${bill.id}:${new Date().toDateString()}`,
    }
  }

  // Check for due soon
  if (daysUntilDue >= 0 && daysUntilDue <= preferences.due_days_before && bill.status !== 'paid' && preferences.bill_due_enabled) {
    return {
      shouldSend: true,
      type: 'due',
      key: `due:${bill.id}:${new Date().toDateString()}`,
    }
  }

  return null
}

/**
 * Create notification title and body
 */
function createNotificationContent(
  bill: BillWithCard,
  type: 'due' | 'overdue'
): { title: string; body: string } {
  const { bank_name, card_name, currency } = bill.credit_cards
  const daysUntil = bill.due_date
    ? Math.ceil((new Date(bill.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : 0

  let title: string
  let body: string

  if (type === 'overdue') {
    title = `已逾期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} ${currency} 已逾期，请及时还款`
  } else if (daysUntil === 0) {
    title = `今天到期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} ${currency} 今天到期`
  } else if (daysUntil === 1) {
    title = `明天到期：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} ${currency} 明天到期`
  } else {
    title = `${daysUntil} 天后还款：${bank_name} ${card_name}`
    body = `账单 ¥${bill.bill_amount} ${currency} ${daysUntil} 天后到期`
  }

  return { title, body }
}

/**
 * Check if notification was already sent recently (deduplication)
 */
async function wasNotificationRecentlySent(
  userId: string,
  notificationKey: string
): Promise<boolean> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const { data, error } = await db
    .from('notification_history')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_key', notificationKey)
    .gte('sent_at', yesterday.toISOString())
    .limit(1)

  if (error) throw error
  return (data?.length || 0) > 0
}

/**
 * Record notification in history
 */
async function recordNotification(
  userId: string,
  notificationKey: string,
  title: string,
  body: string,
  status: 'sent' | 'failed' | 'skipped',
  error?: string
): Promise<void> {
  const { error: insertError } = await db
    .from('notification_history')
    .insert({
      user_id: userId,
      notification_key: notificationKey,
      title,
      body,
      status,
      error: error || null,
    })

  if (insertError) console.error('Failed to record notification:', insertError)
}

/**
 * Daily scan worker - finds bills needing notification
 */
export async function dailyNotificationScan(): Promise<void> {
  console.log('Starting daily notification scan...')

  // Get all users with notification preferences
  const { data: preferences, error: prefError } = await db
    .from('notification_preferences')
    .select('user_id, bill_due_enabled, overdue_enabled, due_days_before, users(id, role)')

  if (prefError) {
    console.error('Failed to fetch notification preferences:', prefError)
    return
  }

  if (!preferences || preferences.length === 0) {
    console.log('No users with notification preferences')
    return
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Get all unpaid bills
  const { data: bills, error: billsError } = await db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, currency, holder_id)')
    .in('status', ['unpaid', 'partial', 'overdue'])

  if (billsError) {
    console.error('Failed to fetch bills:', billsError)
    return
  }

  if (!bills || bills.length === 0) {
    console.log('No unpaid bills found')
    return
  }

  // Process each user's preferences
  for (const pref of preferences as unknown as NotificationPreferenceRow[]) {
    const userProfile = Array.isArray(pref.users) ? pref.users[0] : pref.users
    if (!userProfile) continue

    try {
      await processUserNotifications(pref.user_id, userProfile.role, pref, bills as BillWithCard[], today)
    } catch (error) {
      console.error(`Failed to process notifications for user ${pref.user_id}:`, error)
    }
  }

  console.log('Daily notification scan completed')
}

/**
 * Process notifications for a single user
 */
async function processUserNotifications(
  userId: string,
  role: User['role'],
  preferences: { bill_due_enabled: boolean; overdue_enabled: boolean; due_days_before: number },
  bills: BillWithCard[],
  today: Date
): Promise<void> {
  const accessibleHolderIds = await getAccessibleHolderIds(userId, role)
  if (accessibleHolderIds.length === 0) return

  const accessibleHolderSet = new Set(accessibleHolderIds)
  const visibleBills = bills.filter(bill => accessibleHolderSet.has(bill.credit_cards.holder_id))

  // For each bill, check if notification should be sent
  for (const bill of visibleBills) {
    const notification = shouldSendNotification(bill, preferences, today)
    if (!notification) continue

    // Check for duplicates
    const recentlySent = await wasNotificationRecentlySent(userId, notification.key)
    if (recentlySent) {
      console.log(`Skipping duplicate notification ${notification.key} for user ${userId}`)
      continue
    }

    // Create notification content
    const { title, body } = createNotificationContent(bill, notification.type)

    // In a real implementation, this would trigger a service worker or push notification
    // For now, we'll just record it in history
    console.log(`Would send notification to user ${userId}: ${title} - ${body}`)

    await recordNotification(userId, notification.key, title, body, 'sent')
  }
}

async function getAccessibleHolderIds(userId: string, role: User['role']): Promise<string[]> {
  let query = db
    .from('card_holders')
    .select('id')

  query = role === 'member'
    ? query.eq('auth_user_id', userId)
    : query.eq('managed_by', userId)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map(holder => holder.id)
}

/**
 * Get notification history for a user
 */
export async function getNotificationHistory(
  userId: string,
  limit = 20
): Promise<NotificationHistory[]> {
  const { data, error } = await db
    .from('notification_history')
    .select('*')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

/**
 * Browser notification helper - request permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  return false
}

/**
 * Browser notification helper - send notification
 */
export async function sendBrowserNotification(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false
  }

  if (Notification.permission !== 'granted') {
    return false
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: title, // Prevents duplicate notifications
    })

    if (onClick) {
      notification.onclick = () => {
        window.focus()
        onClick()
        notification.close()
      }
    }

    return true
  } catch (error) {
    console.error('Failed to send browser notification:', error)
    return false
  }
}
