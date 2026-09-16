// lib/api/payables.server.ts — 周期性固定支出（房租 / 贷款 / 其他按月应付）。
//
// 与信用卡账单分开建模：房租不是卡账，混进 credit_cards 会污染卡数、额度、
// 免息期等所有口径（见 migrations/d1/0009 的说明）。

import { query, queryOne, execute, uuid, now } from '../db'
import { payablePeriodOf, payableDueDate, diffInCalendarDays } from '../utils'
import type { PayableCategory } from './payables.shared'

export type { PayableCategory } from './payables.shared'

export interface RecurringPayable {
  id: string
  created_by: string
  name: string
  category: PayableCategory
  amount: number
  currency: string
  due_day: number
  holder_id: string | null
  note: string | null
  is_active: number
  created_at: string
}

export interface RecurringPayableInput {
  name: string
  category: PayableCategory
  amount: number
  currency: string
  due_day: number
  holder_id?: string | null
  note?: string | null
}

/** 创建入参：created_by 由客户端带上、服务端按会话覆盖（与 createHolder 同约定）。 */
export type CreateRecurringPayableInput = RecurringPayableInput & { created_by: string }

/** 列表项：应付事项 + 当期状态，供账单页直接渲染。 */
export interface PayableWithStatus extends RecurringPayable {
  /** 当前账期 'YYYY-MM' */
  period: string
  /** 当期到期日 'YYYY-MM-DD' */
  due_date: string
  /** 距到期天数（负数 = 已逾期） */
  days_until_due: number
  /** 当期已登记金额（未登记为 0） */
  paid_amount: number
  /** 状态：待付 / 已付 / 逾期 */
  status: 'unpaid' | 'paid' | 'overdue'
}

/** 某个应付事项在指定账期的付款金额（没有则 0）。 */
async function paidAmountFor(payableId: string, period: string): Promise<number> {
  const { data } = await queryOne<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM recurring_payable_payments WHERE payable_id = ? AND period = ?',
    [payableId, period]
  )
  return Number(data?.total ?? 0)
}

/**
 * 把一条应付记录合成为「带当期状态」的展示对象。
 *
 * 状态判定与 computeStatus 同口径：到期日当天不算逾期（days = 0 仍算待付）。
 */
function withStatus(
  row: RecurringPayable,
  period: string,
  paidAmount: number,
  today: Date
): PayableWithStatus {
  const dueDate = payableDueDate(row.due_day, period)
  const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`
  const daysUntilDue = diffInCalendarDays(dueDateStr, today)
  const amount = Number(row.amount) || 0
  let status: PayableWithStatus['status'] = 'unpaid'
  if (amount > 0 && paidAmount >= amount - 0.01) status = 'paid'
  else if (daysUntilDue < 0) status = 'overdue'
  return {
    ...row,
    amount,
    period,
    due_date: dueDateStr,
    days_until_due: daysUntilDue,
    paid_amount: paidAmount,
    status,
  }
}

/** 账单页用：当前生效的应付事项 + 当期状态。 */
export async function getRecurringPayables(
  userId: string,
  today: Date = new Date()
): Promise<PayableWithStatus[]> {
  const { data, error } = await query<RecurringPayable>(
    'SELECT * FROM recurring_payables WHERE created_by = ? AND is_active = 1 ORDER BY due_day ASC',
    [userId]
  )
  if (error) throw new Error(error.message)
  const rows = data || []
  if (rows.length === 0) return []

  const period = payablePeriodOf(today)
  const paid = await Promise.all(rows.map(r => paidAmountFor(r.id, period)))
  return rows.map((row, i) => withStatus(row, period, paid[i], today))
}

export async function createRecurringPayable(
  input: CreateRecurringPayableInput
): Promise<PayableWithStatus> {
  if (!input.name?.trim()) throw new Error('请填写名称')
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error('金额必须是不小于 0 的数字')
  if (!Number.isInteger(input.due_day) || input.due_day < 1 || input.due_day > 31) {
    throw new Error('每月应付日必须在 1–31 之间')
  }
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, note, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, input.created_by, input.name.trim(), input.category, input.amount,
     input.currency || 'CNY', input.due_day, input.holder_id || null, input.note || null, now()]
  )
  if (error) throw new Error(error.message)
  const created = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [id])
  if (!created.data) throw new Error('创建失败')
  return withStatus(created.data, payablePeriodOf(), 0, new Date())
}

export async function updateRecurringPayable(
  id: string,
  patch: Partial<RecurringPayableInput> & { is_active?: number }
): Promise<PayableWithStatus> {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['name', 'category', 'amount', 'currency', 'due_day', 'holder_id', 'note', 'is_active'] as const) {
    const value = (patch as Record<string, unknown>)[key]
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      params.push(value)
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE recurring_payables SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const updated = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [id])
  if (!updated.data) throw new Error('应付事项不存在')
  return withStatus(updated.data, payablePeriodOf(), await paidAmountFor(id, payablePeriodOf()), new Date())
}

export async function deleteRecurringPayable(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM recurring_payables WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

/**
 * 登记当期还款。
 *
 * period 由服务端按「今天所属账期」决定：客户端传账期就等于让它可以往任意
 * 月份记账。重复登记由 (payable_id, period) 唯一约束挡下，天然幂等。
 */
export async function payRecurringPayable(
  payableId: string,
  amount: number,
  note?: string,
  today: Date = new Date()
): Promise<PayableWithStatus> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('还款金额必须大于 0')
  const period = payablePeriodOf(today)

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM recurring_payable_payments WHERE payable_id = ? AND period = ?',
    [payableId, period]
  )
  if (existing.data) throw new Error('本期已登记还款，无需重复登记')

  const payable = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [payableId])
  if (!payable.data) throw new Error('应付事项不存在')

  const { error } = await execute(
    `INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), payableId, period, amount,
     `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
     note || null, now()]
  )
  if (error) throw new Error(error.message)
  return withStatus(payable.data, period, await paidAmountFor(payableId, period), today)
}

/** 供统计复用：当期应付合计（按币种分组，绝不跨币种直接相加）。 */
export function sumPayablesByCurrency(payables: PayableWithStatus[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const p of payables) {
    if (p.status === 'paid') continue
    const remaining = Math.max(0, p.amount - p.paid_amount)
    if (remaining <= 0) continue
    totals[p.currency] = (totals[p.currency] || 0) + remaining
  }
  return totals
}
