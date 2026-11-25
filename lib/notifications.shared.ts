// lib/notifications.shared.ts — 通知中心与全通知项开关的纯类型、常量与日期计算（无 DB 依赖）。

import { currencySymbol } from './fx'
import type {
  CardProduct,
  NotificationCategory,
  NotificationItemSwitches,
  UserReminderConfig,
} from './types'

export const DEFAULT_ACTIVITY_DAYS: number[] = [7, 3, 1]
export const DEFAULT_TASK_DAYS: number[] = [3, 1, 0]

export interface NotificationBillMetadataItem {
  id: string
  subject: string
  remaining: number
  currency: string
  due_date: string
}

export interface NotificationPayableMetadataItem {
  id: string
  name: string
  category: string
  remaining: number
  currency: string
  due_date: string
}

export interface NotificationGraceCardMetadataItem {
  cardId: string
  label: string
  graceDays: number
  nextBillingDate: string
  nextDueDate: string
}

export interface NotificationMissingStatementMetadataItem {
  card_id: string
  account_id: string | null
  subject: string
  bill_month: string
  expected_statement_date: string
  days_past: number
  is_merged: boolean
}

export interface NotificationMetadata {
  kind?: string
  date?: string
  due_date?: string
  bill_id?: string
  card_id?: string
  annual_fee?: number
  annual_fee_status?: string
  roi_net_value?: number
  waiver_gap_text?: string
  payable_id?: string
  remaining?: number
  currency?: string
  days_until_due?: number
  days_overdue?: number
  totals_by_currency?: Record<string, number>
  bills?: NotificationBillMetadataItem[]
  payables?: NotificationPayableMetadataItem[]
  cards?: NotificationGraceCardMetadataItem[]
  missing_statements?: NotificationMissingStatementMetadataItem[]
  event_key?: string
  delivery_key?: string
  object_id?: string
}

export const DEFAULT_NOTIFICATION_ITEM_SWITCHES: NotificationItemSwitches = {
  bill_due_today: true,
  payable_due_today: true,
  bill_due_advance: true,
  payable_due_advance: true,
  bill_overdue: true,
  bill_missing_statement: true,
  grace_period_longest: true,
  annual_fee_decision: true,
  opportunity_expiry: true,
  opportunity_claim: true,
  opportunity_activity: true,
  opportunity_task: true,
  opportunity_reset: true,
  opportunity_booking: true,
}

