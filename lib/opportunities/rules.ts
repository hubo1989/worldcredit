// lib/opportunities/rules.ts — runtime validation for RuleSnapshotV1 and the
// legacy benefit → rule adapter. TypeScript types are documentation, never the
// validator: every field is checked here with path-bearing errors, unknown
// schema versions are refused, and legacy conversions stay unverified
// (their cycle anchors and effective dates need human confirmation).

import { isValidCivilDate, isValidIanaTimeZone, isValidRfc3339Utc } from './dates'
import type { RuleSnapshotV1 } from './types'

/** Currencies the project recognizes, with their minor-unit scale. */
export const KNOWN_CURRENCIES: Readonly<Record<string, number>> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  JPY: 0,
}

const CATEGORIES = new Set(['food', 'shopping', 'transport', 'travel', 'health', 'membership', 'other'])
const CYCLE_KINDS = new Set(['daily', 'weekly', 'monthly', 'annual', 'anniversary', 'one_time'])
const ALLOCATIONS = new Set(['recurring', 'claim_gated', 'grant_only'])

const RULE_FIELDS = new Set([
  'schema_version', 'title', 'description', 'category', 'time_zone', 'bank_id',
  'card_product_ids', 'valid_from', 'valid_until_before', 'open_ended', 'weekdays',
  'cycle', 'allocation', 'count_limit', 'amount_limit_minor', 'currency', 'unit_label',
  'eligibility_text', 'requires_personal_confirmation', 'claim_window', 'booking_window',
  'workflow_time_basis', 'booking_consumes', 'cancellation_rule', 'entry',
])

