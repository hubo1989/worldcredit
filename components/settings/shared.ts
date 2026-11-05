import type { UserReminderConfig } from '@/lib/types'

export interface CurrencyOption {
  value: string
  label: string
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'CNY', label: 'CNY · 人民币 (¥)' },
  { value: 'USD', label: 'USD · 美元 ($)' },
  { value: 'HKD', label: 'HKD · 港币 (HK$)' },
  { value: 'JPY', label: 'JPY · 日元 (円)' },
  { value: 'EUR', label: 'EUR · 欧元 (€)' },
  { value: 'GBP', label: 'GBP · 英镑 (£)' },
]

/**
 * 解析用户的有效提醒通道列表（含存量兼容口径与迁移回退）。
 *
 * 规则：
 * 1. 若显式配置了 enabled_channels，直接返回（用户显式配置为准）；
 * 2. 若未配置 enabled_channels（存量用户）：
 *    - 若旧 opportunities.web_push_enabled === false，迁移/解析为 []（不含 web_push，绝不重新开启）；
 *    - 若未配置或为 true，按旧语义默认开启 ['web_push']。
 */
export function resolveEffectiveChannels(
  config?: Partial<UserReminderConfig> | null
): ('web_push' | 'email' | 'webhook')[] {
  if (config?.enabled_channels !== undefined) {
    return config.enabled_channels
  }
  if (config?.opportunities?.web_push_enabled === false) {
    return []
  }
  return ['web_push']
}

export function isWebPushChannelEnabled(
  config?: Partial<UserReminderConfig> | null
): boolean {
  return resolveEffectiveChannels(config).includes('web_push')
}

/**
 * 动态根据夏令时 (DST) 与当前时间生成时区选项文案。
 */
export function formatTimezoneOptionLabel(
  tz: string,
  standardName: string,
  date: Date = new Date()
): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
    const tzPart = dtf.formatToParts(date).find((p) => p.type === 'timeZoneName')
    const offset = tzPart ? tzPart.value.replace('GMT', 'UTC') : ''
    return offset ? `${tz} (${standardName} ${offset})` : `${tz} (${standardName})`
  } catch {
    return `${tz} (${standardName})`
  }
}

