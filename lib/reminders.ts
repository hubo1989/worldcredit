/**
 * lib/reminders.ts
 *
 * Client-side reminder scheduler.
 * Called once when the App opens (from MobileShell).
 */

import { query, queryOne, execute, uuid } from './db'
import type { CreditCard } from './types'
import { getLoanNextDueDate } from './utils'

type RemindType = '3days' | '1day' | 'due_day' | 'loan_3days' | 'loan_1day' | 'loan_due_day'

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

async function showNotification(title: string, body: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png',
      tag: `reminder-${Date.now()}`, data: { url: '/bills' },
    })
  } catch {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/pwa-192x192.png' })
    }
  }
}

interface DueBillRow {
  id: string
  due_date: string
  bill_amount: number
  card_id: string
  card_product_id: string
  bank_name: string
  card_name: string
}

export async function checkAndSendReminders(userId: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  try {
    await checkLoanReminders()

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const threeDaysLater = new Date(today)
    threeDaysLater.setDate(threeDaysLater.getDate() + 3)
    const todayStr = today.toISOString().slice(0, 10)
    const maxStr = threeDaysLater.toISOString().slice(0, 10)

    const { data: bills, error } = await query<DueBillRow>(
      `SELECT b.id, b.due_date, b.bill_amount, b.card_id,
              cc.card_product_id, cp.bank_name, cp.card_name
       FROM bills b
       JOIN credit_cards cc ON b.card_id = cc.id
       JOIN card_holders ch ON cc.holder_id = ch.id
       LEFT JOIN card_products cp ON cc.card_product_id = cp.id
       WHERE ch.created_by = ? AND b.status IN ('unpaid', 'partial', 'overdue')
         AND b.due_date >= ? AND b.due_date <= ?`,
      [userId, todayStr, maxStr]
    )
    if (error || !bills || bills.length === 0) return

    // Check already-sent reminders
    const billIds = bills.map(b => b.id)
    const { data: logs } = await query<{ bill_id: string; remind_type: string }>(
      `SELECT bill_id, remind_type FROM reminder_logs WHERE bill_id IN (${billIds.map(() => '?').join(',')})`, billIds
    )
    const sentSet = new Set((logs || []).map(l => `${l.bill_id}:${l.remind_type}`))

    for (const bill of bills) {
      const days = daysUntilDue(bill.due_date)
      const remindType = remindTypeForDays(days)
      if (!remindType) continue

      const key = `${bill.id}:${remindType}`
      if (sentSet.has(key)) continue

      const cardName = bill.bank_name ? `${bill.bank_name} ${bill.card_name}` : '信用卡'
      const amount = Number(bill.bill_amount).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })

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
      await execute(
        'INSERT INTO reminder_logs (id, bill_id, remind_type) VALUES (?, ?, ?)',
        [uuid(), bill.id, remindType]
      )
    }
  } catch (err) {
    console.warn('[reminders] checkAndSendReminders error:', err)
  }
}

async function checkLoanReminders(): Promise<void> {
  const { data: rawLoanCards, error } = await query<{
    id: string; card_product_id: string; loan_due_day: number; bank_name: string; card_name: string
  }>(
    `SELECT cc.id, cc.card_product_id, cc.loan_due_day, cp.bank_name, cp.card_name
     FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.card_type = 'loan' AND cc.status = 'active'`
  )
  if (error || !rawLoanCards || rawLoanCards.length === 0) return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const card of rawLoanCards) {
    if (!card.loan_due_day) continue
    const nextDue = getLoanNextDueDate(card.loan_due_day, today)
    const daysUntil = Math.round((nextDue.getTime() - today.getTime()) / 86_400_000)

    let remindType: 'loan_3days' | 'loan_1day' | 'loan_due_day' | null = null
    if (daysUntil === 3) remindType = 'loan_3days'
    else if (daysUntil === 1) remindType = 'loan_1day'
    else if (daysUntil === 0) remindType = 'loan_due_day'
    if (!remindType) continue

    const remindDateStr = nextDue.toISOString().slice(0, 10)
    const { data: existingLog } = await queryOne(
      'SELECT id FROM reminder_logs WHERE card_id = ? AND remind_type = ? AND remind_date = ?',
      [card.id, remindType, remindDateStr]
    )
    if (existingLog) continue

    const cardName = card.bank_name ? `${card.bank_name} ${card.card_name}` : '贷款'
    const dateLabel = `${nextDue.getMonth() + 1}月${nextDue.getDate()}日`
    await showNotification('贷款还款提醒', `${cardName} 还款日 ${dateLabel}，请及时还款`)
    await execute(
      'INSERT INTO reminder_logs (id, card_id, remind_type, remind_date) VALUES (?, ?, ?, ?)',
      [uuid(), card.id, remindType, remindDateStr]
    )
  }
}
