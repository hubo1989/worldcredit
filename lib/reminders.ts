/**
 * lib/reminders.ts
 *
 * Client-side reminder scheduler.
 * Called once when the App opens (from MobileShell).
 *
 * Flow:
 *  1. Query unpaid/overdue bills with due_date within next 3 days (inclusive of today)
 *  2. For each bill, determine remind_type: '3days' | '1day' | 'due_day'
 *  3. Check reminder_logs → skip if already sent
 *  4. Fetch push_subscriptions for current user → send push via browser PushManager
 *  5. Insert reminder_log
 *
 * NOTE: This is a pure client-side approach. Push messages are only delivered
 * while the app is open or the SW is running in the background (browser-dependent).
 * A server-side cron would be required for reliable background delivery.
 */

import { insforge } from './insforge'
import type { ReminderLog, CreditCard } from './types'
import { getLoanNextDueDate } from './utils'

type RemindType = '3days' | '1day' | 'due_day' | 'loan_3days' | 'loan_1day' | 'loan_due_day'

// InsForge SDK returns relations as arrays; use `any` to avoid SDK shape mismatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BillRow = any

/**
 * Returns days until due_date (negative if overdue, 0 if today).
 */
function daysUntilDue(dueDateStr: string): number {
  const due = new Date(dueDateStr)
  due.setHours(0, 0, 0, 0)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - now.getTime()) / 86_400_000)
}

function remindTypeForDays(days: number): RemindType | null {
  if (days === 3) return '3days'
  if (days === 1) return '1day'
  if (days === 0) return 'due_day'
  return null
}

/**
 * Show a local notification via the Service Worker registration.
 * This works even when the app tab is in the background.
 */
async function showNotification(title: string, body: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `reminder-${Date.now()}`,
      data: { url: '/bills' },
    })
  } catch (err) {
    // Fallback to Notification API
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/pwa-192x192.png' })
    }
    console.warn('[reminders] showNotification fallback:', err)
  }
}

/**
 * Main entry point. Call this once per app open, after user is authenticated.
 */
export async function checkAndSendReminders(userId: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  try {
    // --- 贷款类卡还款提醒 ---
    await checkLoanReminders()

    // 1. Fetch unpaid bills due within next 3 days
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const threeDaysLater = new Date(today)
    threeDaysLater.setDate(threeDaysLater.getDate() + 3)

    const todayStr = today.toISOString().slice(0, 10)
    const maxStr = threeDaysLater.toISOString().slice(0, 10)

    const { data: bills, error: billsError } = await insforge.database
      .from('bills')
      .select('id, due_date, bill_amount, card:credit_cards(card_product:card_products(bank_name, card_name))')
      .in('status', ['unpaid', 'partial', 'overdue'])
      .gte('due_date', todayStr)
      .lte('due_date', maxStr)

    if (billsError || !bills || bills.length === 0) return

    // 2. Fetch already-sent reminder_logs for these bill ids
    const billIds = (bills as BillRow[]).map((b) => b.id as string)
    const { data: logs } = await insforge.database
      .from('reminder_logs')
      .select('bill_id, remind_type')
      .in('bill_id', billIds)

    const sentSet = new Set<string>(
      ((logs ?? []) as Pick<ReminderLog, 'bill_id' | 'remind_type'>[]).map(
        (l) => `${l.bill_id}:${l.remind_type}`
      )
    )

    // 3. Process each bill
    for (const bill of bills as BillRow[]) {
      const days = daysUntilDue(bill.due_date)
      const remindType = remindTypeForDays(days)
      if (!remindType) continue

      const key = `${bill.id}:${remindType}`
      if (sentSet.has(key)) continue

      // Compose notification
      // InsForge SDK may return card as array or object depending on query
      const cardObj = Array.isArray(bill.card) ? bill.card[0] : bill.card
      const cpObj = cardObj
        ? (Array.isArray(cardObj.card_product) ? cardObj.card_product[0] : cardObj.card_product)
        : null
      const cardName = cpObj
        ? `${cpObj.bank_name} ${cpObj.card_name}`
        : '信用卡'
      const amount = Number(bill.bill_amount).toLocaleString('zh-CN', {
        style: 'currency',
        currency: 'CNY',
      })

      let title = 'WorldCredit 还款提醒'
      let body = ''
      if (remindType === '3days') {
        title = '还款提醒｜3 天后到期'
        body = `${cardName} 账单 ${amount} 将于 3 天后到期，请提前安排还款。`
      } else if (remindType === '1day') {
        title = '还款提醒｜明天到期 ⚠️'
        body = `${cardName} 账单 ${amount} 明天到期！请今日内完成还款。`
      } else {
        title = '还款提醒｜今日到期 🚨'
        body = `${cardName} 账单 ${amount} 今天到期，立即还款避免逾期。`
      }

      await showNotification(title, body)

      // 4. Log the reminder to prevent re-sending
      await insforge.database
        .from('reminder_logs')
        .insert({ bill_id: bill.id, remind_type: remindType })
        .then(({ error }) => {
          if (error) console.warn('[reminders] log insert error:', error)
        })
    }
  } catch (err) {
    console.warn('[reminders] checkAndSendReminders error:', err)
  }
}

/**
 * 贷款类卡还款提醒
 * 查 card_type = 'loan' 的卡 → 用 getLoanNextDueDate 计算下一还款日
 * 3天内到期 → 发推送，写 reminder_logs
 */
async function checkLoanReminders(): Promise<void> {
  // 查询当前用户的所有贷款类卡
  const { data: loanCards, error: cardsError } = await insforge.database
    .from('credit_cards')
    .select('id, loan_due_day, card_product:card_products(bank_name, card_name)')
    .eq('card_type', 'loan')
    .eq('status', 'active')

  if (cardsError || !loanCards || loanCards.length === 0) return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const rawCard of loanCards as BillRow[]) {
    const card = rawCard as CreditCard & { card_product: { bank_name: string; card_name: string } | { bank_name: string; card_name: string }[] }
    if (!card.loan_due_day) continue

    const nextDue = getLoanNextDueDate(card.loan_due_day, today)
    const daysUntil = Math.round((nextDue.getTime() - today.getTime()) / 86_400_000)

    let remindType: 'loan_3days' | 'loan_1day' | 'loan_due_day' | null = null
    if (daysUntil === 3) remindType = 'loan_3days'
    else if (daysUntil === 1) remindType = 'loan_1day'
    else if (daysUntil === 0) remindType = 'loan_due_day'

    if (!remindType) continue

    const remindDateStr = nextDue.toISOString().slice(0, 10)

    // 检查是否已发送
    const { data: existingLog } = await insforge.database
      .from('reminder_logs')
      .select('id')
      .eq('card_id', card.id)
      .eq('remind_type', remindType)
      .eq('remind_date', remindDateStr)
      .maybeSingle()

    if (existingLog) continue

    const cpRaw = (card as BillRow).card_product
    const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw
    const cardName = cp ? `${cp.bank_name} ${cp.card_name}` : '贷款'
    const dateLabel = `${nextDue.getMonth() + 1}月${nextDue.getDate()}日`

    await showNotification(
      '贷款还款提醒',
      `${cardName} 还款日 ${dateLabel}，请及时还款`
    )

    await insforge.database
      .from('reminder_logs')
      .insert({ card_id: card.id, remind_type: remindType, remind_date: remindDateStr })
      .then(({ error }) => {
        if (error) console.warn('[reminders] loan log insert error:', error)
      })
  }
}
