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
 * 返回卡片实际生效的名称（卡级别覆盖 > 卡产品默认）
 */
export function getEffectiveCardName(
  card: Pick<CreditCard, 'name_override'> | undefined | null,
  cardProduct: Pick<CardProduct, 'card_name'> | undefined | null
): string {
  return card?.name_override || cardProduct?.card_name || '信用卡'
}

/**
 * 返回卡片实际生效的年费（卡级别覆盖 > 卡产品默认）
 */
export function getEffectiveAnnualFee(
  card: Pick<CreditCard, 'annual_fee_override'> | undefined | null,
  cardProduct: Pick<CardProduct, 'annual_fee'> | undefined | null
): number | null {
  if (card?.annual_fee_override != null) return Number(card.annual_fee_override)
  if (cardProduct?.annual_fee != null) return Number(cardProduct.annual_fee)
  return null
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
 * 归一化持卡人别名。
 *
 * D1 把 `card_holders.aliases` 声明为 TEXT，读回来是 JSON 字符串（如
 * `'["呼金堂"]'`）而不是数组；旧 Postgres 形态才是 `text[]`。
 * 组件里存在 `aliases.join('、')`、`aliases.length`、`aliases.forEach` 这类
 * 数组用法，直接吃字符串会抛 `aliases.join is not a function` 并让整页白屏。
 *
 * 在读取边界统一走这个函数，数组与 JSON 字符串两种历史形态都能安全通过；
 * 非 JSON 的脏值按「无别名」处理，宁可少显示也不阻断页面。
 */
export function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : []
    } catch {
      return []
    }
  }
  return []
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

// 账单的生效金额：用户手填值优先于一切导入来源。
//
// 导入方（邮件解析、Gmail 同步、LLM 抽取）只写 bill_amount；用户手填写
// bill_amount_override。两者都存、读取时按优先级合成，导入因此可以继续更新
// 「账单原始值」，而不会覆盖用户已经确认过的数字。
export function effectiveBillAmount(bill: {
  bill_amount?: number | null
  bill_amount_override?: number | null
}): number {
  const override = bill.bill_amount_override
  if (override !== null && override !== undefined) return Number(override)
  return Number(bill.bill_amount || 0)
}

// 是否被用户手填值钉住（导入不得覆盖）。
export function hasManualBillAmount(bill: {
  bill_amount_override?: number | null
}): boolean {
  return bill.bill_amount_override !== null && bill.bill_amount_override !== undefined
}

// 账单日临近判定：距下一次账单日不足 days 天（含当天）时允许手填金额。
// 用账单日而非到期日——出账前金额还是空的，正是需要用户先记一笔的时候。
export function canManuallySetBillAmount(
  billingDay: number,
  today: Date = new Date(),
  days = 5
): boolean {
  const remaining = daysUntilNextBilling(billingDay, today)
  return remaining >= 0 && remaining < days
}

// ── 周期性固定支出（房租 / 贷款 / 其他按月应付） ────────────────────────────

/**
 * 某个应付事项在 today 所处的账期（'YYYY-MM'）。
 *
 * 账期按「应付日所在的那个月」定义，不做「过了应付日就算下期」的滚动：
 * 房租 15 号到期，16 号仍然属于本月账期（只是已逾期），下个月才换期。
 * 这样逾期才表达得出来——滚动口径会把「本月该付没付」直接抹掉。
 */
