// lib/gmail/api.ts — Gmail REST v1 薄客户端（server only）。
// 只封装本项目用到的三个端点：refresh token、列表、取原始 .eml。
// 所有函数接受可注入 fetchImpl 与凭证，测试不打真实网络。

export interface GmailClientOptions {
  fetchImpl?: typeof fetch
  clientId?: string
  clientSecret?: string
}

export interface GmailTokenSet {
  accessToken: string
  expiresIn: number
}

export interface GmailMessageRef {
  id: string
  threadId: string | null
}

async function callJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function refreshAccessToken(
  refreshToken: string,
  opts?: GmailClientOptions
): Promise<GmailTokenSet> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const json = await callJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts?.clientId ?? '',
      client_secret: opts?.clientSecret ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }, fetchImpl)
  return {
    accessToken: String(json.access_token ?? ''),
    expiresIn: Number(json.expires_in ?? 0),
  }
}

export async function listMessageRefs(
  accessToken: string,
  q: string,
  opts?: GmailClientOptions & { maxResults?: number; pageToken?: string }
): Promise<{ refs: GmailMessageRef[]; nextPageToken: string | null }> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const params = new URLSearchParams({ q, maxResults: String(opts?.maxResults ?? 50) })
  if (opts?.pageToken) params.set('pageToken', opts.pageToken)
  const json = await callJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl
  )
  const messages = Array.isArray(json.messages) ? json.messages as Array<{ id?: string; threadId?: string }> : []
  return {
    refs: messages
      .map(m => ({ id: String(m.id ?? ''), threadId: m.threadId ? String(m.threadId) : null }))
      .filter(m => m.id),
    nextPageToken: json.nextPageToken ? String(json.nextPageToken) : null,
  }
}

/** format=raw 的 raw 字段是 base64url 编码的完整 .eml 字节。 */
export async function getRawMessage(
  accessToken: string,
  messageId: string,
  opts?: GmailClientOptions
): Promise<Uint8Array> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const json = await callJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl
  )
  const rawB64 = String(json.raw ?? '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(rawB64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
