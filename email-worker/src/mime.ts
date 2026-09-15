/**
 * Minimal MIME parser for the Cloudflare Email Worker.
 *
 * Strategy (no external libraries, bundle-size safe):
 *   1. 全程按字节处理。转发账单包里的 .eml/.PDF 是 base64 附件，先把整封邮件
 *      解码成 utf-8 字符串会不可逆地毁掉二进制字节，所以入口是 Uint8Array。
 *   2. 走 multipart 边界，按字节切分部件，收集 text/plain（优先）或 text/html，
 *      以及带 Content-Disposition: attachment 的部件。
 *   3. 解码 quoted-printable / base64 后再按部件声明的字符集解码（workerd 支持
 *      gbk/gb2312/big5，不只是 utf-8），最后才做 HTML 去标签。
 *
 * 这里刻意不实现完整的 RFC-2822 解析，只覆盖中港美银行账单邮件的常见形态。
 */

import type { ParsedRawMessage, RawAttachment, RawHeaders } from './types'

/** 单个附件的解码上限：超过这个体积的部件当作异常数据丢弃，避免撑爆 Worker 内存。 */
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
/** 一封邮件里所有附件的累计上限：转发包动辄几十个附件，必须设总量闸门。 */
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** multipart 嵌套深度上限：畸形邮件可能自指，防止无限递归。 */
const MAX_MULTIPART_DEPTH = 12
/** 交给 LLM 的正文上限，沿用旧实现的 8000 字，避免 token 成本随附件数量爆炸。 */
const MAX_BODY_CHARS = 8000
/** 正文长到一定程度才值得做空白压缩；短正文保持原样更可读。 */
const TEXT_COLLAPSE_LIMIT = 256 * 1024

/** 常见字符集别名 -> TextDecoder 认可的标签，修正被写错的 charset 声明。 */
const CHARSET_ALIASES: Record<string, string> = {
  'utf8': 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
  'ascii': 'utf-8',
  'us-ascii': 'utf-8',
  'ansi_x3.4-1968': 'utf-8',
  'gb_2312-80': 'gbk',
  'gb2312-80': 'gbk',
  'csgb2312': 'gbk',
  'x-gbk': 'gbk',
  'euc-cn': 'gbk',
  'big-5': 'big5',
  'big5-eten': 'big5',
  'cp950': 'big5',
  'latin1': 'windows-1252',
  'iso8859-1': 'iso-8859-1',
  'ks_c_5601-1987': 'euc-kr',
  'sjis': 'shift_jis',
}

// ─── 字节工具 ─────────────────────────────────────────────────────────────────

/** 读完整条 stream 并拼成连续字节。 */
export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  return concatBytes(chunks, total)
}

/** Read a ReadableStream<Uint8Array> fully and return as a string */
export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const bytes = await streamToBytes(stream)
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return merged
}

/** 在字节序列里找子序列，找不到返回 -1。 */
function indexOfSeq(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const n = needle.length
  if (n === 0) return -1
  const limit = haystack.length - n
  const first = needle[0]
  for (let i = Math.max(0, from); i <= limit; i++) {
    if (haystack[i] !== first) continue
    let j = 1
    while (j < n && haystack[i + j] === needle[j]) j++
    if (j === n) return i
  }
  return -1
}

/** 按字节 1:1 映射成字符串，用于头部/分隔行这类 ASCII 文本（8bit 中文稍后按字节还原）。 */
function bytesToLatin1String(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return out
}

/** bytesToLatin1String 的逆操作：把 1:1 映射出来的字符串还原成原始字节。 */
function latin1StringToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

/** ASCII 专用编码，用于构造分隔符等。 */
function asciiBytes(value: string): Uint8Array {
  return latin1StringToBytes(value)
}

