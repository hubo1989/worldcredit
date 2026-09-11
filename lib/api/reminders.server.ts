// lib/api/reminders.server.ts — server-side data access for the client
// reminder scheduler (lib/reminders.ts). The scheduler itself stays in the
// browser (it shows local notifications), but all reads/writes to D1 happen
// through these allowlisted functions.

import { query, queryOne, execute, uuid } from '../db'
import { getLoanNextDueDate } from '../utils'

export interface DueBillRow {
  id: string
  due_date: string
  bill_amount: number
  card_id: string
  card_product_id: string | null
  bank_name: string | null
  card_name: string | null
}

export async function getDueBillsForReminders(
  userId: string,
  todayStr: string,
  maxStr: string
): Promise<DueBillRow[]> {
  const { data, error } = await query<DueBillRow>(
    `SELECT b.id, b.due_date, b.bill_amount, b.card_id,
            cc.card_product_id, cp.bank_name, cp.card_name
     FROM bills b
     JOIN credit_cards cc ON b.card_id = cc.id
     JOIN card_holders ch ON cc.holder_id = ch.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE (ch.created_by = ? OR ch.auth_user_id = ?) AND b.status IN ('unpaid', 'partial', 'overdue')
       AND b.due_date >= ? AND b.due_date <= ?`,
    [userId, userId, todayStr, maxStr]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function getSentReminderKeys(billIds: string[]): Promise<string[]> {
  if (billIds.length === 0) return []
  const placeholders = billIds.map(() => '?').join(',')
  const { data, error } = await query<{ bill_id: string; remind_type: string }>(
    `SELECT bill_id, remind_type FROM reminder_logs WHERE bill_id IN (${placeholders})`,
    billIds
  )
  if (error) throw new Error(error.message)
  return (data || []).map(l => `${l.bill_id}:${l.remind_type}`)
}

export async function recordBillReminder(billId: string, remindType: string): Promise<void> {
  const { error } = await execute(
    'INSERT INTO reminder_logs (id, bill_id, remind_type) VALUES (?, ?, ?)',
    [uuid(), billId, remindType]
  )
  if (error) throw new Error(error.message)
}

export interface ActiveLoanCard {
  id: string
  holder_id: string
  card_product_id: string | null
  loan_due_day: number
  bank_name: string | null
  card_name: string | null
}

export async function getActiveLoanCards(): Promise<ActiveLoanCard[]> {
  const { data, error } = await query<ActiveLoanCard>(
    `SELECT cc.id, cc.holder_id, cc.card_product_id, cc.loan_due_day, cp.bank_name, cp.card_name
     FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.card_type = 'loan' AND cc.status = 'active'`
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function hasLoanReminderLog(
  cardId: string,
  remindType: string,
  remindDate: string
): Promise<boolean> {
  const { data } = await queryOne<{ id: string }>(
    'SELECT id FROM reminder_logs WHERE card_id = ? AND remind_type = ? AND remind_date = ?',
    [cardId, remindType, remindDate]
  )
  return !!data
}

export async function recordLoanReminder(
  cardId: string,
  remindType: string,
  remindDate: string
): Promise<void> {
  const { error } = await execute(
    'INSERT INTO reminder_logs (id, card_id, remind_type, remind_date) VALUES (?, ?, ?, ?)',
    [uuid(), cardId, remindType, remindDate]
  )
  if (error) throw new Error(error.message)
}

// Re-export for local computations shared with the client scheduler.
export { getLoanNextDueDate }
