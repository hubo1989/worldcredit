// lib/api/preferences.shared.ts — pure preference defaults shared by the
// server implementation and the client wrappers (no database imports).
import type { UserDisplayConfig, UserReminderConfig } from '../types'
import { normalizeCurrencyOrDefault } from '../fx'
import {
  DEFAULT_ACTIVITY_DAYS,
  DEFAULT_NOTIFICATION_ITEM_SWITCHES,
  DEFAULT_TASK_DAYS,
} from '../notifications.shared'

export const DEFAULT_DISPLAY_CONFIG: UserDisplayConfig = {
  privacy_mode: false,
  show_min_payment: true,
  show_statement_date: true,
  show_annual_fee: true,
  show_card_last4: true,
  default_currency: 'CNY',
}

export const DEFAULT_REMINDER_CONFIG: UserReminderConfig = {
  remind_days_before: [3, 1, 0],
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  enabled_channels: ['web_push'],
  items: { ...DEFAULT_NOTIFICATION_ITEM_SWITCHES },
  opportunities: {
    enabled: true,
    web_push_enabled: true,
    time_zone: 'Asia/Shanghai',
    local_time: '09:00',
    expiry_days_before: [3, 1, 0],
    activity_days_before: [...DEFAULT_ACTIVITY_DAYS],
    claim_days_before: [3, 1, 0],
    task_days_before: [...DEFAULT_TASK_DAYS],
    reset_enabled: true,
    booking_enabled: true,
  },
}

/**
 * 解析用户的折算目标币种（display_config.default_currency）。
 *
 * 该字段此前只被声明、从未被消费；多币种折算把它用起来。偏好损坏或读到非法值时
 * 回落 CNY，这是全应用原本隐含的展示币种。
 */
export function resolveDisplayCurrency(displayConfig?: Partial<UserDisplayConfig> | null): string {
  return normalizeCurrencyOrDefault(displayConfig?.default_currency, 'CNY')
}
