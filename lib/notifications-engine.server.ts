// lib/notifications-engine.server.ts — 每日主动通知候选生成与站内通知落库引擎。
//
// 显式接收 D1Database 参数，供 worker/cron.ts 与 lib/api/notifications.server.ts 共用：
//   - 站内读取通知中心/未读数时幂等补齐当日通知（status='skipped', push_sent_at=NULL）；
//   - 每日 Cron 扫表时补发 Web Push / APNs（跳过已读、已删、已推送、免打扰时段），并写入 push_sent_at。

import { buildAnnualFeeDecisionCandidates } from './annual-fee-notifications.server'
import { categoryLabel, type PayableCategory, type PayableCycleType } from './api/payables.shared'
import {
  computeCardGraceWindowOnDate,
  formatCurrencyBuckets,
  formatMoneySingle,
  isInQuietHours,
  isNewLongestGracePeriodDay,
  resolveNotificationSwitches,
  type NotificationBillMetadataItem,
  type NotificationGraceCardMetadataItem,
  type NotificationMetadata,
  type NotificationPayableMetadataItem,
} from './notifications.shared'
import { isValidIanaTimeZone } from './opportunities/dates'
import type { CardProduct, NotificationCategory, UserReminderConfig } from './types'
import { getLocalTodayString, nextPayablePeriodOf, payableDueDate, payablePeriodOf } from './utils'

export interface DailyNotificationCandidate {
  notification_key: string
  category: NotificationCategory
  title: string
  body: string
  target_url: string
  metadata_json: string | null
}

export interface UserNotificationContext {
  userId: string
  reminderConfigRaw: string | null
  reminderConfig: UserReminderConfig
  remindDaysBefore: number[]
  timeZone: string
  effectivePushHour: number
  quietHoursStart?: string
  quietHoursEnd?: string
}

interface BillQueryRow {
  id: string
  account_id: string | null
  card_id: string
  bill_month: string
  effective_amount: number
  effective_due_date: string
  effective_statement_date: string | null
  statement_end: string | null
  status: string
  holder_id: string
  bank_name: string | null
  card_name: string | null
  currency: string | null
  name_override: string | null
  card_number_last4: string | null
  account_statement_mode: string | null
  paid_amount: number
}

interface PayableQueryRow {
  id: string
  name: string
  category: PayableCategory
  custom_category: string | null
  amount: number
  currency: string
  cycle_type: PayableCycleType | null
  cycle_months: number | null
  due_month: number | null
  due_day: number
  anchor_period: string | null
  created_at: string
}

interface CreditCardGraceRow {
  id: string
  holder_id: string
  account_id: string | null
  billing_day: number
  override_billing_day: number | null
  override_due_type: CardProduct['payment_due_type'] | null
  override_due_value: number | null
  name_override: string | null
  card_number_last4: string | null
  bank_name: string | null
  card_name: string | null
  payment_due_type: CardProduct['payment_due_type'] | null
  payment_due_value: number | null
  account_statement_mode: string | null
}

function parseCivilDateUTC(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dateStr.trim())
  if (!m) return Number.NaN
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const ts = Date.UTC(year, month - 1, day)
  const verify = new Date(ts)
  if (
    verify.getUTCFullYear() !== year ||
    verify.getUTCMonth() !== month - 1 ||
    verify.getUTCDate() !== day
  ) {
    return Number.NaN
  }
  return ts
}

function diffCivilDays(targetStr: string, todayStr: string): number {
  const t = parseCivilDateUTC(targetStr)
  const c = parseCivilDateUTC(todayStr)
  if (!Number.isFinite(t) || !Number.isFinite(c)) return Number.NaN
  return Math.round((t - c) / 86_400_000)
}

function encodeMetadata(meta: NotificationMetadata): string {
  return JSON.stringify(meta)
}

