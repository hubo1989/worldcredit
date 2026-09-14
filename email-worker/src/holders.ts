/**
 * 持卡人识别。
 *
 * 背景：一个 WorldCredit 用户（userId）名下可以有多个持卡人（card_holders），
 * 家庭成员的卡各归各人。转发账单包里每封嵌套邮件的「To 头显示名」或「正文称呼」
 * 就是那张卡真正的主人，所以匹配必须先落到持卡人，再在该持卡人范围内找卡。
 *
 * 这里刻意只做「认人」，不碰数据库；查库和建卡都在 bills.ts。
 */

import type { RawAttachment } from './types'

/** 从 DB 读出来的持卡人最小字段（aliases 已在读取边界归一化成数组）。 */
export interface HolderRecord {
  id: string
  name: string
  aliases: string[]
}

/** 姓名归一化：去首尾空白、去内部空白、小写。
 *  刻意**不**剥掉「先生/女士」这类称谓——库里存的是「张改菊」，
 *  如果用剥过称谓的串当匹配键，就会出现「张改菊女士」匹配不上「张改菊」的假阴性。
 *  剥称谓只发生在派生候选名的那一步。 */
export function normalizeName(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
}

const HONORIFIC_SUFFIXES = ['先生', '女士', '小姐', '太太', '夫人', '同志', '老师']

/** 去掉结尾称谓（「呼博先生」-> 「呼博」）；没有称谓就返回 null。 */
export function stripHonorificSuffix(value: string): string | null {
  for (const suffix of HONORIFIC_SUFFIXES) {
    if (value.length > suffix.length && value.endsWith(suffix)) {
      return value.slice(0, -suffix.length)
    }
  }
  return null
}

/** 纯中文/字母姓名判定，用来挡住「用户」「客户」这类称呼被当成名字。 */
function isNameLike(value: string): boolean {
  if (value.length < 2 || value.length > 6) return false
  return /^[\u4e00-\u9fa5]+$/.test(value)
}

/** 正文称呼与占位称呼：它们不是持卡人姓名，出现在候选里必须丢掉。 */
const GENERIC_ADDRESSES = new Set([
  '用户', '客户', '顾客', '您', '本人', '先生', '女士', '小姐', '持卡人', '会员', '贵宾', '阁下',
  '尊敬的用户', '亲爱的用户',
])

function isGenericAddress(value: string): boolean {
  if (GENERIC_ADDRESSES.has(value)) return true
  return /^(用户|客户|顾客|贵宾|会员)/.test(value)
}

/**
 * 从正文里解出被称呼的名字。
 * 覆盖银行账单里实际出现的两种写法：
 *   - 尊敬的呼博先生 / 尊敬的高敏女士：
 *   - 亲爱的呼博，
 * 只认「称呼 + 姓名 + 称谓/标点」这种强信号，避免把正文里任意中文短语当人名。
 */
export function extractNameFromBody(text: string | null | undefined): string | null {
  if (!text) return null
  // 用 lookbehind 而不是裸的「致」，否则「【精致生活，便捷还款】」里的『致生活』会被当成姓名。
  // 三种写法都是银行账单里实际出现过的强信号：
  //   尊敬的呼博先生 / 尊敬的高敏女士：
  //   亲爱的呼博，
  //   （单独的「致」只在上海银行等少数模板里出现）
  const prefix = '(?<![\\u4e00-\\u9fa5])(?:尊敬的|亲爱的|致)'
  const patterns = [
    new RegExp(prefix + '\\s*([\\u4e00-\\u9fa5]{2,4})\\s*(?:先生|女士|小姐|太太|夫人)', 'g'),
    new RegExp(prefix + '\\s*([\\u4e00-\\u9fa5]{2,4})\\s*[，,：:]', 'g'),
  ]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1]
      if (isGenericAddress(name)) continue
      if (!isNameLike(name)) continue
      return name
    }
  }
  return null
}

/** 把持卡人的姓名与别名摊平成「归一化名 -> holderId」的查找表。 */
export function buildHolderIndex(holders: HolderRecord[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const holder of holders) {
    for (const key of [holder.name, ...holder.aliases]) {
      const normalized = normalizeName(key)
      if (normalized && !index.has(normalized)) index.set(normalized, holder.id)
    }
  }
  return index
}

