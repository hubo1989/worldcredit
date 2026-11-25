// lib/api/direction3.shared.ts — 方向 3（交易明细 / 分期 / 现金流预测）的
// 纯类型与纯计算函数：零数据库依赖，可被 Worker、浏览器组件与 Vitest 直接引用。
//
// 为什么不放进 lib/finance/*：那是 HUB-169 的独占目录（迁移 + 纯财务内核），
// 本文件只承载 HUB-170 自己消费的那部分计算，等 lib/finance 落地后由它承接。

import {
  addMonthsToPayablePeriod,
  payableDueDate,
  diffInCalendarDays,
} from '../utils'
import { convert, type FxRates, type FxSum } from '../fx'
import { RpcDomainError } from './errors'

// ── 消费分类 ────────────────────────────────────────────────────────────────

/** 标准 10 类消费分类（与 0040 的 CHECK 枚举严格一致）。 */
export const SPEND_CATEGORIES = [
  'dining',
  'shopping',
  'transport',
  'travel',
  'utilities',
  'entertainment',
  'medical',
  'education',
  'fees_interest',
  'other',
] as const

export type SpendCategory = (typeof SPEND_CATEGORIES)[number]

export const UNCATEGORIZED_KEY = 'uncategorized'

export const SPEND_CATEGORY_LABELS: Record<SpendCategory | typeof UNCATEGORIZED_KEY, string> = {
  dining: '餐饮',
  shopping: '购物',
  transport: '出行',
  travel: '旅行',
  utilities: '生活缴费',
  entertainment: '娱乐',
  medical: '医疗',
  education: '教育',
  fees_interest: '费用与利息',
  other: '其他',
  uncategorized: '未分类',
}

export function categoryLabel(category: string | null | undefined): string {
  const key = (category || UNCATEGORIZED_KEY) as SpendCategory | typeof UNCATEGORIZED_KEY
  return SPEND_CATEGORY_LABELS[key] ?? key
}

/** 账单明细类型（0040 重建后的 6 类）。 */
export type BillItemType =
  | 'purchase'
  | 'refund'
  | 'fee'
  | 'interest'
  | 'installment'
  | 'adjustment'

/** 金额口径：refund 存正数，净额取负；其余取绝对值。 */
export function signedItemAmount(item: { item_type: BillItemType; amount: number }): number {
  if (item.item_type === 'refund') return -Math.abs(item.amount)
  if (item.item_type === 'adjustment') return item.amount
  return Math.abs(item.amount)
}

/** 商户归一化：NFKC + 小写 + 剥离支付渠道前缀与分店尾号，供「同商户退款归属」匹配。 */
export function normalizeMerchantKey(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(支付宝|微信支付|财付通|alipay\*?|sq \*|paypal \*)[-\s]*/i, '')
    .replace(/#\d+$|\d+店$/, '')
    .trim()
}

// ── 数值精度 ────────────────────────────────────────────────────────────────

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

// ── 分期摊销 ────────────────────────────────────────────────────────────────

/** 与 0041 `installment_plans` 的字段一一对应（只保留计算所需列）。 */
export interface InstallmentPlanLike {
  id?: string
  card_id?: string
  currency: string
  principal_amount: number
  total_periods: number
  paid_periods: number
  fee_mode: 'interest_free' | 'equal_principal_fee' | 'equal_installment_apr'
  fee_charge_mode?: 'per_period' | 'upfront' | null
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
  apr?: number | null
  start_month: string
  due_day: number
  due_month_offset?: number | null
  billing_mode?: 'included_in_statement' | 'independent' | null
  status?: string | null
  title?: string | null
}