export function payablePeriodOf(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

/** 某账期内该应付事项的到期日（处理 due_day > 当月天数，如 31 日）。 */
export function payableDueDate(dueDay: number, period: string): Date {
  const [year, month] = period.split('-').map(Number)
  const monthDate = new Date(year, month - 1, 1)
  return getActualBillingDate(dueDay, monthDate)
}

/**
 * 账单页卡片排序分组：逾期(0) → 待还款(1) → 其他(2)。
 *
 * 分组优先级是固定的，与用户选择的排序方式无关——排序方式只决定组内顺序。
 * 「部分还款」仍欠着钱，因此与「待还款」同组；只有未出账单/已结清落到最后一组。
 *
 * 之所以要固定分组：只按免息期或还款日排序时，一笔刚到期的账单会和一堆
 * 未出账单的卡混在一起，用户得逐张翻才能看出哪张该还。
 */
export type CardUrgencyStatus = 'overdue' | 'unpaid' | 'partial' | 'unissued'

export function cardUrgencyRank(status: CardUrgencyStatus): number {
  if (status === 'overdue') return 0
  if (status === 'unpaid' || status === 'partial') return 1
  return 2
}

/**
 * 账单距到期日的自然天数差：负数 = 已逾期天数，0 = 今天到期，正数 = 还剩几天。
 *
 * 为什么不用毫秒差：'2026-09-16' 这种无时区的日期串按 UTC 解析，在东八区会
 * 落回本地当天 08:00。直接用 (target - now) / 86400000 再取整，在跨日边界会
 * 差一天——用户看到「距离还款日 2 日」而徽章写着「逾期」。所以先把两侧都归一到
 * 本地零点再相减。
 */
export function diffInCalendarDays(target: string | Date, today: Date = new Date()): number {
  const t = typeof target === 'string' ? new Date(target) : target
  const localMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((localMidnight(t) - localMidnight(today)) / 86_400_000)
}

/**
 * 从多张未结清账单里挑出最该关注的一张：已逾期就挑逾期最久的，否则挑最近到期的。
 *
 * 为什么不能直接用第一张：一张卡可能同时挂着早期漏还的账单和刚出的新账单。
 * 只取第一张会让「本期还款日 2027-01-01」旁边写着「逾期 62 日」——日期和天数
 * 指向两张不同的账单，用户无法判断该还哪笔。
 */
export function pickDueReference<T extends { due_date: string }>(
  bills: T[],
  today: Date = new Date()
): { bill: T; days: number } | null {
  let best: { bill: T; days: number } | null = null
  for (const bill of bills) {
    const days = diffInCalendarDays(bill.due_date, today)
    if (best === null || days < best.days) {
      best = { bill, days }
    }
  }
  return best
}

/**
 * 到期距离的展示文案：逾期 X 日 / 今天还款日 / 距离还款日 X 日。
 *
 * 与 bills.server 的 computeStatus 保持同一口径：到期日当天不算逾期
 * （days = 0 是「今天还款日」），只有 days < 0 才进入逾期分支。
 */
export function dueDistanceLabel(days: number): string {
  if (days < 0) return `逾期 ${-days} 日`
  if (days === 0) return '今天还款日'
  return `距离还款日 ${days} 日`
}

/**
 * 下一次账单日：本月还没到账单日就用本月，否则用下月。
 *
 * 账单日大于当月天数时按当月最后一天算（2 月 30 日 → 2 月 28/29 日）。
 * 与 bills.server 的 calculateCardGracePeriod 是同一口径，那边算的是
 * 下期还款日，这里只取账单日本身。
 */
export function nextBillingDateOf(billingDay: number, today: Date = new Date()): Date {
  const day = Number.isFinite(billingDay) && billingDay >= 1 ? Math.min(billingDay, 31) : 10
  const thisMonthDay = Math.min(day, lastDayOfMonth(today).getDate())
  if (today.getDate() <= thisMonthDay) {
    return new Date(today.getFullYear(), today.getMonth(), thisMonthDay)
  }
  const nextMonth = addMonths(today, 1)
  return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(day, lastDayOfMonth(nextMonth).getDate()))
}

/** 距下一次账单日还有几天（0 = 今天就是账单日）。 */
export function daysUntilNextBilling(billingDay: number, today: Date = new Date()): number {
  return diffInCalendarDays(nextBillingDateOf(billingDay, today), today)
}

/** 账单页排序所需的最小卡片形状（便于单测，不依赖完整 RPC 类型）。 */
export interface BillsListCard {
  status: CardUrgencyStatus
  billingDay: number
  historyBills: { due_date: string; computed_status: string }[]
}

/**
 * 卡片在账单页里的排序键。
 *
 * tier 决定大分组，固定为：逾期(0) → 待还款/部分还款(1) → 未出账单/已结清(2)。
 * distance 是组内的「还有多远」，三个组各自用不同轴，但方向一致——都按
 * 距离升序，于是自然形成：
 *
 *   逾期组：days 为负，升序 = 逾期最长 → 逾期最短
 *   待还款组：days 非负，升序 = 距还款日最近 → 最远
 *   未出账单组：升序 = 距账单日最近 → 最远
 *
 * 逾期/待还款组用 pickDueReference 而不是 activeBill：卡片上显示的「逾期 X 日」
 * 就是拿这张账单算的，排序和显示必须同源，否则可见数字会不单调、看起来像坏了。
 */
export function billsListSortKey(
  card: BillsListCard,
  today: Date = new Date()
): { tier: number; distance: number } {
  const tier = cardUrgencyRank(card.status)
  if (tier === 2) {
    return { tier, distance: daysUntilNextBilling(card.billingDay, today) }
  }
  const unpaid = card.historyBills.filter(b => b.computed_status !== 'paid')
  const ref = pickDueReference(unpaid, today)
  // 理论上 tier<2 时一定有未结清账单；真出现空集时给 0，不让它排到最前或最后。
  return { tier, distance: ref ? ref.days : 0 }
}

/** 账单页卡片比较器：先比 tier，再比组内 distance，都按升序。 */
export function compareBillsListCards(
  a: BillsListCard,
  b: BillsListCard,
  today: Date = new Date()
): number {
  const ka = billsListSortKey(a, today)
  const kb = billsListSortKey(b, today)
  if (ka.tier !== kb.tier) return ka.tier - kb.tier
  return ka.distance - kb.distance
}