function civilDateFromTodayStr(todayStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayStr)
  if (!m) return new Date()
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function formatPayableDueDateStr(dueDay: number, period: string): string {
  const d = payableDueDate(dueDay, period)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface LegacyNotificationPrefs {
  bill_due_enabled: number
  overdue_enabled: number
  due_days_before: number
  notify_time: string
}

export interface PrefetchedUserNotificationPrefs {
  reminderConfigRaw: string | null
  legacyRow: LegacyNotificationPrefs | null
}

function parseReminderTime(value: unknown): number | null {
  const match = typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function resolveEffectivePushHour(localTime: unknown, quietStart?: string, quietEnd?: string): number {
  const target = parseReminderTime(localTime) ?? 9 * 60
  const start = parseReminderTime(quietStart)
  const end = parseReminderTime(quietEnd)
  const deferred = start !== null && end !== null && start !== end &&
    (start < end ? target >= start && target < end : target >= start || target < end)
  return Math.floor((deferred ? end : target) / 60)
}

export async function loadUserNotificationContext(
  db: D1Database,
  userId: string,
  prefetched?: PrefetchedUserNotificationPrefs
): Promise<UserNotificationContext> {
  const [prefRow, legacyRow] = prefetched
    ? [
        prefetched.reminderConfigRaw != null ? { reminder_config: prefetched.reminderConfigRaw } : null,
        prefetched.legacyRow,
      ]
    : await Promise.all([
        db
          .prepare('SELECT reminder_config FROM user_preferences WHERE user_id = ?')
          .bind(userId)
          .first<{ reminder_config: string }>(),
        db
          .prepare('SELECT bill_due_enabled, overdue_enabled, due_days_before, notify_time FROM notification_preferences WHERE user_id = ?')
          .bind(userId)
          .first<LegacyNotificationPrefs>(),
      ])

  if (prefRow?.reminder_config) {
    try {
      const parsed = JSON.parse(prefRow.reminder_config) as Partial<UserReminderConfig>
      const remindDaysBefore = Array.isArray(parsed.remind_days_before)
        ? parsed.remind_days_before.filter((d): d is number => typeof d === 'number' && Number.isInteger(d))
        : [3, 1, 0]
      const mergedItemsInput = legacyRow
        ? {
            ...parsed.items,
            bill_due_today: parsed.items?.bill_due_today ?? (legacyRow.bill_due_enabled === 1),
            bill_due_advance: parsed.items?.bill_due_advance ?? (legacyRow.bill_due_enabled === 1),
            bill_overdue: parsed.items?.bill_overdue ?? (legacyRow.overdue_enabled === 1),
          }
        : parsed.items
      const mergedConfig: UserReminderConfig = {
        remind_days_before: remindDaysBefore,
        quiet_hours_start: parsed.quiet_hours_start ?? '22:00',
        quiet_hours_end: parsed.quiet_hours_end ?? '08:00',
        enabled_channels: Array.isArray(parsed.enabled_channels) ? parsed.enabled_channels : ['web_push'],
        items: resolveNotificationSwitches({ ...parsed, items: mergedItemsInput }),
        opportunities: parsed.opportunities,
      }
      return {
        userId,
        reminderConfigRaw: prefRow.reminder_config,
        reminderConfig: mergedConfig,
        remindDaysBefore,
        timeZone: isValidIanaTimeZone(parsed.opportunities?.time_zone)
          ? parsed.opportunities.time_zone : 'Asia/Shanghai',
        effectivePushHour: resolveEffectivePushHour(
          parseReminderTime(parsed.opportunities?.local_time) !== null
            ? parsed.opportunities?.local_time : legacyRow?.notify_time,
          mergedConfig.quiet_hours_start,
          mergedConfig.quiet_hours_end,
        ),
        quietHoursStart: mergedConfig.quiet_hours_start,
        quietHoursEnd: mergedConfig.quiet_hours_end,
      }
    } catch {
      // Fall through to legacy/default below if stored JSON is corrupted
    }
  }

  if (legacyRow) {
    const dueDays = Math.max(0, Math.min(30, Number(legacyRow.due_days_before ?? 3)))
    const remindDaysBefore = Array.from({ length: dueDays + 1 }, (_, i) => i)
    const billDueOn = legacyRow.bill_due_enabled === 1
    const overdueOn = legacyRow.overdue_enabled === 1
    const fallbackConfig: UserReminderConfig = {
      remind_days_before: remindDaysBefore,
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
      enabled_channels: ['web_push'],
      items: resolveNotificationSwitches({
        items: {
          bill_due_today: billDueOn,
          bill_due_advance: billDueOn,
          bill_overdue: overdueOn,
        },
      }),
    }
    return {
      userId,
      reminderConfigRaw: null,
      reminderConfig: fallbackConfig,
      remindDaysBefore,
      timeZone: 'Asia/Shanghai',
      effectivePushHour: resolveEffectivePushHour(legacyRow.notify_time, '22:00', '08:00'),
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    }
  }

  const defaultConfig: UserReminderConfig = {
    remind_days_before: [3, 1, 0],
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    enabled_channels: ['web_push'],
    items: resolveNotificationSwitches(null),
  }
  return {
    userId,
    reminderConfigRaw: null,
    reminderConfig: defaultConfig,
    remindDaysBefore: [3, 1, 0],
    timeZone: 'Asia/Shanghai',
    effectivePushHour: 9,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
  }
}

export function isUserInQuietHours(ctx: UserNotificationContext, now: Date = new Date()): boolean {
  return isInQuietHours(now, ctx.timeZone, ctx.quietHoursStart, ctx.quietHoursEnd)
}

export async function buildDailyNotificationCandidates(
  db: D1Database,
  userId: string,
  todayStr?: string,
  options?: { now?: Date; prefetched?: PrefetchedUserNotificationPrefs; context?: UserNotificationContext }
): Promise<{ context: UserNotificationContext; candidates: DailyNotificationCandidate[] }> {
  const context = options?.context?.userId === userId
    ? options.context : await loadUserNotificationContext(db, userId, options?.prefetched)
  const effectiveToday = todayStr ?? getLocalTodayString(context.timeZone, options?.now)
  const switches = resolveNotificationSwitches(context.reminderConfig)
  const advanceDays = new Set(context.remindDaysBefore.filter(d => Number.isInteger(d) && d > 0))
  const candidates: DailyNotificationCandidate[] = []

  // 1-2 & 4. 并发读取未结清账单、活跃固定支出与最长免息期候选卡
  const [billStmt, payableStmt, cardsStmt] = await Promise.all([
    db
      .prepare(
        `SELECT b.id, COALESCE(b.account_id, cc.account_id) AS account_id, b.card_id, b.bill_month,
                COALESCE(b.bill_amount_override, b.bill_amount) AS effective_amount,
                COALESCE(b.due_date_override, b.due_date) AS effective_due_date,
                COALESCE(b.statement_date_override, b.statement_date) AS effective_statement_date,
                b.statement_end,
                b.status,
                ch.id AS holder_id,
                cp.bank_name, cp.card_name, COALESCE(cp.currency, 'CNY') AS currency,
                cc.name_override, cc.card_number_last4,
                ca.statement_mode AS account_statement_mode,
                (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.bill_id = b.id) AS paid_amount
         FROM bills b
         JOIN credit_cards cc ON b.card_id = cc.id
         JOIN card_holders ch ON cc.holder_id = ch.id
         LEFT JOIN card_products cp ON cc.card_product_id = cp.id
         LEFT JOIN credit_accounts ca ON (b.account_id = ca.id OR (b.account_id IS NULL AND cc.account_id = ca.id))
         WHERE (ch.created_by = ? OR ch.managed_by = ? OR ch.auth_user_id = ?)
           AND b.status IN ('unpaid', 'partial', 'overdue')`
      )
      .bind(userId, userId, userId)
      .all<BillQueryRow>(),
    db
      .prepare(
        `SELECT id, name, category, custom_category, amount, currency,
                cycle_type, cycle_months, due_month, due_day, anchor_period, created_at
         FROM recurring_payables
         WHERE created_by = ? AND is_active = 1
         ORDER BY due_day ASC`
      )
      .bind(userId)
      .all<PayableQueryRow>(),
    switches.grace_period_longest
      ? db
          .prepare(
            `SELECT cc.id, cc.holder_id, cc.account_id, cc.billing_day, cc.override_billing_day,
                    cc.override_due_type, cc.override_due_value, cc.name_override, cc.card_number_last4,
                    cp.bank_name, cp.card_name, cp.payment_due_type, cp.payment_due_value,
                    ca.statement_mode AS account_statement_mode
             FROM credit_cards cc
             JOIN card_holders ch ON cc.holder_id = ch.id
             LEFT JOIN card_products cp ON cc.card_product_id = cp.id
             LEFT JOIN credit_accounts ca ON cc.account_id = ca.id
             WHERE (ch.created_by = ? OR ch.managed_by = ? OR ch.auth_user_id = ?)
               AND cc.status = 'active'
               AND COALESCE(cc.card_type, 'credit') = 'credit'`
          )
          .bind(userId, userId, userId)
          .all<CreditCardGraceRow>()
      : Promise.resolve(null),
  ])

  const unpaidBills = (billStmt.results || []).filter(row => {
    const remaining = Math.max(0, Number(row.effective_amount || 0) - Number(row.paid_amount || 0))
    return remaining > 0.01
  })

  // 批量读取合并账户的 active 成员卡信息，用于合并账单提示文案
  const mergedAccountIds = Array.from(
    new Set(
      unpaidBills
        .filter(b => b.account_statement_mode === 'merged' && b.account_id)
        .map(b => b.account_id as string)
    )
  )
  const accountCardsMap: Record<string, { count: number; firstTail: string }> = {}
  if (mergedAccountIds.length > 0) {
    const placeholders = mergedAccountIds.map(() => '?').join(',')
    const memberStmt = await db
      .prepare(
        `SELECT account_id, card_number_last4
         FROM credit_cards
         WHERE account_id IN (${placeholders}) AND status = 'active'
         ORDER BY created_at ASC`
      )
      .bind(...mergedAccountIds)
      .all<{ account_id: string; card_number_last4: string | null }>()
    for (const mc of memberStmt.results || []) {
      if (!accountCardsMap[mc.account_id]) {
        accountCardsMap[mc.account_id] = { count: 0, firstTail: mc.card_number_last4 || '' }
      }
      accountCardsMap[mc.account_id].count++
    }
  }

  const formatBillSubject = (b: BillQueryRow): string => {
    const bankPrefix = b.bank_name || ''
    const accInfo = b.account_id ? accountCardsMap[b.account_id] : null
    if (b.account_statement_mode === 'merged' && accInfo && accInfo.count > 1) {
      return `${bankPrefix}合并账单（含尾号 ${accInfo.firstTail} 等 ${accInfo.count} 张卡）`.trim()
    }
    const cardName = b.name_override || b.card_name || ''
    const tail = b.card_number_last4 ? ` 尾号${b.card_number_last4}` : ''
    return `${bankPrefix} ${cardName}${tail}`.trim() || '信用卡'
  }

  // 2. 评估活跃固定支出（与 payables.server.ts 同滚动账期口径）
  const payableRows = payableStmt.results || []
  const todayDate = civilDateFromTodayStr(effectiveToday)

  interface PayableEval {
    row: PayableQueryRow
    period: string
    dueDate: string
    daysUntil: number
    remaining: number
    categoryText: string
  }
  const activePayables: PayableEval[] = []
  if (payableRows.length > 0) {
    const payableIds = payableRows.map(p => p.id)
    const placeholders = payableIds.map(() => '?').join(',')
    const payStmt = await db
      .prepare(
        `SELECT payable_id, period, SUM(amount) AS total
         FROM recurring_payable_payments
         WHERE payable_id IN (${placeholders})
         GROUP BY payable_id, period`
      )
      .bind(...payableIds)
      .all<{ payable_id: string; period: string; total: number }>()
    const paidMap = new Map<string, number>()
    for (const p of payStmt.results || []) {
      paidMap.set(`${p.payable_id}:${p.period}`, Number(p.total || 0))
    }

    for (const row of payableRows) {
      const cycle = {
        cycle_type: row.cycle_type ?? 'monthly',
        cycle_months: row.cycle_months ?? 1,
        due_month: row.due_month ?? null,
        due_day: row.due_day,
        anchor_period: row.anchor_period ?? null,
        created_at: row.created_at,
      }
      const currentPeriod = payablePeriodOf(todayDate, cycle)
      const amount = Number(row.amount) || 0
      const paidCurrent = paidMap.get(`${row.id}:${currentPeriod}`) ?? 0
      const settledCurrent = amount > 0 && paidCurrent >= amount - 0.01
      const nextPeriod = nextPayablePeriodOf(currentPeriod, cycle)
      const nextDueStr = formatPayableDueDateStr(row.due_day, nextPeriod)

      let displayPeriod = currentPeriod
      let displayPaid = paidCurrent
      const nextDiff = diffCivilDays(nextDueStr, effectiveToday)
      if (settledCurrent && Number.isFinite(nextDiff) && nextDiff < 30) {
        displayPeriod = nextPeriod
        displayPaid = paidMap.get(`${row.id}:${nextPeriod}`) ?? 0
      }

      const remaining = Math.max(0, amount - displayPaid)
      if (remaining <= 0.01) continue

      const dueDateStr = formatPayableDueDateStr(row.due_day, displayPeriod)
      const daysUntil = diffCivilDays(dueDateStr, effectiveToday)
      if (!Number.isFinite(daysUntil)) continue
      activePayables.push({
        row,
        period: displayPeriod,
        dueDate: dueDateStr,
        daysUntil,
        remaining,
        categoryText: categoryLabel(row.category, row.custom_category),
      })
    }
  }

  // 3. 汇总「当日待还款账单（包含固定支出）」主动通知
  const dueTodayBillEntries: NotificationBillMetadataItem[] = []
  const dueTodayPayableEntries: NotificationPayableMetadataItem[] = []

  for (const bill of unpaidBills) {
    const daysUntil = diffCivilDays(bill.effective_due_date, effectiveToday)
    if (!Number.isFinite(daysUntil)) continue
    const remaining = Math.max(0, Number(bill.effective_amount || 0) - Number(bill.paid_amount || 0))
    const currency = bill.currency || 'CNY'
    const subject = formatBillSubject(bill)
    const stmtDate = bill.effective_statement_date || bill.statement_end
    const stmtDiff = stmtDate ? diffCivilDays(stmtDate, effectiveToday) : Number.NaN
    const isUnissued = Number.isFinite(stmtDiff) && stmtDiff > 0

    if (daysUntil === 0) {
      if (switches.bill_due_today) {
        dueTodayBillEntries.push({
          id: bill.id,
          subject,
          remaining,
          currency,
          due_date: bill.effective_due_date,
        })
      }
    } else if (daysUntil < 0 && !isUnissued) {
      if (switches.bill_overdue) {
        const amtStr = formatMoneySingle(remaining, currency)
        candidates.push({
          notification_key: `bill_overdue:${bill.id}:${effectiveToday}`,
          category: 'bill_overdue',
          title: `已逾期：${subject}`,
          body: `${subject} 账单剩余待还 ${amtStr}，已逾期 ${Math.abs(daysUntil)} 天（到期日 ${bill.effective_due_date}）。`,
          target_url: `/bills/${bill.id}`,
          metadata_json: encodeMetadata({
            kind: 'bill_overdue',
            bill_id: bill.id,
            remaining,
            currency,
            days_overdue: Math.abs(daysUntil),
            due_date: bill.effective_due_date,
          }),
        })
      }
    } else if (daysUntil > 0 && advanceDays.has(daysUntil)) {
      if (switches.bill_due_advance) {
        const amtStr = formatMoneySingle(remaining, currency)
        candidates.push({
          notification_key: `bill:${bill.id}:${effectiveToday}`,
          category: 'bill_due_advance',
          title: daysUntil === 1 ? `明天到期：${subject}` : `${daysUntil}天后还款：${subject}`,
          body: `${subject} 账单剩余待还 ${amtStr}，将于 ${daysUntil} 天后（${bill.effective_due_date}）到期。`,
          target_url: `/bills/${bill.id}`,
          metadata_json: encodeMetadata({
            kind: 'bill_due_advance',
            bill_id: bill.id,
            remaining,
            currency,
            days_until_due: daysUntil,
            due_date: bill.effective_due_date,
          }),
        })
      }
    }
  }

  for (const p of activePayables) {
    if (p.daysUntil === 0) {
      if (switches.payable_due_today) {
        dueTodayPayableEntries.push({
          id: p.row.id,
          name: p.row.name,
          category: p.categoryText,
          remaining: p.remaining,
          currency: p.row.currency || 'CNY',
          due_date: p.dueDate,
        })
      }
    } else if (p.daysUntil < 0) {
      if (switches.bill_overdue) {
        const amtStr = formatMoneySingle(p.remaining, p.row.currency || 'CNY')
        candidates.push({
          notification_key: `payable_overdue:${p.row.id}:${effectiveToday}`,
          category: 'bill_overdue',
          title: `固定支出已逾期：${p.row.name}`,
          body: `${p.row.name}（${p.categoryText}）本期应付 ${amtStr}，已逾期 ${Math.abs(p.daysUntil)} 天（应付日 ${p.dueDate}）。`,
          target_url: '/bills',
          metadata_json: encodeMetadata({
            kind: 'payable_overdue',
            payable_id: p.row.id,
            remaining: p.remaining,
            currency: p.row.currency || 'CNY',
            days_overdue: Math.abs(p.daysUntil),
            due_date: p.dueDate,
          }),
        })
      }
    } else if (p.daysUntil > 0 && advanceDays.has(p.daysUntil)) {
      if (switches.payable_due_advance) {
        const amtStr = formatMoneySingle(p.remaining, p.row.currency || 'CNY')
        candidates.push({
          notification_key: `payable:${p.row.id}:${effectiveToday}`,
          category: 'payable_due_advance',
          title: p.daysUntil === 1 ? `固定支出明天到期：${p.row.name}` : `${p.daysUntil}天后应付：${p.row.name}`,
          body: `${p.row.name}（${p.categoryText}）本期应付 ${amtStr}，将于 ${p.daysUntil} 天后（${p.dueDate}）到期。`,
          target_url: '/bills',
          metadata_json: encodeMetadata({
            kind: 'payable_due_advance',
            payable_id: p.row.id,
            remaining: p.remaining,
            currency: p.row.currency || 'CNY',
            days_until_due: p.daysUntil,
            due_date: p.dueDate,
          }),
        })
      }
    }
  }

  const totalDueTodayCount = dueTodayBillEntries.length + dueTodayPayableEntries.length
  if (totalDueTodayCount > 0) {
    const totalsByCurrency: Record<string, number> = {}
    const lines: string[] = []
    for (const item of dueTodayBillEntries) {
      totalsByCurrency[item.currency] = (totalsByCurrency[item.currency] || 0) + item.remaining
      lines.push(`• [信用卡] ${item.subject}：${formatMoneySingle(item.remaining, item.currency)}`)
    }
    for (const item of dueTodayPayableEntries) {
      totalsByCurrency[item.currency] = (totalsByCurrency[item.currency] || 0) + item.remaining
      lines.push(`• [固定支出·${item.category}] ${item.name}：${formatMoneySingle(item.remaining, item.currency)}`)
    }
    const totalLabel = formatCurrencyBuckets(totalsByCurrency)
    const category: NotificationCategory =
      dueTodayBillEntries.length === 0 ? 'payable_due_today' : 'bill_due_today'
    candidates.unshift({
      notification_key: `due_today_summary:${effectiveToday}`,
      category,
      title: `今日待还款 ${totalLabel}（共 ${totalDueTodayCount} 笔）`,
      body: `今天需完成以下 ${totalDueTodayCount} 笔还款：\n${lines.join('\n')}`,
      target_url: '/dashboard',
      metadata_json: encodeMetadata({
        kind: 'due_today_summary',
        date: effectiveToday,
        totals_by_currency: totalsByCurrency,
        bills: dueTodayBillEntries,
        payables: dueTodayPayableEntries,
      }),
    })
  }

  // 4. 今日新增最长免息期账单（昨日为账单日 → 今日进入最长免息期首日）
  if (switches.grace_period_longest && cardsStmt) {
    const groupedHits = new Map<string, NotificationGraceCardMetadataItem>()

    for (const card of cardsStmt.results || []) {
      const effectiveBillingDay = Number(card.override_billing_day ?? card.billing_day ?? 10)
      if (!isNewLongestGracePeriodDay(effectiveBillingDay, effectiveToday)) continue

      const win = computeCardGraceWindowOnDate(
        {
          billing_day: card.billing_day ?? 10,
          override_billing_day: card.override_billing_day,
          override_due_type: card.override_due_type,
          override_due_value: card.override_due_value,
          payment_due_type: card.payment_due_type ?? 'after_billing',
          payment_due_value: card.payment_due_value ?? 20,
        },
        effectiveToday
      )
      const isMerged = card.account_statement_mode === 'merged' && Boolean(card.account_id)
      const groupKey = isMerged ? `account:${card.account_id}` : `card:${card.id}`
      const bank = card.bank_name || ''
      const cardTitle = card.name_override || card.card_name || '信用卡'
      const tail = card.card_number_last4 ? `（尾号 ${card.card_number_last4}）` : ''
      const label = isMerged
        ? `${bank} 合并账户${tail}`.trim()
        : `${bank} ${cardTitle}${tail}`.trim()

      const existing = groupedHits.get(groupKey)
      if (!existing || win.graceDays > existing.graceDays) {
        groupedHits.set(groupKey, {
          cardId: card.id,
          label,
          graceDays: win.graceDays,
          nextBillingDate: win.nextBillingDate,
          nextDueDate: win.nextDueDate,
        })
      }
    }

    const graceHits = Array.from(groupedHits.values()).sort(
      (a, b) => b.graceDays - a.graceDays || a.cardId.localeCompare(b.cardId)
    )
    if (graceHits.length > 0) {
      const lines = graceHits.map(
        h => `• ${h.label}：今日刷卡可享 ${h.graceDays} 天免息（下期账单日 ${h.nextBillingDate}，还款日 ${h.nextDueDate}）`
      )
      const title =
        graceHits.length === 1
          ? `今日新增最长免息期：${graceHits[0].label}（${graceHits[0].graceDays} 天）`
          : `今日新增 ${graceHits.length} 张最长免息期卡（最长 ${graceHits[0].graceDays} 天）`
      const body =
        graceHits.length === 1
          ? `${graceHits[0].label} 昨日刚出账单，今天进入本轮最长免息期，刷卡可享 ${graceHits[0].graceDays} 天免息（下期账单日 ${graceHits[0].nextBillingDate}，还款日 ${graceHits[0].nextDueDate}）。`
          : `以下卡片昨日刚过账单日，今天新进入本轮最长免息期：\n${lines.join('\n')}`
      candidates.push({
        notification_key: `grace_longest:${effectiveToday}`,
        category: 'grace_period_longest',
        title,
        body,
        target_url: graceHits.length === 1 ? `/cards/${graceHits[0].cardId}` : '/bills',
        metadata_json: encodeMetadata({
          kind: 'grace_period_longest',
          date: effectiveToday,
          cards: graceHits,
        }),
      })
    }
  }

  if (switches.annual_fee_decision) {
    const feeCandidates = await buildAnnualFeeDecisionCandidates(db, userId, effectiveToday)
    for (const candidate of feeCandidates) candidates.push(candidate)
  }

  return { context, candidates }
}

/**
 * 幂等把今日应生成的站内通知写入 notification_history（status='skipped', push_sent_at=NULL）。
 * 若同 (user_id, notification_key) 已存在（含已读或已软删除），OR IGNORE 保持原状不复活。
 */
export async function ensureDailyNotificationsForUser(
  db: D1Database,
  userId: string,
  todayStr?: string,
  nowIso: string = new Date().toISOString()
): Promise<number> {
  const { candidates } = await buildDailyNotificationCandidates(db, userId, todayStr, {
    now: new Date(nowIso),
  })
  if (candidates.length === 0) return 0

  const stmtSql = `INSERT OR IGNORE INTO notification_history
     (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status, push_sent_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', NULL)`
  const statements = candidates.map(candidate =>
    db
      .prepare(stmtSql)
      .bind(
        crypto.randomUUID(),
        userId,
        candidate.notification_key,
        candidate.category,
        candidate.title,
        candidate.body,
        candidate.target_url,
        candidate.metadata_json,
        nowIso
      )
  )
  const results = await db.batch(statements)
  return results.reduce((sum, res) => sum + Number(res.meta?.changes ?? 0), 0)
}
