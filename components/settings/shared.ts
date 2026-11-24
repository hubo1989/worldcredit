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

export interface TimezoneOption {
  value: string
  name: string
}

export const TIMEZONE_PRESETS: TimezoneOption[] = [
  { value: 'Asia/Shanghai', name: '中国标准时间' },
  { value: 'Asia/Hong_Kong', name: '香港时间' },
  { value: 'Asia/Tokyo', name: '日本标准时间' },
  { value: 'Asia/Singapore', name: '新加坡时间' },
  { value: 'America/New_York', name: '美东时间' },
  { value: 'America/Los_Angeles', name: '美西时间' },
  { value: 'Europe/London', name: '伦敦时间' },
  { value: 'Australia/Sydney', name: '悉尼时间' },
]

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

function parseMinutesOfDay(hhmm: string | undefined): number | null {
  if (!hhmm) return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * 判断每日推送时间是否落入免打扰时段（支持跨午夜如 22:00–08:00）。
 */
export function isTimeInQuietHours(
  localTime: string | undefined,
  quietStart: string | undefined,
  quietEnd: string | undefined
): boolean {
  const t = parseMinutesOfDay(localTime ?? '09:00')
  const start = parseMinutesOfDay(quietStart)
  const end = parseMinutesOfDay(quietEnd)
  if (t === null || start === null || end === null || start === end) return false
  if (start > end) {
    return t >= start || t < end
  }
  return t >= start && t < end
}