export interface InstallmentPeriod {
  /** 1-based 期次。 */
  period_index: number
  /** 入账月份 'YYYY-MM'。 */
  bill_month: string
  /** 实际还款日 'YYYY-MM-DD'（已叠加 due_month_offset 与大小月收拢）。 */
  due_date: string
  principal: number
  fee: number
  total: number
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/**
 * 三种期供的纯函数展开，严格保证 Σ principal_i === principal_amount（末期尾差兜底）。
 * 1. interest_free：前 N-1 期均摊，末期补齐尾差；
 * 2. equal_principal_fee：本金同上，手续费按 per_period / upfront 两种charge mode；
 * 3. equal_installment_apr：等额本息，月利率 r = apr / 12，末期本金清零。
 */
export function generateInstallmentSchedule(plan: InstallmentPlanLike): InstallmentPeriod[] {
  const principal = Number(plan.principal_amount) || 0
  const total = Math.max(1, Math.trunc(Number(plan.total_periods) || 0))
  const principals: number[] = []
  const fees: number[] = []

  if (plan.fee_mode === 'equal_installment_apr') {
    const apr = Number(plan.apr) || 0
    const monthlyRate = apr / 12
    if (monthlyRate <= 0) {
      for (let i = 0; i < total; i++) principals.push(round2(principal / total))
      principals[total - 1] = round2(principal - principals.slice(0, -1).reduce((a, b) => a + b, 0))
      for (let i = 0; i < total; i++) fees.push(0)
    } else {
      const factor = Math.pow(1 + monthlyRate, total)
      const annuity = round2((principal * monthlyRate * factor) / (factor - 1))
      let remaining = principal
      for (let i = 1; i <= total; i++) {
        const fee = round2(remaining * monthlyRate)
        fees.push(fee)
        if (i === total) {
          principals.push(round2(remaining))
        } else {
          const current = round2(Math.min(remaining, Math.max(0, annuity - fee)))
          principals.push(current)
          remaining = round2(remaining - current)
        }
      }
    }
  } else {
    for (let i = 0; i < total; i++) principals.push(round2(principal / total))
    principals[total - 1] = round2(principal - principals.slice(0, -1).reduce((a, b) => a + b, 0))
    if (plan.fee_mode === 'interest_free') {
      for (let i = 0; i < total; i++) fees.push(0)
    } else {
      const perPeriodFee =
        plan.custom_period_fee != null && plan.custom_period_fee > 0
          ? round2(plan.custom_period_fee)
          : round2(principal * (Number(plan.fee_rate_per_period) || 0))
      const upfront = plan.fee_charge_mode === 'upfront'
      for (let i = 0; i < total; i++) fees.push(upfront ? (i === 0 ? perPeriodFee : 0) : perPeriodFee)
    }
  }

  return principals.map((currentPrincipal, index) => {
    const billMonth = addMonthsToPayablePeriod(plan.start_month, index)
    const dueMonth = addMonthsToPayablePeriod(billMonth, plan.due_month_offset ?? 0)
    return {
      period_index: index + 1,
      bill_month: billMonth,
      due_date: formatDate(payableDueDate(plan.due_day, dueMonth)),
      principal: currentPrincipal,
      fee: fees[index] ?? 0,
      total: round2(currentPrincipal + (fees[index] ?? 0)),
    }
  })
}

/** 未出账剩余本金：按摊销表精确求和，而非 principal * 剩余期数比例。 */
export function remainingInstallmentPrincipal(plan: InstallmentPlanLike): number {
  const schedule = generateInstallmentSchedule(plan)
  const paid = Math.max(0, Math.trunc(Number(plan.paid_periods) || 0))
  return round2(
    schedule
      .filter(period => period.period_index > paid)
      .reduce((sum, period) => sum + period.principal, 0),
  )
}

/** 下一期待还（已结清返回 null）。 */
export function nextInstallmentPeriod(
  plan: InstallmentPlanLike,
): InstallmentPeriod | null {
  const schedule = generateInstallmentSchedule(plan)
  const paid = Math.max(0, Math.trunc(Number(plan.paid_periods) || 0))
  return schedule.find(period => period.period_index === paid + 1) ?? null
}

// ── 还款汇率锁定 ────────────────────────────────────────────────────────────

export interface PaymentFxLockInput {
  settled_currency?: string | null
  settled_amount?: number | null
  locked_fx_rate?: number | null
}

export interface PaymentFxLock {
  settled_currency: string | null
  settled_amount: number | null
  locked_fx_rate: number | null
}

const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/

/**
 * 汇率锁定三列的归一与容差校验：
 * - 三列全空 → 全 null（该笔还款按账单原币计入）；
 * - 目标币种与账单币种相同 → 也归一为全 null（无需锁定，避免 1:1 假汇率）；
 * - 任一非空 → 强制三列齐全、正数、合法 3 位币种码，
 *   且 |amount × locked_fx_rate − settled_amount| ≤ 0.05。
 */
export function validateAndNormalizeFxLock(
  input: PaymentFxLockInput | null | undefined,
  amount: number,
  billCurrency: string,
): PaymentFxLock {
  const settledCurrency =
    typeof input?.settled_currency === 'string' && input.settled_currency.trim()
      ? input.settled_currency.trim().toUpperCase()
      : null
  const settledAmount =
    input?.settled_amount === null || input?.settled_amount === undefined
      ? null
      : Number(input.settled_amount)
  const lockedRate =
    input?.locked_fx_rate === null || input?.locked_fx_rate === undefined
      ? null
      : Number(input.locked_fx_rate)

  if (!settledCurrency && settledAmount === null && lockedRate === null) {
    return { settled_currency: null, settled_amount: null, locked_fx_rate: null }
  }
  if (settledCurrency && settledCurrency === billCurrency.toUpperCase()) {
    return { settled_currency: null, settled_amount: null, locked_fx_rate: null }
  }
  if (
    !settledCurrency ||
    !CURRENCY_CODE_RE.test(settledCurrency) ||
    settledAmount === null ||
    !Number.isFinite(settledAmount) ||
    settledAmount <= 0 ||
    lockedRate === null ||
    !Number.isFinite(lockedRate) ||
    lockedRate <= 0
  ) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      '汇率锁定需要同时填写实付币种、实付金额与锁定汇率，且三者均须为正数',
    )
  }
  if (Math.abs(amount * lockedRate - settledAmount) > 0.05) {
    throw new RpcDomainError(
      'VALIDATION_FAILED',
      '锁定汇率与实付金额不一致（账单金额 × 汇率应等于实付金额）',
    )
  }
  return {
    settled_currency: settledCurrency,
    settled_amount: round2(settledAmount),
    locked_fx_rate: round6(lockedRate),
  }
}