function matchCandidates(candidates: string[], holders: HolderRecord[], index: Map<string, string>): string | null {
  // 1) 精确命中姓名/别名
  for (const candidate of candidates) {
    const hit = index.get(candidate)
    if (hit) return hit
  }

  // 2) 剥掉称谓后精确命中
  for (const candidate of candidates) {
    const bare = stripHonorificSuffix(candidate)
    if (!bare) continue
    const hit = index.get(bare)
    if (hit) return hit
  }

  // 3) 姓氏前缀匹配：To 头可能写全名而库里只存了「姓+辈分」（如库里「呼博」、来件「呼博先生」）。
  //    只在唯一命中时才采纳——「呼博」与「呼金堂」共享姓氏，靠前缀区分不开，
  //    这时宁可回到默认持卡人，也不能把账单记到错的人头上。
  const holderKeys = new Map<string, string>()
  for (const holder of holders) {
    for (const key of [holder.name, ...holder.aliases]) {
      const normalized = normalizeName(key)
      if (normalized && isNameLike(normalized) && !holderKeys.has(normalized)) {
        holderKeys.set(normalized, holder.id)
      }
    }
  }
  for (const candidate of candidates) {
    const bare = stripHonorificSuffix(candidate) ?? candidate
    if (!isNameLike(bare)) continue
    const hits = new Set<string>()
    for (const [key, holderId] of holderKeys) {
      if (key.startsWith(bare) || bare.startsWith(key)) hits.add(holderId)
    }
    if (hits.size === 1) return [...hits][0]
  }

  return null
}

export interface ResolveHolderParams {
  holders: HolderRecord[]
  /** 都没有命中时的兜底持卡人（该用户最早创建的持卡人）。 */
  defaultHolderId: string | null
  /** 嵌套邮件 To 头里解出的显示名，优先级最高。 */
  headerName?: string | null
  /** 正文称呼里解出的名字，优先级次之。 */
  bodyName?: string | null
}

export interface HolderResolution {
  holderId: string | null
  source: 'header_name' | 'body_honorific' | 'default_holder' | 'unknown'
}

/** 把解出的显示名转成可比较的候选键；称呼「用户」这类占位名直接丢掉。 */
function toCandidates(value: string | null | undefined): string[] {
  const normalized = normalizeName(value)
  if (!normalized) return []
  if (isGenericAddress(normalized)) return []
  const bare = stripHonorificSuffix(normalized)
  const keys = new Set<string>([normalized])
  if (bare) keys.add(bare)
  return [...keys]
}

/**
 * 按「To 头显示名 -> 正文称呼 -> 默认持卡人」的顺序认人。
 * 返回 source 是为了让日志如实说明归属依据，而不是让调用方猜。
 */
export function resolveHolder(params: ResolveHolderParams): HolderResolution {
  const { holders, defaultHolderId, headerName, bodyName } = params
  const index = buildHolderIndex(holders)

  const headerCandidates = toCandidates(headerName)
  if (headerCandidates.length) {
    const matched = matchCandidates(headerCandidates, holders, index)
    if (matched) return { holderId: matched, source: 'header_name' }
  }

  const bodyCandidates = toCandidates(bodyName)
  if (bodyCandidates.length) {
    const matched = matchCandidates(bodyCandidates, holders, index)
    if (matched) return { holderId: matched, source: 'body_honorific' }
  }

  if (defaultHolderId) return { holderId: defaultHolderId, source: 'default_holder' }
  return { holderId: null, source: 'unknown' }
}

// ─── 附件分类 ─────────────────────────────────────────────────────────────────

const MAIL_HEADER_RE = /^(?:from|to|subject|mime-version|return-path|message-id|content-type|received|date)\s*:/im

/** 有邮件头特征就当作邮件正文：有些转发客户端会把 .eml 的扩展名丢掉。 */
function looksLikeRfc822(bytes: Uint8Array): boolean {
  if (!bytes.length) return false
  const head = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes.subarray(0, 2048))
  return MAIL_HEADER_RE.test(head)
}

/** 判断一个附件是不是嵌套账单邮件。 */
export function isEmlAttachment(attachment: RawAttachment): boolean {
  const name = (attachment.filename || '').toLowerCase()
  if (name.endsWith('.eml') || name.endsWith('.emlx')) return true
  if (attachment.contentType === 'message/rfc822') return true
  if (attachment.contentType === 'application/eml' || attachment.contentType === 'application/x-eml') return true
  // 扩展名缺失（转发客户端常见）时退回内容嗅探，但只对 octet-stream 这种模糊类型做
  if (!name && (attachment.contentType === 'application/octet-stream' || !attachment.contentType)) {
    return looksLikeRfc822(attachment.bytes)
  }
  return false
}
