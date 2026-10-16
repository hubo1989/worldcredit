import { queryOne, execute, uuid, now } from '../db'
import type { UserPreferences, UserDisplayConfig, UserReminderConfig } from '../types'
import { DEFAULT_DISPLAY_CONFIG, DEFAULT_REMINDER_CONFIG } from './preferences.shared'
import { mergeOpportunityReminderConfig } from '../opportunities/reminders'

export { DEFAULT_DISPLAY_CONFIG, DEFAULT_REMINDER_CONFIG }

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
  const stored = JSON.parse(data.reminder_config) as UserReminderConfig
  return {
    user_id: userId,
    display_config: { ...DEFAULT_DISPLAY_CONFIG, ...JSON.parse(data.display_config) },
    reminder_config: {
      ...DEFAULT_REMINDER_CONFIG,
      ...stored,
      // Task 14：opportunities 子树深合并默认值——只写偏好中的字段，其余回落
      // 默认；损坏子树在读时显式抛错，绝不静默关闭提醒。
      opportunities: mergeOpportunityReminderConfig(stored.opportunities ?? null),
    },
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
  // 更新只覆盖给出字段；opportunities 子树整体替换（客户端提交完整子树，
  // 服务端在读取时再深合并默认值并校验）。
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