function fail(path: string, message: string): never {
  throw new Error(`RuleSnapshotV1.${path}: ${message}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '必须是 boolean')
  return value
}

function requireString(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail(path, '必须是 string')
  if (!allowEmpty && value.length === 0) fail(path, '不能为空')
  if (value.length > max) fail(path, `长度不能超过 ${max}`)
  return value
}

function requireNullableString(value: unknown, path: string, max: number): string | null {
  if (value === null) return null
  return requireString(value, path, max)
}

function requireCivilDateOrNull(value: unknown, path: string): string | null {
  if (value === null) return null
  if (!isValidCivilDate(value)) fail(path, '必须是合法 civil date (YYYY-MM-DD)')
  return value
}

function requireCountOrNull(value: unknown, path: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(path, '必须是非负整数或 null（0 合法，null 表示不限）')
  }
  return value
}

/** Validates a {start,end} RFC3339 window; returns the pair or null. */
function validateWindowPair(
  value: unknown,
  path: string,
  fields: [string, string],
): [string | null, string | null] | null {
  if (value === null) return null
  if (!isPlainObject(value)) fail(path, '必须是对象或 null')
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) fail(path, `不允许未知字段 ${key}`)
  }
  const startField = value[fields[0]]
  const endField = value[fields[1]]
  for (const [name, v] of [[fields[0], startField], [fields[1], endField]] as const) {
    if (v === null || v === undefined) continue
    if (!isValidRfc3339Utc(v)) fail(`${path}.${name}`, '必须是 RFC3339 UTC 时间（…Z）')
  }
  if (typeof startField === 'string' && typeof endField === 'string' && endField <= startField) {
    fail(path, `${fields[1]} 必须晚于 ${fields[0]}`)
  }
  const start = typeof startField === 'string' ? startField : null
  const end = typeof endField === 'string' ? endField : null
  return [start, end]
}

/**
 * Validates an untrusted rules payload and returns it as RuleSnapshotV1.
 * Throws on the first problem; messages carry the field path so callers and
 * tests can pinpoint the rejection.
 */
export function validateRuleSnapshot(input: unknown): RuleSnapshotV1 {
  if (!isPlainObject(input)) fail('', '必须是对象')
  for (const key of Object.keys(input)) {
    if (!RULE_FIELDS.has(key)) fail(key, '不允许未知字段')
  }

  if (input.schema_version !== 1) fail('schema_version', '必须是 1（未识别的 schema 版本需升级读取端）')
  const title = requireString(input.title, 'title', 120)
  const description = requireNullableString(input.description, 'description', 2000)
  if (!CATEGORIES.has(input.category as string)) fail('category', `必须是 ${[...CATEGORIES].join('/')}`)
  if (!isValidIanaTimeZone(input.time_zone)) fail('time_zone', '必须是合法 IANA 时区')
  const bankId = requireNullableString(input.bank_id, 'bank_id', 64)
  if (!Array.isArray(input.card_product_ids)) fail('card_product_ids', '必须是数组')
  const cardProductIds = input.card_product_ids.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      fail(`card_product_ids[${i}]`, '必须是非空 string')
    }
    return id
  })
  if (cardProductIds.length > 100) fail('card_product_ids', '最多 100 个产品')

  const validFrom = requireCivilDateOrNull(input.valid_from, 'valid_from')
  const validUntilBefore = requireCivilDateOrNull(input.valid_until_before, 'valid_until_before')
  if (validFrom !== null && validUntilBefore !== null && validUntilBefore <= validFrom) {
    fail('valid_until_before', '必须晚于 valid_from（半开区间）')
  }
  const openEnded = requireBoolean(input.open_ended, 'open_ended')
  if (openEnded && validUntilBefore !== null) {
    fail('open_ended', '为 true 时不能同时设置 valid_until_before（无期限与缺失截止是不同状态）')
  }

  let weekdays: number[] | null = null
  if (input.weekdays !== null) {
    if (!Array.isArray(input.weekdays)) fail('weekdays', '必须是数组或 null')
    weekdays = input.weekdays.map((d) => {
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7) {
        fail('weekdays', '元素必须是 1..7 的整数（ISO，1=周一）')
      }
      return d
    })
    for (let i = 1; i < weekdays.length; i++) {
      if (weekdays[i] <= weekdays[i - 1]) fail('weekdays', '必须严格升序且不重复')
    }
  }

  const cycle = input.cycle
  if (!isPlainObject(cycle)) fail('cycle', '必须是对象')
  for (const key of ['kind', 'anchor_month', 'anchor_day', 'anchor_source']) {
    if (!(key in cycle)) fail('cycle', `缺少字段 ${key}`)
  }
  if (!CYCLE_KINDS.has(cycle.kind as string)) {
    fail('cycle.kind', `必须是 ${[...CYCLE_KINDS].join('/')}`)
  }
  const kind = cycle.kind as RuleSnapshotV1['cycle']['kind']
  const requiresMonth = kind === 'annual'
  const requiresSource = kind === 'anniversary'
  const allowsDay = kind === 'monthly' || kind === 'annual'

  let anchorMonth: number | null = null
  if (requiresMonth) {
    if (typeof cycle.anchor_month !== 'number' || !Number.isInteger(cycle.anchor_month) || cycle.anchor_month < 1 || cycle.anchor_month > 12) {
      fail('cycle.anchor_month', 'annual 周期必须是 1..12')
    }
    anchorMonth = cycle.anchor_month
  } else if (cycle.anchor_month !== null) {
    fail('cycle.anchor_month', `仅 annual 周期使用 anchor_month（当前 kind=${kind}）`)
  }

  let anchorDay: number | null = null
  if (cycle.anchor_day !== null && cycle.anchor_day !== undefined) {
    if (typeof cycle.anchor_day !== 'number' || !Number.isInteger(cycle.anchor_day) || cycle.anchor_day < 1 || cycle.anchor_day > 31) {
      fail('cycle.anchor_day', '必须是 1..31 的整数或 null')
    }
    if (!allowsDay) fail('cycle.anchor_day', `当前 kind=${kind} 不使用 anchor_day`)
    anchorDay = cycle.anchor_day
  }

  let anchorSource: RuleSnapshotV1['cycle']['anchor_source'] = null
  if (requiresSource) {
    if (cycle.anchor_source !== 'issued_on' && cycle.anchor_source !== 'activated_on') {
      fail('cycle.anchor_source', 'anniversary 周期必须是 issued_on 或 activated_on')
    }
    anchorSource = cycle.anchor_source
  } else if (cycle.anchor_source !== null) {
    fail('cycle.anchor_source', `仅 anniversary 周期使用 anchor_source（当前 kind=${kind}）`)
  }

  if (!ALLOCATIONS.has(input.allocation as string)) {
    fail('allocation', `必须是 ${[...ALLOCATIONS].join('/')}`)
  }
  const countLimit = requireCountOrNull(input.count_limit, 'count_limit')
  const amountLimitMinor = requireCountOrNull(input.amount_limit_minor, 'amount_limit_minor')
  let currency: string | null = null
  if (amountLimitMinor !== null) {
    if (typeof input.currency !== 'string' || !(input.currency in KNOWN_CURRENCIES)) {
      fail('currency', `金额上限存在时 currency 必须是认可货币（${Object.keys(KNOWN_CURRENCIES).join('/')}）`)
    }
    currency = input.currency
  } else if (input.currency !== null) {
    fail('currency', '仅在 amount_limit_minor 非 null 时允许设置')
  }

  const unitLabel = requireString(input.unit_label, 'unit_label', 16)
  const eligibilityText = requireNullableString(input.eligibility_text, 'eligibility_text', 500)
  requireBoolean(input.requires_personal_confirmation, 'requires_personal_confirmation')

  const claimPair = validateWindowPair(input.claim_window, 'claim_window', ['starts_at', 'ends_at'])
  const claimWindow = claimPair ? { starts_at: claimPair[0], ends_at: claimPair[1] } : null
  const bookingPair = validateWindowPair(input.booking_window, 'booking_window', ['opens_at', 'closes_at'])
  const bookingWindow = bookingPair ? { opens_at: bookingPair[0], closes_at: bookingPair[1] } : null

  if (input.workflow_time_basis !== 'fixed' && input.workflow_time_basis !== 'per_cycle') {
    fail('workflow_time_basis', '必须是 fixed 或 per_cycle')
  }
  if (input.booking_consumes !== 'reserve_then_use') fail('booking_consumes', "必须是 'reserve_then_use'")
  if (input.cancellation_rule !== 'confirm_with_issuer') fail('cancellation_rule', "必须是 'confirm_with_issuer'")

  const entry = input.entry
  if (!isPlainObject(entry)) fail('entry', '必须是对象')
  for (const key of Object.keys(entry)) {
    if (!['website_url', 'app_name', 'app_path'].includes(key)) fail('entry', `不允许未知字段 ${key}`)
  }
  const websiteUrl = entry.website_url ?? null
  if (websiteUrl !== null) {
    if (typeof websiteUrl !== 'string' || !/^https?:\/\//.test(websiteUrl) || websiteUrl.length > 500) {
      fail('entry.website_url', '必须是 http(s) URL')
    }
  }

  return {
    schema_version: 1,
    title,
    description,
    category: input.category as RuleSnapshotV1['category'],
    time_zone: input.time_zone,
    bank_id: bankId,
    card_product_ids: cardProductIds,
    valid_from: validFrom,
    valid_until_before: validUntilBefore,
    open_ended: openEnded,
    weekdays,
    cycle: { kind, anchor_month: anchorMonth, anchor_day: anchorDay, anchor_source: anchorSource },
    allocation: input.allocation as RuleSnapshotV1['allocation'],
    count_limit: countLimit,
    amount_limit_minor: amountLimitMinor,
    currency,
    unit_label: unitLabel,
    eligibility_text: eligibilityText,
    requires_personal_confirmation: input.requires_personal_confirmation as boolean,
    claim_window: claimWindow,
    booking_window: bookingWindow,
    workflow_time_basis: input.workflow_time_basis as 'fixed' | 'per_cycle',
    booking_consumes: 'reserve_then_use',
    cancellation_rule: 'confirm_with_issuer',
    entry: {
      website_url: websiteUrl,
      app_name: requireNullableString(entry.app_name ?? null, 'entry.app_name', 64),
      app_path: requireNullableString(entry.app_path ?? null, 'entry.app_path', 128),
    },
  }
}

/** Shape of the legacy benefits table rows the adapter consumes. */
export interface LegacyBenefitLike {
  card_product_id: string
  name: string
  description: string | null
  quota: number
  period: 'yearly' | 'monthly' | 'one_time'
  reset_month: number | null
  expiry_date: string | null
}

/**
 * Converts a legacy catalog benefit into a RuleSnapshotV1 that passes the
 * validator. Conversions are intentionally conservative: unverified timezone
 * defaults to the site default, yearly resets anchor at the recorded month
 * (or January), and one_time keeps valid_from null because no legacy source
 * can prove when the benefit actually started — windowing it stays a human
 * confirmation away.
 */
export function legacyBenefitToRules(benefit: LegacyBenefitLike): RuleSnapshotV1 {
  const cycle =
    benefit.period === 'monthly'
      ? { kind: 'monthly' as const, anchor_month: null, anchor_day: null, anchor_source: null }
      : benefit.period === 'yearly'
        ? {
            kind: 'annual' as const,
            anchor_month: benefit.reset_month ?? 1,
            anchor_day: 1,
            anchor_source: null,
          }
        : { kind: 'one_time' as const, anchor_month: null, anchor_day: null, anchor_source: null }

  // Legacy expiry_date is inclusive; half-open windows need the next day.
  const validUntilBefore = benefit.expiry_date ? addOneDay(benefit.expiry_date) : null

  const rules: RuleSnapshotV1 = {
    schema_version: 1,
    title: benefit.name,
    description: benefit.description,
    category: 'other',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    card_product_ids: benefit.card_product_id ? [benefit.card_product_id] : [],
    valid_from: null,
    valid_until_before: validUntilBefore,
    open_ended: validUntilBefore === null,
    weekdays: null,
    cycle,
    allocation: 'recurring',
    count_limit: benefit.quota,
    amount_limit_minor: null,
    currency: null,
    unit_label: '次',
    eligibility_text: null,
    requires_personal_confirmation: false,
    claim_window: null,
    booking_window: null,
    workflow_time_basis: 'fixed',
    booking_consumes: 'reserve_then_use',
    cancellation_rule: 'confirm_with_issuer',
    entry: { website_url: null, app_name: null, app_path: null },
  }
  return validateRuleSnapshot(rules)
}

function addOneDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}
