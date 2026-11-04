// lib/api/payables.shared.ts — 周期应付的纯类型与纯函数（无数据库依赖）。
//
// 放在 .shared 而不是 .server：界面上要显示类型标签（房租/贷款），如果从
// .server 模块取这个纯函数，就会把 D1 相关的 import 链一起拖进浏览器包
// （与 preferences.shared.ts 同样的边界约定）。

export type PayableCategory = 'rent' | 'loan' | 'utility' | 'insurance' | 'other'

const CATEGORY_LABELS: Record<PayableCategory, string> = {
  rent: '房租',
  loan: '贷款',
  utility: '水电物业',
  insurance: '保险',
  other: '其他',
}

export const PAYABLE_CATEGORIES: { value: PayableCategory; label: string }[] = (
  Object.keys(CATEGORY_LABELS) as PayableCategory[]
).map(value => ({ value, label: CATEGORY_LABELS[value] }))

export function isPayableCategory(value: unknown): value is PayableCategory {
  return typeof value === 'string' && Object.hasOwn(CATEGORY_LABELS, value)
}

/** Select 下拉中代表「输入新自定义分类」的哨兵值。 */
export const CUSTOM_CATEGORY_SENTINEL = '__custom__'

/** 自定义分类名称最大长度。 */
export const MAX_CUSTOM_CATEGORY_LENGTH = 30

/**
 * 若输入与已有预设分类（英文枚举值或中文展示名）同义，返回对应预设枚举，
 * 避免把「房租」再存一份重复的自定义分类。
 */
export function resolvePresetPayableCategory(raw: unknown): PayableCategory | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (isPayableCategory(lower)) return lower
  for (const item of PAYABLE_CATEGORIES) {
    if (item.label === trimmed) return item.value
  }
  return null
}

/** 归一化自定义分类名称：去首尾空白并折叠内部连续空白；空串返回 null。 */
export function normalizeCustomCategoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const collapsed = raw.trim().replace(/\s+/g, ' ')
  return collapsed.length > 0 ? collapsed : null
}

/**
 * 自定义分类列表去重：
 *   1. 去首尾与多余空白、剔除空值；
 *   2. 排除与预设分类重名的项（防止出现两个「房租」）；
 *   3. 按大小写不敏感（toLowerCase）去重，保留首次出现的展示写法。
 */
export function dedupeCustomCategories(
  names: Iterable<string | null | undefined>
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const normalized = normalizeCustomCategoryName(raw)
    if (!normalized) continue
    if (resolvePresetPayableCategory(normalized) !== null) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

export function categoryLabel(
  category: PayableCategory,
  customCategory?: string | null
): string {
  const normalizedCustom = normalizeCustomCategoryName(customCategory)
  if (normalizedCustom) {
    const preset = resolvePresetPayableCategory(normalizedCustom)
    return preset ? CATEGORY_LABELS[preset] : normalizedCustom
  }
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other
}

// ── 固定支出周期（每月 / 每 X 月 / 每年）────────────────────────────────────

export const PAYABLE_CYCLE_TYPES = ['monthly', 'every_n_months', 'yearly'] as const

export type PayableCycleType = (typeof PAYABLE_CYCLE_TYPES)[number]

export const MIN_PAYABLE_CYCLE_MONTHS = 2
export const MAX_PAYABLE_CYCLE_MONTHS = 60

export const PAYABLE_CYCLE_LABELS: Record<PayableCycleType, string> = {
  monthly: '每月',
  every_n_months: '每 X 月',
  yearly: '每年',
}

export const PAYABLE_CYCLE_OPTIONS: { value: PayableCycleType; label: string }[] =
  PAYABLE_CYCLE_TYPES.map(value => ({ value, label: PAYABLE_CYCLE_LABELS[value] }))

export function isPayableCycleType(value: unknown): value is PayableCycleType {
  return (
    typeof value === 'string' &&
    (PAYABLE_CYCLE_TYPES as readonly string[]).includes(value)
  )
}

/** 校验每 X 月的间隔月数是否为合理整数（2–60）。 */
export function isValidEveryNMonths(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_PAYABLE_CYCLE_MONTHS &&
    value <= MAX_PAYABLE_CYCLE_MONTHS
  )
}

/** 校验账期字符串格式 'YYYY-MM'（1970–2100 年，01–12 月）。 */
export function isValidPayablePeriod(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim())
  if (!m) return false
  const year = Number(m[1])
  return year >= 1970 && year <= 2100
}

export interface PayableCycleSpec {
  cycle_type?: PayableCycleType | null
  cycle_months?: number | null
  due_month?: number | null
  due_day: number
  anchor_period?: string | null
}

/** 卡片副标题上的周期与应付日摘要文案。 */
export function payableCycleLabel(spec: PayableCycleSpec): string {
  const cycleType = spec.cycle_type ?? 'monthly'
  if (cycleType === 'every_n_months') {
    const months = spec.cycle_months ?? MIN_PAYABLE_CYCLE_MONTHS
    return `每 ${months} 个月 · ${spec.due_day} 日`
  }
  if (cycleType === 'yearly') {
    const fallbackMonth =
      spec.anchor_period && isValidPayablePeriod(spec.anchor_period)
        ? Number(spec.anchor_period.slice(5, 7))
        : 1
    const month = spec.due_month ?? fallbackMonth
    return `每年 ${month} 月 ${spec.due_day} 日`
  }
  return `每月 ${spec.due_day} 日`
}

/**
 * 固定支出的封闭币种集（2026-11-02 规则）：与生产库实际持有的卡币种一致
 * （CNY / USD / HKD），界面用下拉枚举、服务端白名单校验，不再接受自由文本。
 * 代码沿用 ISO-4217 三字码（fx/折算层按代码取汇率与符号），中文名只做展示；
 * 与 Swift `PayableCurrency` 由 `shared/fixtures/payable-currencies.json` 对齐。
 */
export const PAYABLE_CURRENCIES = ['CNY', 'USD', 'HKD'] as const

export type PayableCurrency = (typeof PAYABLE_CURRENCIES)[number]

export const PAYABLE_CURRENCY_LABELS: Record<PayableCurrency, string> = {
  CNY: '人民币 CNY',
  USD: '美元 USD',
  HKD: '港币 HKD',
}

/** 仅允许无歧义中文别名映射到对应 ISO 三字码；未知币种（如 EUR/RMB）绝不猜测。 */
const PAYABLE_CURRENCY_ALIASES: Record<string, PayableCurrency> = {
  人民币: 'CNY',
  美元: 'USD',
  港币: 'HKD',
}

/**
 * 归一化应付币种：trim + uppercase，并映射明确中文别名（人民币/美元/港币）。
 * 非法或封闭集外的币种（如 EUR）返回 null，绝不静默兜底为 CNY。
 */
export function normalizePayableCurrency(value: unknown): PayableCurrency | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const alias = PAYABLE_CURRENCY_ALIASES[trimmed]
  if (alias) return alias
  const upper = trimmed.toUpperCase()
  return (PAYABLE_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as PayableCurrency)
    : null
}

export function isPayableCurrency(value: unknown): value is PayableCurrency {
  return typeof value === 'string' && (PAYABLE_CURRENCIES as readonly string[]).includes(value)
}

/** 历史还款返回上限：服务端列表与前端「最近 N 笔」文案共用同一常量。 */
export const PAYABLE_HISTORY_LIMIT = 60
