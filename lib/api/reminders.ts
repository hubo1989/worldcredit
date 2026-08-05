// lib/api/reminders.ts
import { db } from '../insforge'
import { calculateReminders, type Reminder, type ReminderType } from '../reminders'

export interface ReminderFilters {
  holderId?: string
  cardId?: string
  type?: ReminderType
  status?: 'unread' | 'read' | 'dismissed'
}

/**
 * Get reminders with optional filters
 */
export async function getReminders(
  userId: string,
  role: 'admin' | 'member',
  managedHolderIds: string[] | undefined,
  filters: ReminderFilters = {}
): Promise<Reminder[]> {
  // Calculate all reminders
  const allReminders = await calculateReminders(userId, role, managedHolderIds)

  // Get user's reminder states
  const { data: states, error } = await db
    .from('reminder_states')
    .select('reminder_key, status')
    .eq('user_id', userId)

  if (error) throw error

  // Create maps for quick lookup
  const readKeys = new Set(states?.filter(s => s.status === 'read').map(s => s.reminder_key) || [])
  const dismissedKeys = new Set(states?.filter(s => s.status === 'dismissed').map(s => s.reminder_key) || [])

  // Filter reminders based on status
  let filtered = allReminders.filter(reminder => {
    const isRead = readKeys.has(reminder.key)
    const isDismissed = dismissedKeys.has(reminder.key)

    if (filters.status === 'unread' && (isRead || isDismissed)) return false
    if (filters.status === 'read' && !isRead) return false
    if (filters.status === 'dismissed' && !isDismissed) return false

    return true
  })

  // Apply additional filters
  if (filters.holderId) {
    filtered = filtered.filter(r => {
      // Parse holder from reminder key or need to add holderId to Reminder interface
      // For now, we'll skip this filter as it would require schema change
      return true
    })
  }

  if (filters.cardId) {
    filtered = filtered.filter(r => r.actionUrl.includes(`/cards/${filters.cardId}`))
  }

  if (filters.type) {
    filtered = filtered.filter(r => r.type === filters.type)
  }

  return filtered
}

/**
 * Mark a reminder as read
 */
export async function markReminderRead(userId: string, reminderKey: string): Promise<void> {
  const { error } = await db
    .from('reminder_states')
    .upsert({
      user_id: userId,
      reminder_key: reminderKey,
      status: 'read',
    }, {
      onConflict: 'user_id,reminder_key',
    })

  if (error) throw error
}

/**
 * Dismiss a reminder
 */
export async function dismissReminder(userId: string, reminderKey: string): Promise<void> {
  const { error } = await db
    .from('reminder_states')
    .upsert({
      user_id: userId,
      reminder_key: reminderKey,
      status: 'dismissed',
    }, {
      onConflict: 'user_id,reminder_key',
    })

  if (error) throw error
}

/**
 * Undismiss a reminder (remove dismissed state)
 */
export async function undismissReminder(userId: string, reminderKey: string): Promise<void> {
  const { error } = await db
    .from('reminder_states')
    .delete()
    .eq('user_id', userId)
    .eq('reminder_key', reminderKey)
    .eq('status', 'dismissed')

  if (error) throw error
}

/**
 * Mark multiple reminders as read
 */
export async function markRemindersRead(userId: string, reminderKeys: string[]): Promise<void> {
  if (reminderKeys.length === 0) return

  const { error } = await db
    .from('reminder_states')
    .upsert(
      reminderKeys.map(key => ({
        user_id: userId,
        reminder_key: key,
        status: 'read',
      })),
      { onConflict: 'user_id,reminder_key' }
    )

  if (error) throw error
}

/**
 * Dismiss multiple reminders
 */
export async function dismissReminders(userId: string, reminderKeys: string[]): Promise<void> {
  if (reminderKeys.length === 0) return

  const { error } = await db
    .from('reminder_states')
    .upsert(
      reminderKeys.map(key => ({
        user_id: userId,
        reminder_key: key,
        status: 'dismissed',
      })),
      { onConflict: 'user_id,reminder_key' }
    )

  if (error) throw error
}
