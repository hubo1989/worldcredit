// lib/utils.ts
import { addDays, setDate, addMonths, lastDayOfMonth } from 'date-fns'
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
 * 返回卡的实际生效账单日（override > CardProduct 默认 billing_day）
 * 注意：billing_day 存在于 CreditCard，不在 CardProduct，故此处只返回 override 或卡自身的 billing_day
 */
export function getEffectiveBillingDay(card: CreditCard): number {
  return card.override_billing_day ?? card.billing_day
}

/**
 * 返回实际生效的还款规则（优先使用卡级别 override，否则用卡产品默认）
 */
export function getEffectiveDueConfig(
  card: CreditCard,
  cardProduct: CardProduct
): { type: 'fixed' | 'after_billing' | 'fixed_before_billing'; value: number } {
  if (card.override_due_type != null && card.override_due_value != null) {
    return { type: card.override_due_type, value: card.override_due_value }
  }
  return { type: cardProduct.payment_due_type, value: cardProduct.payment_due_value }
}

/**
 * 计算还款截止日
 *
 * 支持三种 due_type：
 *  - `after_billing`：账单日后 X 天（due_value = 天数）
 *  - `fixed`：每月固定还款日，还款日在账单月的「下一个月」（due_value = 1-31）
 *  - `fixed_before_billing`：还款日是固定日，账单日往前推，还款日在账单月同月（due_value = 1-31）
 *
 * @param card 信用卡（提供 billing_day 及可选 override 字段）
 * @param cardProduct 卡产品（提供默认 payment_due_type / payment_due_value）
 * @param billMonth 账单月份（任意该月内的 Date 即可）
 */
export function getDueDate(card: CreditCard, cardProduct: CardProduct, billMonth: Date): Date {
  const { type, value } = getEffectiveDueConfig(card, cardProduct)
  const effectiveBillingDay = getEffectiveBillingDay(card)

  if (type === 'fixed') {
    // 还款日在账单月的下一个月
    const nextMonth = addMonths(billMonth, 1)
    const lastDay = lastDayOfMonth(nextMonth).getDate()
    const actualDay = Math.min(value, lastDay)
    return setDate(nextMonth, actualDay)
  } else if (type === 'fixed_before_billing') {
    // 还款日在账单月同月（账单日倒推模式）
    const lastDay = lastDayOfMonth(billMonth).getDate()
    const actualDay = Math.min(value, lastDay)
    return setDate(billMonth, actualDay)
  } else {
    // after_billing：账单日 + X 天
    const billingDate = getActualBillingDate(effectiveBillingDay, billMonth)
    return addDays(billingDate, value)
  }
}

/**
 * 计算贷款类卡的下一个还款日
 * - 今天是还款日 → 返回今天
 * - 今天在还款日之前 → 返回本月该日
 * - 今天在还款日之后 → 返回下月该日
 *
 * @param loanDueDay 每月还款日（1-31）
 * @param today 当前日期（默认 new Date()）
 */
export function getLoanNextDueDate(loanDueDay: number, today: Date = new Date()): Date {
  const d = new Date(today)
  d.setHours(0, 0, 0, 0)

  // 本月实际还款日（处理月末不足的情况）
  const thisMonthLastDay = lastDayOfMonth(d).getDate()
  const thisMonthDueDay = Math.min(loanDueDay, thisMonthLastDay)
  const thisMonthDue = setDate(new Date(d.getFullYear(), d.getMonth(), 1), thisMonthDueDay)

  if (d.getDate() <= thisMonthDue.getDate()) {
    return thisMonthDue
  }

  // 下月实际还款日
  const nextMonth = addMonths(d, 1)
  const nextMonthLastDay = lastDayOfMonth(nextMonth).getDate()
  const nextMonthDueDay = Math.min(loanDueDay, nextMonthLastDay)
  return setDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1), nextMonthDueDay)
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
 * 卡片尾号展示：只显示末 4 位。
 *
 * 存储层保留完整尾号原值（大陆/香港卡 4 位、American Express 5 位如 `93001`、
 * 个别 6 位如 `671006`），因为压缩成 4 位会撞车——`71006` 与 `671006` 的末四位
 * 都是 `1006`，截断后两张卡无法区分。因此展示层单独收敛到末 4 位。
 *
 * 仅供展示使用：不要把这个返回值写回数据库，也不要用于匹配/比较。
 * 输入为空或无数字时返回 `''`；不足 4 位时原样返回。
 */
export function formatCardTail(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits
}
