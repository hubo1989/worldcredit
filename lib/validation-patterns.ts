/** 全仓前后端共享的格式校验正则（离线白名单校验与服务端业务校验复用同一定义） */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function isValidUuid(value: unknown): value is string {
  // 直接校验原值（保留 /i 兼容 iOS 大写 UUID），保证守卫语义：
  // 通过校验的字符串本身即为规范无空白 UUID，避免带空白字符串混入数据库
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** 解析带时区信息的 ISO 8601 时间戳；返回 Unix 毫秒数，不合法返回 null */
export function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !ISO_TIMESTAMP_PATTERN.test(trimmed)) return null
  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? ms : null
}
