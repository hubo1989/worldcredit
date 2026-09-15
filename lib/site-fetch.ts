// lib/site-fetch.ts — fetch a real web page and turn it into plain text.
//
// 背景：后台的 AI 补全此前只吃 Wikipedia，写出来的银行客服电话/官网是模型
// 记忆而不是站点事实。这里提供「真的去抓那个页面」的能力，让补全以官网内容
// 为准。两个必须处理的现实问题：
//
//   1. 编码。中文银行官网大量使用 GBK/GB2312。fetch().text() 一律按 UTF-8
//      解码，中文会变成乱码，正则也就什么都匹配不到。所以这里按字节取回，
//      再依 Content-Type → <meta charset> → 逐候选解码（含 gbk）判定。
//   2. 体积。首页动辄几百 KB，直接塞进 prompt 会撑爆上下文。只保留文本、
//      去标签后截断。
//
// 不依赖任何 DOM 实现：Workers 里没有 DOMParser，且这些页面只需要「找出
// 电话号码/域名」这类浅层信息。

const CHARSET_CANDIDATES = ['utf-8', 'gbk', 'gb18030', 'big5'] as const

export interface FetchedPage {
  url: string
  /** 最终地址（跟随重定向后）。 */
  finalUrl: string
  status: number
  /** 判定出的字符集；用于排查「页面抓到了但全是乱码」。 */
  charset: string
  /** 去标签后的纯文本，已截断。 */
  text: string
  /** 正文里出现的电话号码，去重后按出现顺序。 */
  phones: string[]
  /** 正文里出现的域名（用于核对官网归属）。 */
  domains: string[]
}

/** 从字节里判字符集：Content-Type 优先，其次 <meta charset>，最后按候选试解。 */
function detectCharset(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]
  if (fromHeader) return fromHeader.toLowerCase()

  // <meta charset> / <meta http-equiv=Content-Type content="...charset=...">
  // 头部声明一定是 ASCII，所以先用 utf-8 松散解出前 4KB 找一个声明即可。
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096))
  const metaCharset = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
  if (metaCharset) return metaCharset.toLowerCase()
  return 'utf-8'
}

/**
 * 按字符集解码。
 *
 * 声明与实际不符是常见情况（声明 utf-8 实为 gbk），所以解完检查替换字符；
 * 若明显是乱码，退回最后一个无替换字符的候选。
 */
export function decodePage(bytes: Uint8Array, charset: string): { text: string; used: string } {
  const order = [charset, ...CHARSET_CANDIDATES.filter(c => c !== charset)]
  let fallback: { text: string; used: string } | null = null

  for (const candidate of order) {
    let decoded: string
    try {
      decoded = new TextDecoder(candidate).decode(bytes)
    } catch {
      continue // 运行时不认识这个 label
    }
    const bad = (decoded.match(/\uFFFD/g) || []).length
    if (bad === 0) return { text: decoded, used: candidate }
    if (!fallback || bad < (fallback.text.match(/\uFFFD/g) || []).length) {
      fallback = { text: decoded, used: candidate }
    }
  }
  return fallback ?? { text: '', used: charset }
}

/** 粗略去标签 + 压缩空白。够用于提取号码与域名，不做完整 HTML 解析。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

const PHONE_RE = /(?:95\d{3}|96\d{3}|400-?\d{3}-?\d{4}|800-?\d{3}-?\d{4}|\+?86-?\d{2,3}-?\d{8}|1-8\d{2}-\d{3}-\d{4})/g
const DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+(?:com|cn|net|org|hk|us|co\.uk|com\.cn|com\.hk))\b/gi

export function extractPhones(text: string): string[] {
  return [...new Set((text.match(PHONE_RE) || []).map(s => s.trim()))]
}

export function extractDomains(text: string): string[] {
  return [...new Set((text.match(DOMAIN_RE) || []).map(s => s.toLowerCase()))]
}

/**
 * 抓一个页面并返回可直接喂给模型的文本与线索。
 * 失败时抛错，由调用方决定是跳过还是报告——不静默返回空串，
 * 否则「抓取失败」和「页面确实没写电话」在界面上分不开。
 */
export async function fetchPage(
  url: string,
  options: { timeoutMs?: number; maxChars?: number } = {}
): Promise<FetchedPage> {
  const { timeoutMs = 15000, maxChars = 12000 } = options
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // 相当一部分银行站对无 UA 的请求直接拒绝或返回空壳
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })

  const bytes = new Uint8Array(await res.arrayBuffer())
  const charset = detectCharset(bytes, res.headers.get('content-type'))
  const { text: html, used } = decodePage(bytes, charset)
  const text = htmlToText(html).slice(0, maxChars)

  return {
    url,
    finalUrl: res.url || url,
    status: res.status,
    charset: used,
    text,
    phones: extractPhones(text),
    domains: extractDomains(text),
  }
}

/** 把域名归一化成可比较的注册域（去掉 www. 之类前缀），用于判断「是不是同一家」。 */
export function rootDomain(hostOrUrl: string): string {
  let host = hostOrUrl.trim().toLowerCase()
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname
  } catch {
    /* 不是 URL，就当域名处理 */
  }
  return host.replace(/^www\./, '')
}