function normalizeCharsetLabel(charset: string | null | undefined): string | null {
  if (!charset) return null
  const base = charset.trim().toLowerCase().replace(/^["']|["']$/g, '').split(';')[0].trim()
  if (!base) return null
  return CHARSET_ALIASES[base] ?? base
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 按声明字符集把字节解成文本。
 * 没有声明字符集（或声明了未知标签）时先用 utf-8 试：出现替换字符说明原文多半是
 * GBK 系中文（银行邮件里很常见），再退回 gbk。
 */
function bytesToString(bytes: Uint8Array, charset: string | null | undefined): string {
  if (!bytes.length) return ''
  const label = normalizeCharsetLabel(charset)
  if (label) {
    const decoded = tryDecode(bytes, label)
    if (decoded !== null) return decoded
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
  if (utf8.includes('\uFFFD')) {
    const gbk = tryDecode(bytes, 'gbk')
    if (gbk && !gbk.includes('\uFFFD')) return gbk
  }
  return utf8
}

/**
 * 还原「未编码的 8bit 中文头」（例如直接以 GBK 字节写入的 To 头）。
 * 头部很短，用 utf-8 试错再退 gbk 比依赖声明字符集更可靠。
 */
function bytesToHeaderText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  const gbk = tryDecode(bytes, 'gbk')
  if (gbk && !gbk.includes('\uFFFD')) return gbk
  return utf8
}

// ─── 传输编码解码（都产出字节） ───────────────────────────────────────────────

function hexValue(code: number | undefined): number {
  if (code === undefined) return -1
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
  return -1
}

/**
 * Decode quoted-printable，输出字节。
 * 必须按字节做：=D6=D0 这类转义描述的是原始字节，先转字符串再转义会把 GBK 字节弄坏。
 */
function decodeQuotedPrintableBytes(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b !== 0x3d) {
      out.push(b)
      continue
    }
    const n1 = bytes[i + 1]
    const n2 = bytes[i + 2]
    // 软换行 =CRLF 或 =LF：直接吃掉
    if (n1 === 0x0d && n2 === 0x0a) {
      i += 2
      continue
    }
    if (n1 === 0x0a) {
      i += 1
      continue
    }
    if (n1 === 0x0d && n2 === undefined) {
      i += 1
      continue
    }
    const hi = hexValue(n1)
    const lo = hexValue(n2)
    if (hi >= 0 && lo >= 0) {
      out.push(hi * 16 + lo)
      i += 2
      continue
    }
    // 孤立的 = ：原样保留，避免吞掉正文
    out.push(b)
  }
  return Uint8Array.from(out)
}

/**
 * Decode base64，输出字节。
 * 输入允许是字符串（头部编码词）或原始字节（base64 部件可能被折行）。
 *
 * 解码失败返回 null 而不是空字节：空字节会被上层当成「这个编码词没有内容」，
 * 让坏编码词静默消失（整个 To 头显示名变空 → 认人降级到默认持卡人）。
 * 返回 null 让调用方能把「解码失败」和「本来就没有内容」区分开。
 */
function decodeBase64Bytes(input: Uint8Array | string): Uint8Array | null {
  const text = typeof input === 'string' ? input : bytesToLatin1String(input)
  const trimmed = text.replace(/\s+/g, '')
  const cleaned = text
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9+/=_-]/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  if (!cleaned) {
    // 原文为空/全空白：确实没有内容，返回空字节。
    // 原文非空却被过滤成空（如 payload 全是非法字符）：这是坏编码词，返回 null 让上层保留原样。
    return trimmed ? null : new Uint8Array(0)
  }
  // 部分邮件会在结尾丢掉 padding，atob 会因此抛错，这里补回来
  const remainder = cleaned.length % 4
  const padded = remainder ? cleaned + '='.repeat(4 - remainder) : cleaned
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff
  return bytes
}

/** 按 Content-Transfer-Encoding 把部件正文还原成字节；7bit/8bit/binary 原样返回。 */
function decodeTransferEncoding(body: Uint8Array, encoding: string | null | undefined): Uint8Array {
  const enc = (encoding || '7bit').trim().toLowerCase()
  // 部件解码失败仍按空内容处理：单个坏附件不该让整封邮件解析失败
  if (enc === 'base64') return decodeBase64Bytes(body) ?? new Uint8Array(0)
  if (enc === 'quoted-printable') return decodeQuotedPrintableBytes(body)
  return body
}

// ─── 头解析 ───────────────────────────────────────────────────────────────────

interface HeaderInfo {
  contentType: string
  charset: string | null
  boundary: string | null
  filename: string | null
  disposition: string | null
  contentId: string | null
  encoding: string
  /** 小写头名 -> 折叠展开后的原始值（同名头取第一个）。 */
  fields: Map<string, string>
}

