// 账单编辑共享纯函数：校验、预览计算。被 BillEditForm / BillPaymentsManage
// 与组件测试共用，保证「金额低于已还警告」「状态预览」口径单点一致。

import { isValidCalendarDate } from '@/lib/utils'

export { isValidCalendarDate }
export type BillStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'

/** YYYY-MM 账月格式（与 bills 表 UNIQUE(card_id, bill_month) 口径一致）。 */
export function isValidBillMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export interface EditableFieldValues {
  amount: string
  min_payment: string
  statement_date: string
  due_date: string
  statement_start: string
  statement_end: string
}

export type FieldErrors = Partial<Record<keyof EditableFieldValues, string>>

/**
 * 编辑表单校验。返回 errors，空对象即通过。
 * 金额 ≥ 0；最低还款额可空；还款到期日必填；其余日期可空但填了必须是真实日历日。
 */
export function validateEditableFields(values: EditableFieldValues): FieldErrors {
  const errors: FieldErrors = {}

  const amount = values.amount.trim()
  if (!amount) {
    errors.amount = '请填写账单金额'
  } else {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0) errors.amount = '金额必须是不小于 0 的数字'
  }

  const minPayment = values.min_payment.trim()
  if (minPayment) {
    const n = Number(minPayment)
    if (!Number.isFinite(n) || n < 0) errors.min_payment = '最低还款额必须是不小于 0 的数字'
  }

  const dueDate = values.due_date.trim()
  if (!dueDate) {
    errors.due_date = '请填写还款到期日'
  } else if (!isValidCalendarDate(dueDate)) {
    errors.due_date = '日期格式应为 YYYY-MM-DD 且为真实日历日'
  }

  for (const field of ['statement_date', 'statement_start', 'statement_end'] as const) {
    const v = values[field].trim()
    if (v && !isValidCalendarDate(v)) errors[field] = '日期格式应为 YYYY-MM-DD 且为真实日历日'
  }

  // 跨字段约束与服务端 updateBillFields 同条：倒挂账期本地提前拦截，
  // 不要等提交后才收到服务端报错。
  const periodStart = values.statement_start.trim()
  const periodEnd = values.statement_end.trim()
  if (periodStart && periodEnd && periodStart > periodEnd) {
    errors.statement_end = '账期开始日不能晚于账期结束日'
  }

  return errors
}

/**
 * 金额低于已还总额的触发器边界：改小生效金额后，后续新增还款会被
 * PAYMENT_EXCEEDS_REMAINING 拒绝。UI 必须在提交前给出警示。
 */
export function amountBelowPaidWarning(newAmount: number, totalPaid: number): boolean {
  return totalPaid > 0 && newAmount < totalPaid
}

/** 还款记录编辑的累计/剩余/状态预览（spec 画板 bill-editing-payment-edit 口径）。 */
export function previewAfterPayments(
  effectiveAmount: number,
  payments: Array<{ id: string; amount: number }>,
  editedId: string | null,
  editedAmount: number,
): { totalPaid: number; remaining: number; status: BillStatus } {
  const totalPaid = payments.reduce(
    (sum, p) => sum + (p.id === editedId ? editedAmount : Number(p.amount) || 0),
    0,
  )
  const remaining = Math.max(0, effectiveAmount - totalPaid)
  // spec §6.3：已还 ≥ 生效金额 − 0.01 即 paid（允许回退），与服务端重算口径一致。
  // 注意：此处无 overdue 分支——编辑态金额必须 > 0，totalPaid == 0 且未结清
  // 的账单不会走到这里，不要把它当成完整状态口径复用。
  let status: BillStatus
  if (effectiveAmount <= 0 || totalPaid >= effectiveAmount - 0.01) {
    status = 'paid'
  } else if (totalPaid > 0) {
    status = 'partial'
  } else {
    status = 'unpaid'
  }
  return { totalPaid, remaining, status }
}

export const STATUS_LABELS: Record<BillStatus, string> = {
  unpaid: '待还',
  partial: '部分还款',
  paid: '已结清',
  overdue: '逾期',
}

export const STATUS_DESCRIPTIONS: Record<BillStatus, string> = {
  unpaid: '尚未登记任何还款',
  partial: '已还一部分，剩余仍待还',
  paid: '已还金额 ≥ 生效账单金额',
  overdue: '已过还款日且未结清',
}
