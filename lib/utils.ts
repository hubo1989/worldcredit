// lib/utils.ts
import { addDays, setDate, lastDayOfMonth } from 'date-fns'
import type { CreditCard, CardProduct } from './types'

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
 * @param card 信用卡（提供 billing_day）
 * @param cardProduct 卡产品（提供 payment_due_type / payment_due_value）
 * @param billMonth 账单月份
 */
export function getDueDate(card: CreditCard, cardProduct: CardProduct, billMonth: Date): Date {
  if (cardProduct.payment_due_type === 'fixed') {
    const lastDay = lastDayOfMonth(billMonth).getDate()
    const actualDay = Math.min(cardProduct.payment_due_value, lastDay)
    return setDate(billMonth, actualDay)
  } else {
    const billingDate = getActualBillingDate(card.billing_day, billMonth)
    return addDays(billingDate, cardProduct.payment_due_value)
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