/** 把 Content-Type 值拆成主体和参数表，参数里的分号按引号状态区分。 */
function splitHeaderParams(value: string): { main: string; params: Map<string, string> } {
  const segments: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '"') {
      quoted = !quoted
      current += ch
      continue
    }
    if (ch === ';' && !quoted) {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  segments.push(current)

  const main = (segments.shift() ?? '').trim().toLowerCase()
  const params = new Map<string, string>()
  for (const segment of segments) {
    const eq = segment.indexOf('=')
    if (eq <= 0) continue
    const key = segment.slice(0, eq).trim().toLowerCase()
    let val = segment.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1)
    if (key) params.set(key, val)
  }
  return { main, params }
}

/** 解析一段头部字节；折叠（续行）在这里展开。 */
function parseHeaders(headerBytes: Uint8Array): HeaderInfo {
  const unfolded = bytesToLatin1String(headerBytes).replace(/\r?\n[ \t]+/g, ' ')
  const fields = new Map<string, string>()
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (name && !fields.has(name)) fields.set(name, value)
  }

  const ct = splitHeaderParams(fields.get('content-type') ?? '')
  const cd = splitHeaderParams(fields.get('content-disposition') ?? '')

  // filename 可能在 Content-Type 的 name= 里，也可能在 Content-Disposition 的 filename= 里
  const rawFilename = cd.params.get('filename') ?? ct.params.get('filename') ?? ct.params.get('name') ?? null

  return {
    contentType: ct.main,
    charset: ct.params.get('charset') ?? null,
    boundary: ct.params.get('boundary') ?? null,
    filename: rawFilename ? decodeMimeHeaderValue(rawFilename) : null,
    disposition: cd.main || null,
    contentId: (fields.get('content-id') ?? '').replace(/^<(.*)>$/, '$1').trim() || null,
    encoding: (fields.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase(),
    fields,
  }
}

// ─── RFC 2047 编码词 ──────────────────────────────────────────────────────────

const ENCODED_WORD_RE = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g

/**
 * 解 RFC 2047 编码词（=?gbk?B?...?= / =?utf-8?Q?...?=）。
 * 相邻编码词之间的空白按规范忽略，否则「张改菊 女士」会被拆成两段带空格的碎片。
 */
export function decodeMimeHeaderValue(value: string | null | undefined): string {
  if (!value) return ''
  const unfolded = value.replace(/\r?\n[ \t]+/g, ' ')
  const joined = unfolded.replace(/(\?=)[ \t\r\n]+(=\?[^?]+\?[BbQq]\?)/g, '$1$2')

  if (joined.includes('=?')) {
    return joined.replace(ENCODED_WORD_RE, (whole, charset: string, kind: string, payload: string) => {
      try {
        let bytes: Uint8Array | null
        if (kind.toLowerCase() === 'b') {
          bytes = decodeBase64Bytes(payload)
        } else {
          bytes = decodeQuotedPrintableBytes(asciiBytes(payload.replace(/_/g, ' ')))
        }
        // 解码失败（bytes === null）时保留原始编码词：让它原样可见，
        // 而不是变成空串把整个显示名抹掉、把认人悄悄降级到默认持卡人。
        if (bytes === null) return whole
        return bytesToString(bytes, charset)
      } catch {
        // 单个编码词坏了不该拖垮整个头，保留原样
        return whole
      }
    })
  }

  // 未编码但含 8bit 原始字节（latin1 空间）：按字节还原成中文
  if (/[\u0080-\u00ff]/.test(joined)) return bytesToHeaderText(latin1StringToBytes(joined))
  return joined
}

/**
 * 从 To/Cc 这类地址头里取显示名（可能带「女士/先生」称谓），取不到返回 null。
 * 转发包里嵌套 .eml 的 To 头是识别持卡人的第一来源，所以这里只做「取名字」，
 * 不做「认人」——认人交给调用方按现有持卡人名单匹配。
 */
export function extractHeaderDisplayName(value: string | null | undefined): string | null {
  if (!value) return null
  const decoded = decodeMimeHeaderValue(value)
  // 去掉 <地址> 和包裹显示名的引号
  const withoutAddress = decoded
    .replace(/<[^>]*>/g, ' ')
    .replace(/"([^"]*)"/g, '$1')
    .replace(/'([^']*)'/g, '$1')
  const name = withoutAddress.replace(/\s+/g, ' ').trim()
  if (!name) return null
  // 头里只剩一个邮箱地址时不算显示名
  if (name.includes('@') && !/[\u4e00-\u9fa5]/.test(name)) return null
  return name
}