export const NOTIFICATION_SWITCH_ITEMS: Array<{
  key: keyof NotificationItemSwitches
  group: 'bills' | 'opportunities'
  label: string
  description: string
}> = [
  {
    key: 'bill_due_today',
    group: 'bills',
    label: '当日待还信用卡账单',
    description: '每天汇总今天到期的未结清信用卡账单与待还总金额',
  },
  {
    key: 'payable_due_today',
    group: 'bills',
    label: '当日待还固定支出',
    description: '把房租、贷款等今日到期的固定支出纳入当日待还主动通知',
  },
  {
    key: 'grace_period_longest',
    group: 'bills',
    label: '今日新增最长免息期账单',
    description: '信用卡刚过账单日、今天进入本轮最长免息期时主动提醒',
  },
  {
    key: 'bill_due_advance',
    group: 'bills',
    label: '账单还款日前提前提醒',
    description: '按下方选定的提前天数提醒即将到期的信用卡账单',
  },
  {
    key: 'payable_due_advance',
    group: 'bills',
    label: '固定支出提前提醒',
    description: '按同样的提前天数提醒即将到期的固定支出',
  },
  {
    key: 'bill_overdue',
    group: 'bills',
    label: '逾期账单提醒',
    description: '账单或固定支出已过到期日仍未结清时每日提醒',
  },
  {
    key: 'bill_missing_statement',
    group: 'bills',
    label: '超期未获得账单提醒',
    description: '超过账单日宽限期仍未收到账单时每日提醒手动补充',
  },
  {
    key: 'annual_fee_decision',
    group: 'bills',
    label: '年费续卡决策',
    description: '在年费扣费前结合免年费进度与权益回报提醒续卡决策',
  },
  {
    key: 'opportunity_expiry',
    group: 'opportunities',
    label: '权益到期提醒',
    description: '按设定的提前天数提醒即将到期的可用权益',
  },
  {
    key: 'opportunity_claim',
    group: 'opportunities',
    label: '权益领取截止提醒',
    description: '提醒权益/优惠领取窗口开启与领取截止节点',
  },
  {
    key: 'opportunity_activity',
    group: 'opportunities',
    label: '优惠活动提醒',
    description: '按活动节点提醒即将开始或结束的银行优惠活动',
  },
  {
    key: 'opportunity_task',
    group: 'opportunities',
    label: '达标任务提醒',
    description: '提醒消费达标任务进度与任务截止日期',
  },
  {
    key: 'opportunity_reset',
    group: 'opportunities',
    label: '权益周期重置提醒',
    description: '周期权益新一期重置可再次使用时提醒',
  },
  {
    key: 'opportunity_booking',
    group: 'opportunities',
    label: '预约服务提醒',
    description: '已登记的权益预约服务临近时提醒',
  },
]

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { label: string; tone: 'danger' | 'gold' | 'accent' | 'muted' }
> = {
  bill_due_today: { label: '当日待还', tone: 'gold' },
  payable_due_today: { label: '固定支出', tone: 'gold' },
  bill_due_advance: { label: '即将到期', tone: 'accent' },
  payable_due_advance: { label: '支出提醒', tone: 'accent' },
  bill_overdue: { label: '已逾期', tone: 'danger' },
  bill_missing_statement: { label: '未收账单', tone: 'gold' },
  grace_period_longest: { label: '最长免息期', tone: 'gold' },
  annual_fee_decision: { label: '年费续卡决策', tone: 'gold' },
  opportunity_expiry: { label: '权益到期', tone: 'gold' },
  opportunity_claim: { label: '权益领取', tone: 'accent' },
  opportunity_activity: { label: '优惠活动', tone: 'accent' },
  opportunity_task: { label: '达标任务', tone: 'accent' },
  opportunity_reset: { label: '周期重置', tone: 'accent' },
  opportunity_booking: { label: '预约服务', tone: 'accent' },
  system: { label: '系统通知', tone: 'muted' },
}

export function resolveNotificationSwitches(
  config?: Partial<UserReminderConfig> | null
): NotificationItemSwitches {
  const rawItems = config?.items
  const opp = config?.opportunities

  const pick = (key: keyof NotificationItemSwitches, fallback = true): boolean => {
    const val = rawItems?.[key]
    return typeof val === 'boolean' ? val : fallback
  }

  return {
    bill_due_today: pick('bill_due_today'),
    payable_due_today: pick('payable_due_today'),
    bill_due_advance: pick('bill_due_advance'),
    payable_due_advance: pick('payable_due_advance'),
    bill_overdue: pick('bill_overdue'),
    bill_missing_statement: pick('bill_missing_statement'),
    grace_period_longest: pick('grace_period_longest'),
    annual_fee_decision: pick('annual_fee_decision'),
    opportunity_expiry: pick('opportunity_expiry'),
    opportunity_claim: pick('opportunity_claim'),
    opportunity_activity: pick('opportunity_activity'),
    opportunity_task: pick('opportunity_task'),
    opportunity_reset: pick('opportunity_reset', opp?.reset_enabled ?? true),
    opportunity_booking: pick('opportunity_booking', opp?.booking_enabled ?? true),
  }
}

export type OpportunitySwitchKey =
  | 'opportunity_expiry'
  | 'opportunity_claim'
  | 'opportunity_activity'
  | 'opportunity_task'
  | 'opportunity_reset'
  | 'opportunity_booking'

export function isOpportunitySwitchEnabled(
  config: Partial<UserReminderConfig> | null | undefined,
  key: OpportunitySwitchKey
): boolean {
  if (config?.opportunities?.enabled === false) return false
  return resolveNotificationSwitches(config)[key]
}

export function countEnabledNotificationItems(
  config?: Partial<UserReminderConfig> | null
): { enabled: number; total: number } {
  const switches = resolveNotificationSwitches(config)
  const oppGlobalOn = config?.opportunities?.enabled !== false
  let enabled = 0
  for (const item of NOTIFICATION_SWITCH_ITEMS) {
    if (item.group === 'opportunities' && !oppGlobalOn) continue
    if (switches[item.key]) enabled += 1
  }
  return { enabled, total: NOTIFICATION_SWITCH_ITEMS.length }
}

