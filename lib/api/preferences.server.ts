import { queryOne, execute, uuid, now } from '../db'
import type { UserPreferences, UserDisplayConfig, UserReminderConfig } from '../types'
import {
  DEFAULT_DISPLAY_CONFIG,
  DEFAULT_REMINDER_CONFIG,
  DEFAULT_IMPORT_CONFIG,
  normalizeImportConfig,
  type UserImportConfig,
} from './preferences.shared'
import { tableColumns } from './schema-columns.server'
import { normalizeMissingStatementGraceDays } from '../missing-statement'
import { mergeOpportunityReminderConfig } from '../opportunities/reminders'
import {
  resolveNotificationSwitches,
  syncItemSwitchesWithOpportunities,
} from '../notifications.shared'

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
  const mergedOpp = mergeOpportunityReminderConfig(stored.opportunities ?? null)
  const mergedItems = resolveNotificationSwitches({
    ...stored,
    opportunities: mergedOpp,
  })
  return {
    user_id: userId,
    display_config: { ...DEFAULT_DISPLAY_CONFIG, ...JSON.parse(data.display_config) },
    reminder_config: {
      ...DEFAULT_REMINDER_CONFIG,
      ...stored,
      missing_statement_grace_days: normalizeMissingStatementGraceDays(
        stored.missing_statement_grace_days,
      ),
      items: mergedItems,
      // Task 14：opportunities 子树深合并默认值——只写偏好中的字段，其余回落
      // 默认；损坏子树在读时显式抛错，绝不静默关闭提醒。
      opportunities: mergedOpp,
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
  const incomingReminder = updates.reminder_config || {}

  // 合并 items，并保持 items.opportunity_reset/booking 与 opportunities.reset_enabled/booking_enabled 双向一致
  const { items: mergedItems, opportunities: mergedOpp } = syncItemSwitchesWithOpportunities(
    current.reminder_config,
    incomingReminder
  )

  // 更新只覆盖给出字段；opportunities 子树保留既有未传入字段。
  const rawGraceDays =
    incomingReminder.missing_statement_grace_days !== undefined
      ? incomingReminder.missing_statement_grace_days
      : current.reminder_config.missing_statement_grace_days
  const updatedReminder: UserReminderConfig = {
    ...current.reminder_config,
    ...incomingReminder,
    missing_statement_grace_days: normalizeMissingStatementGraceDays(rawGraceDays),
    items: mergedItems,
    opportunities: mergedOpp,
  }

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


// ─── 邮件自动入账偏好（import_config，HUB-154 §2.2 / §3.3(4)）───────────────

export interface UserImportPreferences {
  user_id: string
  import_config: UserImportConfig
}

export async function getUserImportPreferences(userId: string): Promise<UserImportPreferences> {
  if (!userId) return { user_id: '', import_config: { ...DEFAULT_IMPORT_CONFIG } }
  const columns = await tableColumns('user_preferences')
  if (!columns.has('import_config')) {
    return { user_id: userId, import_config: { ...DEFAULT_IMPORT_CONFIG } }
  }
  const { data, error } = await queryOne<{ import_config: string | null }>(
    'SELECT import_config FROM user_preferences WHERE user_id = ?',
    [userId],
  )
  if (error) throw new Error(error.message)
  return {
    user_id: userId,
    import_config: normalizeImportConfig(data?.import_config),
  }
}

/**
 * 只写 import_config：display_config 与 reminder_config 原样保留，
 * 避免「改一个自动入账开关把提醒时间冲回默认值」。
 */
export async function updateUserImportPreferences(
  userId: string,
  updates: Partial<UserImportConfig>,
): Promise<UserImportPreferences> {
  if (!userId) throw new Error('未登录，无法保存导入偏好')
  const columns = await tableColumns('user_preferences')
  if (!columns.has('import_config')) {
    // 0035 未落地：静默返回默认值，绝不写坏其它两块配置。
    return { user_id: userId, import_config: { ...DEFAULT_IMPORT_CONFIG } }
  }
  const current = await getUserImportPreferences(userId)
  const next: UserImportConfig = {
    auto_commit_trusted_email:
      typeof updates.auto_commit_trusted_email === 'boolean'
        ? updates.auto_commit_trusted_email
        : current.import_config.auto_commit_trusted_email,
  }

  const existing = await queryOne('SELECT id FROM user_preferences WHERE user_id = ?', [userId])
  if (existing.data) {
    const { error } = await execute(
      'UPDATE user_preferences SET import_config = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(next), now(), userId],
    )
    if (error) throw new Error(error.message)
  } else {
    const { error } = await execute(
      `INSERT INTO user_preferences
         (id, user_id, display_config, reminder_config, import_config, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        userId,
        JSON.stringify(DEFAULT_DISPLAY_CONFIG),
        JSON.stringify(DEFAULT_REMINDER_CONFIG),
        JSON.stringify(next),
        now(),
      ],
    )
    if (error) throw new Error(error.message)
  }
  return { user_id: userId, import_config: next }
}