// ─── HTML 去标签 ──────────────────────────────────────────────────────────────

/** Very naive HTML tag stripper */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── multipart 切分 ───────────────────────────────────────────────────────────

/** 分隔行紧跟的字符必须是行尾/空白，避免分隔符前缀恰好撞上更长的 token。 */
function isLinearSpace(bytes: Uint8Array, i: number): boolean {
  if (i >= bytes.length) return true
  const b = bytes[i]
  return b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a
}

/** 跳过边界行之后的 CRLF（最多两次：行尾一次、空行一次）。 */
function skipLineBreak(bytes: Uint8Array, from: number): number {
  let i = from
  for (let pass = 0; pass < 2; pass++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) i += 2
    else if (bytes[i] === 0x0a) i += 1
    else break
  }
  return i
}

/**
 * 按 boundary 把正文切成部件字节。
 * 刻意不先把二进制转成 utf-8 字符串再按行匹配：附件里的任意字节都可能被解码成
 * 换行或替换字符，从而切错位置。
 */
function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  const delimiter = asciiBytes('--' + boundary)
  const parts: Uint8Array[] = []

  let scanFrom = 0
  let partStart = -1
  let firstSeen = false
  /** 是否遇到了规范收尾分隔符 --boundary--。没有它说明邮件被截断，剩余字节仍是最后一个部件。 */
  let closed = false

  while (true) {
    const at = indexOfSeq(body, delimiter, scanFrom)
    if (at < 0) break
    const after = at + delimiter.length
    const isClosing = body[after] === 0x2d && body[after + 1] === 0x2d
    if (!isClosing && !isLinearSpace(body, after)) {
      // 只是恰好共享前缀，继续往后找真正的分隔行
      scanFrom = at + 1
      continue
    }

    if (!firstSeen) {
      firstSeen = true
      partStart = skipLineBreak(body, after)
      scanFrom = partStart
      continue
    }

    if (partStart >= 0) {
      // 部件内容结束于分隔行前的 CRLF，把行尾从内容里去掉
      let end = at
      if (end > partStart && body[end - 1] === 0x0a) {
        end--
        if (end > partStart && body[end - 1] === 0x0d) end--
      }
      parts.push(body.subarray(partStart, Math.max(partStart, end)))
    }

    if (isClosing) {
      closed = true
      break
    }
    partStart = skipLineBreak(body, after)
    // 下一个部件从内容起始处继续扫描：分隔行的行尾已由 skipLineBreak 跳过，
    // 这里若停回 after 会把同一行再当成分隔行扫一遍。
    scanFrom = partStart
  }

  // 没有收尾分隔符（邮件被截断、客户端漏写 --boundary--）时，上面循环会带着一个
  // 已定位、还没收下的部件退出。这里把剩余字节当作最后一个部件收下，
  // 否则它的正文会被整段丢掉。
  if (!closed && firstSeen && partStart >= 0 && partStart < body.length) {
    parts.push(body.subarray(partStart))
  }

  return parts
}

/** 在第一个空行处切成「头部字节」和「正文字节」。 */
function splitHeaderBody(raw: Uint8Array): { headerBytes: Uint8Array; bodyBytes: Uint8Array } {
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] !== 0x0a) continue
    if (raw[i + 1] === 0x0a) {
      return { headerBytes: raw.subarray(0, i), bodyBytes: raw.subarray(i + 2) }
    }
    if (raw[i + 1] === 0x0d && raw[i + 2] === 0x0a) {
      return { headerBytes: raw.subarray(0, i), bodyBytes: raw.subarray(i + 3) }
    }
  }
  return { headerBytes: raw, bodyBytes: new Uint8Array(0) }
}

// ─── 主解析 ───────────────────────────────────────────────────────────────────

interface TextPart {
  text: string
  isHtml: boolean
}

interface WalkContext {
  texts: TextPart[]
  attachments: RawAttachment[]
  attachmentBytes: number
}

