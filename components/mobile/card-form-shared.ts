// components/mobile/card-form-shared.ts

/**
 * ObsidianUI 持卡人默认头像颜色（对应 d-accent-light，暗色面板上清晰辨识）
 */
export const DEFAULT_HOLDER_AVATAR_COLOR = '#7aadff'

export const DUE_TYPE_LABELS = {
  after_billing: '账单日后 N 天',
  fixed: '每月固定日期',
} as const

export type DueRuleType = 'after_billing' | 'fixed'

/**
 * 校验每月账单日（1-31）
 */
export function validateBillingDay(dayInput: string | number | undefined | null): {
  valid: boolean
  value?: number
  error?: string
} {
  const str = String(dayInput ?? '').trim()
  if (!str) {
    return { valid: false, error: '请输入每月账单日' }
  }
  const dayNum = parseInt(str, 10)
  if (isNaN(dayNum) || !Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
    return { valid: false, error: '每月账单日必须在 1 到 31 之间' }
  }
  return { valid: true, value: dayNum }
}

/**
 * 校验还款规则覆盖
 */
export function validateDueRule(
  enabled: boolean,
  type: string,
  valueInput: string | number | undefined | null
): {
  valid: boolean
  value?: number
  error?: string
} {
  if (!enabled) {
    return { valid: true, value: undefined }
  }
  const str = String(valueInput ?? '').trim()
  if (!str) {
    return { valid: false, error: '开启自定义还款规则时必须填写还款日数值' }
  }
  const val = parseInt(str, 10)
  if (isNaN(val) || !Number.isInteger(val)) {
    return { valid: false, error: '还款日数值必须为有效整数' }
  }

  if (type === 'after_billing') {
    if (val < 0) {
      return { valid: false, error: '账单日后还款天数必须大于或等于 0' }
    }
  } else if (type === 'fixed') {
    if (val < 1 || val > 31) {
      return { valid: false, error: '固定还款日必须在 1 到 31 之间' }
    }
  }
  return { valid: true, value: val }
}

/**
 * 编辑时额度输入框语义解析：
 * - 留空（空字符串）：保留旧 override 不动（不传 credit_limit / credit_limit_override，即 undefined）
 * - 输入 0：显式清空 override 与 limit（传 credit_limit: 0, credit_limit_override: null）
 * - 输入 > 0 的正数：设置新额度与 override（传 credit_limit: num, credit_limit_override: num）
 */
export function resolveLimitOnEdit(limitStr: string): {
  valid: boolean
  credit_limit?: number
  credit_limit_override?: number | null
  error?: string
} {
  const trimmed = limitStr.trim()
  if (!trimmed) {
    // 留空：保持原有值不动
    return {
      valid: true,
      credit_limit: undefined,
      credit_limit_override: undefined,
    }
  }
  const num = parseFloat(trimmed)
  if (isNaN(num) || num < 0) {
    return { valid: false, error: '信用额度必须为非负数' }
  }
  if (num === 0) {
    return {
      valid: true,
      credit_limit: 0,
      credit_limit_override: null,
    }
  }
  return {
    valid: true,
    credit_limit: num,
    credit_limit_override: num,
  }
}

/**
 * 卡片尾号清洗：
 * - 留空：''（空字符串表示清空既有尾号，服务端会转换为 NULL）
 * - 1-4 位数字：合法尾号
 * - 其它：报错
 */
export function parseLast4(last4Input: string | undefined | null): {
  valid: boolean
  value?: string
  error?: string
} {
  const trimmed = String(last4Input ?? '').trim()
  if (!trimmed) {
    return { valid: true, value: '' }
  }
  if (!/^\d{1,4}$/.test(trimmed)) {
    return { valid: false, error: '卡号尾号必须为 1 到 4 位数字' }
  }
  return { valid: true, value: trimmed }
}
