// lib/api/payables.server.ts — 周期性固定支出（房租 / 贷款 / 其他按月应付）。
//
// 与信用卡账单分开建模：房租不是卡账，混进 credit_cards 会污染卡数、额度、
// 免息期等所有口径（见 migrations/d1/0009 的说明）。

import { query, queryOne, execute, uuid, now } from '../db'
import { payablePeriodOf, payableDueDate, nextPayablePeriodOf, diffInCalendarDays } from '../utils'
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
  /** 还款/转账目标银行账号（选填，展示层一键复制） */
  bank_account?: string | null
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
  bank_account?: string | null
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

/**
 * 展示期解析（2026-10-21 滚动规则）：本期已付清且距下期应付日不足 30 天时，
 * 展示期滚动到下期——卡片转为「待还款」，可以直接对下期登记付款，不再出现
 * 「已进入应付窗口却显示已登记」的矛盾。
 *
 * 滚动以本期付清为前提：本期未付清（含逾期）时绝不滚动，否则下期临近
 * （如应付日 5 号、今天 10 号，下期只剩 26 天）会把当前逾期掩盖成待还款。
 * 列表展示与付款登记必须共用此函数，保证登记写进的账期与用户看到的账期一致。
 */
/** 导出仅供测试：滚动规则的核心判定。 */
export async function resolveDisplayPeriod(
  row: RecurringPayable,
  today: Date
): Promise<{ period: string; paidAmount: number }> {
  const current = payablePeriodOf(today)
  const amount = Number(row.amount) || 0
  const paidCurrent = await paidAmountFor(row.id, current)
  const settled = amount > 0 && paidCurrent >= amount - 0.01
  const nextDue = payableDueDate(row.due_day, nextPayablePeriodOf(current))
  if (settled && diffInCalendarDays(nextDue, today) < 30) {
    // 滚动到下期：该期此前不可能有付款记录，已付金额为 0
    return { period: nextPayablePeriodOf(current), paidAmount: 0 }
  }
  return { period: current, paidAmount: paidCurrent }
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

  return Promise.all(
    rows.map(async row => {
      const { period, paidAmount } = await resolveDisplayPeriod(row, today)
      return withStatus(row, period, paidAmount, today)
    })
  )
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
    `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, note, bank_account, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, input.created_by, input.name.trim(), input.category, input.amount,
     input.currency || 'CNY', input.due_day, input.holder_id || null, input.note || null,
     input.bank_account?.trim() || null, now()]
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
  for (const key of ['name', 'category', 'amount', 'currency', 'due_day', 'holder_id', 'note', 'bank_account', 'is_active'] as const) {
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
 * period 由服务端按展示期滚动规则决定（与列表展示一致）：本期已付清且
 * 距下期不足 30 天时登记的就是下期。重复登记由 (payable_id, period)
 * 唯一约束挡下，天然幂等。
 */
export async function payRecurringPayable(
  payableId: string,
  amount: number,
  note?: string,
  today: Date = new Date()
): Promise<PayableWithStatus> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('还款金额必须大于 0')

  const payable = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [payableId])
  if (!payable.data) throw new Error('应付事项不存在')

  // 账期与列表展示共用同一滚动逻辑：卡片显示「待还款」的是哪一期，
  // 登记就写进哪一期，不会出现展示下期却记到本期的错位。
  const { period } = await resolveDisplayPeriod(payable.data, today)

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM recurring_payable_payments WHERE payable_id = ? AND period = ?',
    [payableId, period]
  )
  if (existing.data) throw new Error('本期已登记还款，无需重复登记')

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