/** 历史成本折算的输入：账单原币 + 可选锁定三列。 */
export interface LockedPaymentLike {
  amount: number
  /** 还款所属账单的币种。 */
  bill_currency: string
  settled_currency?: string | null
  settled_amount?: number | null
  locked_fx_rate?: number | null
}

/**
 * 历史已还成本锁定聚合（AC-3.2）：
 *   1. 实付币种 == 目标币种 → 直接累加 settled_amount，完全跳过实时汇率
 *      （即使 rates 为 null 或汇率波动，结果恒定不变）；
 *   2. 实付币种 != 目标币种 → 用 settled_amount 折算；
 *   3. 未锁定 → 用账单原币 amount 折算。
 * 折算失败的币种记入 unconverted_currencies，绝不 1:1 相加。
 */
export function sumPaymentsWithLockedFx(
  payments: LockedPaymentLike[],
  targetCurrency: string,
  rates: FxRates | null,
): FxSum {
  const byCurrency: Record<string, number> = {}
  const unconverted = new Set<string>()
  let total = 0
  let converted = true
  const target = targetCurrency.toUpperCase()

  for (const payment of payments) {
    const settledCurrency = payment.settled_currency?.toUpperCase() || null
    const settledAmount = Number(payment.settled_amount)
    const hasLocked = !!settledCurrency && Number.isFinite(settledAmount) && settledAmount > 0

    let amount = Number(payment.amount) || 0
    let currency = payment.bill_currency
    if (hasLocked) {
      amount = settledAmount
      currency = settledCurrency as string
    }

    byCurrency[currency] = round2((byCurrency[currency] ?? 0) + amount)

    if (currency.toUpperCase() === target) {
      total += amount
      continue
    }
    const result = convert(amount, currency, target, rates)
    if (result === null) {
      converted = false
      unconverted.add(currency)
      continue
    }
    total += result
  }

  return {
    converted_currency: target,
    by_currency: byCurrency,
    total: round2(total),
    converted,
    unconverted_currencies: Array.from(unconverted).sort(),
    mixed: Object.keys(byCurrency).length > 1,
  }
}

