import { db } from '../insforge'
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

/**
 * 获取当前用户的个性化偏好配置（如无记录则返回默认值）
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch user preferences:', error)
    return {
      user_id: userId,
      display_config: DEFAULT_DISPLAY_CONFIG,
      reminder_config: DEFAULT_REMINDER_CONFIG
    }
  }

  if (!data) {
    return {
      user_id: userId,
      display_config: DEFAULT_DISPLAY_CONFIG,
      reminder_config: DEFAULT_REMINDER_CONFIG
    }
  }

  return {
    ...data,
    display_config: { ...DEFAULT_DISPLAY_CONFIG, ...data.display_config },
    reminder_config: { ...DEFAULT_REMINDER_CONFIG, ...data.reminder_config }
  }
}

/**
 * 更新保存用户的个性化偏好配置
 */
export async function updateUserPreferences(
  userId: string,
  updates: {
    display_config?: Partial<UserDisplayConfig>
    reminder_config?: Partial<UserReminderConfig>
  }
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId)

  const updatedDisplay: UserDisplayConfig = {
    ...current.display_config,
    ...(updates.display_config || {})
  }

  const updatedReminder: UserReminderConfig = {
    ...current.reminder_config,
    ...(updates.reminder_config || {})
  }

  const payload = {
    user_id: userId,
    display_config: updatedDisplay,
    reminder_config: updatedReminder,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await db
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) throw error
  return data
}
