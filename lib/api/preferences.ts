import { query, queryOne, execute, uuid, now } from '../db'
import type { UserPreferences, UserDisplayConfig, UserReminderConfig } from '../types'

export const DEFAULT_DISPLAY_CONFIG: UserDisplayConfig = {
  privacy_mode: false,
  show_min_payment: true,
  show_statement_date: true,
  show_annual_fee: true,
  show_card_last4: true,
  default_currency: 'CNY'
}

export const DEFAULT_REMINDER_CONFIG: UserReminderConfig = {
  remind_days_before: [3, 1, 0],
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  enabled_channels: ['web_push']
}

interface PreferencesRow {
  id: string
  user_id: string
  display_config: string
  reminder_config: string
  updated_at: string
}

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const { data } = await queryOne<PreferencesRow>(
    'SELECT * FROM user_preferences WHERE user_id = ?',
    [userId]
  )
  if (!data) {
    return {
      user_id: userId,
      display_config: DEFAULT_DISPLAY_CONFIG,
      reminder_config: DEFAULT_REMINDER_CONFIG
    }
  }
  return {
    user_id: userId,
    display_config: { ...DEFAULT_DISPLAY_CONFIG, ...JSON.parse(data.display_config) },
    reminder_config: { ...DEFAULT_REMINDER_CONFIG, ...JSON.parse(data.reminder_config) }
  }
}

export async function updateUserPreferences(
  userId: string,
  updates: {
    display_config?: Partial<UserDisplayConfig>
    reminder_config?: Partial<UserReminderConfig>
  }
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId)
  const updatedDisplay = { ...current.display_config, ...(updates.display_config || {}) }
  const updatedReminder = { ...current.reminder_config, ...(updates.reminder_config || {}) }

  const existing = await queryOne('SELECT id FROM user_preferences WHERE user_id = ?', [userId])
  if (existing.data) {
    await execute(
      'UPDATE user_preferences SET display_config = ?, reminder_config = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(updatedDisplay), JSON.stringify(updatedReminder), now(), userId]
    )
  } else {
    await execute(
      'INSERT INTO user_preferences (id, user_id, display_config, reminder_config, updated_at) VALUES (?, ?, ?, ?, ?)',
      [uuid(), userId, JSON.stringify(updatedDisplay), JSON.stringify(updatedReminder), now()]
    )
  }
  return getUserPreferences(userId)
}
