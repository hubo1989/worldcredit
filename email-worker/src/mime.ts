/**
 * Minimal MIME body extractor for Cloudflare Email Worker.
 *
 * Strategy (no external libraries, bundle-size safe):
 *   1. Decode the full raw message stream to text.
 *   2. Walk multipart boundaries to find text/plain (preferred) or text/html parts.
 *   3. Decode quoted-printable and base64 content-transfer-encodings.
 *   4. Strip HTML tags if only HTML is available.
 *
 * This deliberately avoids a full RFC-2822 parser; it covers the
 * common patterns used by Chinese and international bank bill emails.
 */

/** Read a ReadableStream<Uint8Array> fully and return as a string */
export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(merged)
}

/** Decode quoted-printable encoding */
function decodeQuotedPrintable(input: string): string {
  return input
    // soft line breaks
    .replace(/=\r?\n/g, '')
    // encoded bytes  =XX
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
}

/** Decode base64 content (handles URL-safe variant too) */
function decodeBase64(input: string): string {
  const cleaned = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  try {
    return atob(cleaned)
  } catch {
    return input
  }
}

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

interface MimePart {
  contentType: string
  encoding: string
  body: string
}

/** Extract the value of a Content-Type or Content-Transfer-Encoding header within a block */
function headerValue(headers: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*([^\\r\\n;]+)`, 'im')
  const m = headers.match(re)
  return m ? m[1].trim().toLowerCase() : ''
}

/** Parse a MIME block (headers + body) into content-type, encoding, decoded body */
function parsePart(part: string): MimePart {
  // Split headers from body at first blank line
  const blankLine = part.match(/\r?\n\r?\n/)
  if (!blankLine) return { contentType: 'text/plain', encoding: '7bit', body: part }

  const splitIdx = part.indexOf(blankLine[0])
  const headers = part.slice(0, splitIdx)
  const rawBody = part.slice(splitIdx + blankLine[0].length)

  const contentType = headerValue(headers, 'content-type') || 'text/plain'
  const encoding = headerValue(headers, 'content-transfer-encoding') || '7bit'

  let body = rawBody
  if (encoding === 'quoted-printable') {
    body = decodeQuotedPrintable(rawBody)
  } else if (encoding === 'base64') {
    body = decodeBase64(rawBody)
  }

  return { contentType, encoding, body }
}

/** Recursively split multipart and collect text parts */
function collectTextParts(raw: string, boundary: string | null): MimePart[] {
  if (!boundary) {
    return [parsePart(raw)]
  }

  const delimiter = '--' + boundary
  const segments = raw.split(new RegExp(delimiter + '(?:--|\\r?\\n)'))
  const parts: MimePart[] = []

  for (const seg of segments) {
    if (!seg.trim()) continue
    const parsed = parsePart(seg)

    // If this part itself is multipart, recurse
    const subBoundary = extractBoundary(parsed.contentType + seg.slice(0, 400))
    if (parsed.contentType.startsWith('multipart/')) {
      parts.push(...collectTextParts(parsed.body, subBoundary))
    } else {
      parts.push(parsed)
    }
  }

  return parts
}

/** Extract boundary= value from a Content-Type string */
function extractBoundary(ct: string): string | null {
  const m = ct.match(/boundary=["']?([^"'\r\n;]+)["']?/i)
  return m ? m[1].trim() : null
}

/**
 * Extract readable text from a raw email message.
 * Returns text/plain content if available, otherwise strips HTML.
 * Truncates to 8000 chars to stay within OpenAI token budget.
 */
export function extractTextFromRaw(raw: string): string {
  // Parse top-level headers / body split
  const blankLine = raw.match(/\r?\n\r?\n/)
  if (!blankLine) return raw.slice(0, 8000)

  const splitIdx = raw.indexOf(blankLine[0])
  const topHeaders = raw.slice(0, splitIdx)
  const topBody = raw.slice(splitIdx + blankLine[0].length)

  const topCT = topHeaders.match(/^content-type:\s*([^\r\n;]+)/im)?.[1]?.trim().toLowerCase() ?? 'text/plain'
  const boundary = extractBoundary(topHeaders)

  let parts: MimePart[]
  if (topCT.startsWith('multipart/')) {
    parts = collectTextParts(topBody, boundary)
  } else {
    parts = [parsePart(raw)]
  }

  // Prefer text/plain
  const plainPart = parts.find(p => p.contentType.startsWith('text/plain'))
  if (plainPart) return plainPart.body.slice(0, 8000)

  // Fall back to text/html
  const htmlPart = parts.find(p => p.contentType.startsWith('text/html'))
  if (htmlPart) return stripHtml(htmlPart.body).slice(0, 8000)

  // Last resort: raw
  return raw.slice(0, 8000)
}