function parseHHMM(raw?: string | null): number | null {
  if (typeof raw !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 按指定时区判断当前是否落在免打扰时段内（支持跨午夜区间如 22:00 - 08:00）。 */
export function isInQuietHours(
  now: Date,
  timeZone = 'Asia/Shanghai',
  start?: string | null,
  end?: string | null
): boolean {
  const startMin = parseHHMM(start)
  const endMin = parseHHMM(end)
  if (startMin === null || endMin === null || startMin === endMin) return false

  const readClock = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
    return h * 60 + m
  }

  let currentMin: number
  try {
    currentMin = readClock(timeZone)
  } catch {
    currentMin = readClock('Asia/Shanghai')
  }

  if (startMin < endMin) {
    return currentMin >= startMin && currentMin < endMin
  }
  return currentMin >= startMin || currentMin < endMin
}

function parseCivilDate(dateStr: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

function daysInCivilMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
}

function formatCivilDate(year: number, month1Based: number, day: number): string {
  return `${year}-${String(month1Based).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shiftCivilMonths(year: number, month1Based: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month1Based - 1) + delta
  const nextYear = Math.floor(total / 12)
  const nextMonth = (((total % 12) + 12) % 12) + 1
  return { year: nextYear, month: nextMonth }
}

function addCivilDays(dateStr: string, days: number): string {
  const parsed = parseCivilDate(dateStr)
  if (!parsed) return dateStr
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
  return formatCivilDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/**
 * 判断今天是否为某张卡的「今日新增最长免息期日」（即昨天恰好为该卡当月实际账单日）。
 * 含小月 / 2 月月末钳制，例如 billing_day=31 在 2/28 的次日 3/1 触发。
 */
export function isNewLongestGracePeriodDay(billingDay: number, todayStr: string): boolean {
  const parsed = parseCivilDate(todayStr)
  if (!parsed) return false
  const clampedBillingDay =
    Number.isFinite(billingDay) && billingDay >= 1 ? Math.min(Math.trunc(billingDay), 31) : 10
  const yesterdayUtc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day - 1))
  const yYear = yesterdayUtc.getUTCFullYear()
  const yMonth = yesterdayUtc.getUTCMonth() + 1
  const yDay = yesterdayUtc.getUTCDate()
  const effectiveYesterdayBilling = Math.min(clampedBillingDay, daysInCivilMonth(yYear, yMonth))
  return yDay === effectiveYesterdayBilling
}

export interface GraceWindowCardInput {
  billing_day: number
  override_billing_day?: number | null
  override_due_type?: CardProduct['payment_due_type'] | null
  override_due_value?: number | null
  payment_due_type: CardProduct['payment_due_type']
  payment_due_value: number
}

/**
 * 纯日历日口径计算指定日期（todayStr = YYYY-MM-DD）刷卡的免息期与关键日期。
 * 与 lib/utils.ts 的 calculateCardGracePeriod 保持一致，但不依赖进程本地时区。
 */
export function computeCardGraceWindowOnDate(
  input: GraceWindowCardInput,
  todayStr: string
): { graceDays: number; nextBillingDate: string; nextDueDate: string } {
  const parsed = parseCivilDate(todayStr)
  if (!parsed) {
    return { graceDays: 1, nextBillingDate: todayStr, nextDueDate: todayStr }
  }
  const rawBilling = input.override_billing_day ?? input.billing_day ?? 10
  const billingDay =
    Number.isFinite(rawBilling) && rawBilling >= 1 ? Math.min(Math.trunc(rawBilling), 31) : 10
  const dueType =
    input.override_due_type != null && input.override_due_value != null
      ? input.override_due_type
      : input.payment_due_type
  const dueValue =
    input.override_due_type != null && input.override_due_value != null
      ? input.override_due_value
      : input.payment_due_value

  const thisMonthBillingDay = Math.min(billingDay, daysInCivilMonth(parsed.year, parsed.month))
  const purchaseYM =
    parsed.day > thisMonthBillingDay
      ? shiftCivilMonths(parsed.year, parsed.month, 1)
      : { year: parsed.year, month: parsed.month }

  const nextBillingDay = Math.min(billingDay, daysInCivilMonth(purchaseYM.year, purchaseYM.month))
  const nextBillingDate = formatCivilDate(purchaseYM.year, purchaseYM.month, nextBillingDay)

  let nextDueDate: string
  if (dueType === 'fixed') {
    const dueYM = shiftCivilMonths(purchaseYM.year, purchaseYM.month, 1)
    const dueDay = Math.min(Math.max(1, Math.trunc(dueValue)), daysInCivilMonth(dueYM.year, dueYM.month))
    nextDueDate = formatCivilDate(dueYM.year, dueYM.month, dueDay)
  } else if (dueType === 'fixed_before_billing') {
    const dueDay = Math.min(
      Math.max(1, Math.trunc(dueValue)),
      daysInCivilMonth(purchaseYM.year, purchaseYM.month)
    )
    nextDueDate = formatCivilDate(purchaseYM.year, purchaseYM.month, dueDay)
  } else {
    nextDueDate = addCivilDays(nextBillingDate, Math.max(1, Math.trunc(dueValue || 20)))
  }

  const diffDays = Math.round((Date.parse(nextDueDate) - Date.parse(todayStr)) / 86_400_000)
  return {
    graceDays: Math.max(1, diffDays),
    nextBillingDate,
    nextDueDate,
  }
}

export function isWebPushChannelEnabled(
  configOrRaw?:
    | {
        enabled_channels?: unknown
        opportunities?: { web_push_enabled?: unknown } | null
      }
    | string
    | null
): boolean {
  if (!configOrRaw) return true
  let cfg: { enabled_channels?: unknown; opportunities?: { web_push_enabled?: unknown } | null }
  if (typeof configOrRaw === 'string') {
    try {
      const parsed = JSON.parse(configOrRaw)
      if (!parsed || typeof parsed !== 'object') return true
      cfg = parsed as { enabled_channels?: unknown; opportunities?: { web_push_enabled?: unknown } | null }
    } catch {
      return true
    }
  } else {
    cfg = configOrRaw
  }
  if (cfg.enabled_channels !== undefined) {
    return Array.isArray(cfg.enabled_channels) && cfg.enabled_channels.includes('web_push')
  }
  if (cfg.opportunities && cfg.opportunities.web_push_enabled === false) {
    return false
  }
  return true
}

export function syncItemSwitchesWithOpportunities(
  current?: Partial<UserReminderConfig> | null,
  incoming?: Partial<UserReminderConfig> | null
): {
  items: NotificationItemSwitches
  opportunities: NonNullable<UserReminderConfig['opportunities']>
} {
  const items: NotificationItemSwitches = {
    ...resolveNotificationSwitches(current),
    ...(incoming?.items || {}),
  }
  const opportunities: NonNullable<UserReminderConfig['opportunities']> = {
    ...(current?.opportunities || {}),
    ...(incoming?.opportunities || {}),
  }

  // Conflicting simultaneous updates settle deterministically on items.*
  if (incoming?.items?.opportunity_reset !== undefined) {
    opportunities.reset_enabled = incoming.items.opportunity_reset
  } else if (incoming?.opportunities?.reset_enabled !== undefined) {
    items.opportunity_reset = incoming.opportunities.reset_enabled
  }

  if (incoming?.items?.opportunity_booking !== undefined) {
    opportunities.booking_enabled = incoming.items.opportunity_booking
  } else if (incoming?.opportunities?.booking_enabled !== undefined) {
    items.opportunity_booking = incoming.opportunities.booking_enabled
  }

  return { items, opportunities }
}

export function formatMoneySingle(amount: number, currency: string): string {
  const safe = Number(amount)
  const rounded = Math.round((Number.isFinite(safe) ? safe : 0) * 100) / 100
  return `${currencySymbol(currency)}${rounded.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

export function formatCurrencyBuckets(totalsByCurrency: Record<string, number>): string {
  const entries = Object.entries(totalsByCurrency).filter(([, amount]) => Number.isFinite(amount) && amount > 0)
  if (entries.length === 0) return '¥0'
  entries.sort(([a], [b]) => {
    if (a === 'CNY') return -1
    if (b === 'CNY') return 1
    return a.localeCompare(b)
  })
  return entries.map(([currency, amount]) => formatMoneySingle(amount, currency)).join(' + ')
}
