// lib/utils.ts
import { addDays, setDate, lastDayOfMonth } from 'date-fns'
import type { CreditCard } from './types'

/**
 * 计算实际账单日（处理 billing_day > 当月最后一天的情况）
 */
export function getActualBillingDate(billingDay: number, month: Date): Date {
  const lastDay = lastDayOfMonth(month).getDate()
  const actualDay = Math.min(billingDay, lastDay)
  return setDate(month, actualDay)
}

/**
 * 计算还款截止日
 */
export function getDueDate(card: CreditCard, billMonth: Date): Date {
  if (card.payment_due_type === 'fixed') {
    const lastDay = lastDayOfMonth(billMonth).getDate()
    const actualDay = Math.min(card.payment_due_value, lastDay)
    return setDate(billMonth, actualDay)
  } else {
    const billingDate = getActualBillingDate(card.billing_day, billMonth)
    return addDays(billingDate, card.payment_due_value)
  }
}

/**
 * 格式化金额
 */
export function formatAmount(amount: number, currency: string = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

/**
 * 生成幂等键
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID()
}

/**
 * 计算距还款日的天数
 */
export function daysUntilDue(dueDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * 获取账单状态颜色
 */
export function getBillStatusColor(status: string): string {
  switch (status) {
    case 'paid': return '#4caf50'
    case 'partial': return '#ff9800'
    case 'overdue': return '#f44336'
    default: return '#9e9e9e'
  }
}

/**
 * 获取账单状态文本
 */
export function getBillStatusText(status: string): string {
  switch (status) {
    case 'paid': return '已还清'
    case 'partial': return '部分还款'
    case 'overdue': return '已逾期'
    default: return '待还款'
  }
}