/**
 * 判断一个部件是不是附件。
 *
 * 判据以 Content-Disposition 为主：只带 name=/filename= 而没有 disposition: attachment
 * 的部件是正文（Content-Type: text/plain; name="body.txt" 的正文部件很常见），
 * 把它当附件会让邮件正文变成空串。
 */
function isAttachmentPart(header: HeaderInfo): boolean {
  const type = header.contentType
  // 明确的附件 disposition 优先
  if (header.disposition === 'attachment') return true
  // Content-Type 本身就是二进制/邮件载荷的，即使没有 disposition 也是附件
  if (
    type === 'application/octet-stream' ||
    type === 'application/eml' ||
    type === 'application/x-eml' ||
    type === 'message/rfc822'
  ) {
    return true
  }
  // 文本正文即使带了 name=/filename= 也不算附件
  if (type === 'text/plain' || type === 'text/html' || type === '') return false
  // 其余类型（图片、PDF 等）带文件名即视为附件
  return Boolean(header.filename)
}

function walk(header: HeaderInfo, body: Uint8Array, ctx: WalkContext, depth: number): void {
  if (depth > MAX_MULTIPART_DEPTH) return
  const type = header.contentType || 'text/plain'

  if (type.startsWith('multipart/') && header.boundary) {
    for (const segment of splitMultipart(body, header.boundary)) {
      const { headerBytes, bodyBytes } = splitHeaderBody(segment)
      const sub = parseHeaders(headerBytes)
      // RFC 2046：multipart 子段缺少 Content-Type 时默认 text/plain
      if (!sub.contentType) sub.contentType = 'text/plain'
      walk(sub, bodyBytes, ctx, depth + 1)
    }
    return
  }

  const bytes = decodeTransferEncoding(body, header.encoding)

  if (isAttachmentPart(header)) {
    if (bytes.length > MAX_ATTACHMENT_BYTES) return
    if (ctx.attachmentBytes + bytes.length > MAX_TOTAL_ATTACHMENT_BYTES) return
    ctx.attachmentBytes += bytes.length
    ctx.attachments.push({
      filename: header.filename ?? '',
      contentType: type,
      bytes,
      contentId: header.contentId,
    })
    return
  }

  if (type === 'text/plain' || type === 'text/html') {
    const text = bytesToString(bytes, header.charset)
    if (text.trim()) ctx.texts.push({ text, isHtml: type === 'text/html' })
  }
}

function finalizeText(text: string): string {
  if (text.length > TEXT_COLLAPSE_LIMIT) text = text.slice(0, TEXT_COLLAPSE_LIMIT)
  return text.slice(0, MAX_BODY_CHARS)
}

/**
 * 解析一封原始邮件（顶层转发包或附件里的嵌套 .eml 都用它）。
 * 返回正文文本、判债主需要的头字段，以及附件字节。
 */
export function parseRawMessage(raw: Uint8Array): ParsedRawMessage {
  const { headerBytes, bodyBytes } = splitHeaderBody(raw)
  const top = parseHeaders(headerBytes)
  const ctx: WalkContext = { texts: [], attachments: [], attachmentBytes: 0 }
  walk(top, bodyBytes, ctx, 0)

  const plain = ctx.texts.find(t => !t.isHtml)
  const html = ctx.texts.find(t => t.isHtml)
  const text = plain ? plain.text : html ? stripHtml(html.text) : ''

  const headers: RawHeaders = {
    from: top.fields.get('from') ?? null,
    to: top.fields.get('to') ?? null,
    subject: top.fields.get('subject') ?? null,
    date: top.fields.get('date') ?? null,
    charset: top.charset,
    contentType: top.contentType,
    encoding: top.encoding,
  }

  return { headers, text: finalizeText(text), attachments: ctx.attachments }
}

/** 只要附件列表的便捷入口。 */
export function extractAttachments(raw: Uint8Array): RawAttachment[] {
  return parseRawMessage(raw).attachments
}

/**
 * 兼容旧调用：入参是「已经按 utf-8 解码过的整封邮件字符串」。
 * 新代码请直接用 parseRawMessage(Uint8Array)，否则附件字节无法还原。
 */
export function extractTextFromRaw(raw: string): string {
  return parseRawMessage(new TextEncoder().encode(raw)).text
}