// ── 现金流预测 ──────────────────────────────────────────────────────────────

export const CASHFLOW_HORIZONS = [30, 60, 90] as const
export type CashflowHorizon = (typeof CASHFLOW_HORIZONS)[number]

export interface CashflowForecastFilters {
  holder_id?: string
  card_id?: string
  horizon_days: CashflowHorizon
  /** 折算目标币种，缺省回落 CNY。 */
  display_currency?: string
}

export type CashflowSource = 'bill' | 'installment' | 'payable'

export interface CashflowEvent {
  source: CashflowSource
  ref_id: string
  title: string
  due_date: string
  days_until_due: number
  amount: number
  currency: string
  holder_id?: string | null
  card_tail?: string | null
}

export interface CashflowBucket {
  label: string
  start_date: string
  end_date: string
  by_currency: Record<string, number>
  /** 折算后的堆叠值。 */
  bill: number
  installment: number
  payable: number
  total: number
}

export interface OverdueAlert {
  count: number
  by_currency: Record<string, number>
  total_converted: number
  fx_converted: boolean
  items: CashflowEvent[]
}

export interface CashflowForecastResult {
  /** 预测基准日（Asia/Shanghai 自然日）。 */
  base_date: string
  horizon_days: CashflowHorizon
  display_currency: string
  /** 无视汇率可用性的分币种准备金，永远 100% 完整。 */
  reserves_by_currency: Record<
    string,
    { bill: number; installment: number; payable: number; total: number }
  >
  /** 折算后的合计与汇率元数据。 */
  converted_summary: {
    converted_currency: string
    by_currency: Record<string, number>
    total: number
    converted: boolean
    unconverted_currencies: string[]
    mixed: boolean
  }
  buckets: CashflowBucket[]
  timeline: CashflowEvent[]
  overdue_alert: OverdueAlert
}

/**
 * 30 天窗口按 5 个周桶（今日 / 1-7 / 8-14 / 15-21 / 22-30），
 * 60/90 天按自然月桶（YYYY-MM）。
 */
export function bucketLabelForDate(horizonDays: CashflowHorizon, date: string, baseDate: string): string {
  if (horizonDays === 30) {
    const days = diffInCalendarDays(date, new Date(`${baseDate}T00:00:00`))
    if (days <= 0) return '今日'
    if (days <= 7) return '1-7天'
    if (days <= 14) return '8-14天'
    if (days <= 21) return '15-21天'
    return '22-30天'
  }
  return date.slice(0, 7)
}

/** 桶的起止日期：30 天固定分段；60/90 天为自然月首末日。 */
export function bucketRange(
  horizonDays: CashflowHorizon,
  label: string,
  baseDate: string,
): { start_date: string; end_date: string } {
  if (horizonDays !== 30) {
    const [year, month] = label.split('-').map(Number)
    const lastDay = new Date(year, month, 0).getDate()
    return { start_date: `${label}-01`, end_date: `${label}-${String(lastDay).padStart(2, '0')}` }
  }
  const ranges: Record<string, [number, number]> = {
    今日: [0, 0],
    '1-7天': [1, 7],
    '8-14天': [8, 14],
    '15-21天': [15, 21],
    '22-30天': [22, 30],
  }
  const [from, to] = ranges[label] ?? [0, 0]
  const shift = (days: number): string => {
    const date = new Date(`${baseDate}T00:00:00`)
    date.setDate(date.getDate() + days)
    return formatDate(date)
  }
  return { start_date: shift(from), end_date: shift(to) }
}

/** 固定桶顺序（保证空桶也出现在图表里）。 */
export function orderedBucketLabels(horizonDays: CashflowHorizon, baseDate: string): string[] {
  if (horizonDays === 30) return ['今日', '1-7天', '8-14天', '15-21天', '22-30天']
  const labels: string[] = []
  let period = baseDate.slice(0, 7)
  for (let i = 0; i < Math.ceil(horizonDays / 28); i++) {
    labels.push(period)
    period = addMonthsToPayablePeriod(period, 1)
  }
  return labels
}
