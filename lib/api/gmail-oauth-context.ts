// lib/api/gmail-oauth-context.ts — Gmail 授权往返携带「默认持卡人 / 备注」的签名 Cookie。
//
// /api/auth/gmail/start 接受 ?defaultHolderId=&label=，但 Google OAuth 会跳转离开
// 本站，这两个值只能靠一个短期 HttpOnly Cookie 带到 /api/auth/gmail/callback。
// 与 lib/oauth-state.ts 同款签名方式（payload + HMAC），避免 cookie tossing：
// 兄弟子域可以给父域种同名 cookie，没有签名就能被提前固定成他人 holder。

import { encodeB64UrlJson, fromB64Url, toB64Url } from '../base64url'
import { readCookie } from '../cookies'
import { hmacSign, hmacVerify } from '../hmac'

export const GMAIL_CONNECT_CONTEXT_COOKIE = 'wc_gmail_ctx'
/** 授权往返通常 1–2 分钟；10 分钟覆盖用户在 Google 选账号页的停顿。 */
const MAX_AGE_SECONDS = 600

export interface GmailConnectContext {
  defaultHolderId?: string | null
  label?: string | null
}

function sanitize(input: GmailConnectContext): GmailConnectContext {
  return {
    defaultHolderId:
      typeof input.defaultHolderId === 'string' && input.defaultHolderId.trim()
        ? input.defaultHolderId.trim().slice(0, 64)
        : null,
    label:
      typeof input.label === 'string' && input.label.trim()
        ? input.label.trim().slice(0, 40)
        : null,
  }
}

export function hasGmailConnectContext(input: GmailConnectContext): boolean {
  const value = sanitize(input)
  return !!(value.defaultHolderId || value.label)
}

export async function issueGmailConnectContextCookie(
  input: GmailConnectContext,
): Promise<string> {
  const payload = encodeB64UrlJson({
    ...sanitize(input),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  })
  const signature = toB64Url(await hmacSign(payload))
  return (
    `${GMAIL_CONNECT_CONTEXT_COOKIE}=${payload}.${signature}` +
    `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`
  )
}

export function clearGmailConnectContextCookie(): string {
  return `${GMAIL_CONNECT_CONTEXT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export async function readGmailConnectContext(
  request: Request,
): Promise<GmailConnectContext | null> {
  const raw = readCookie(request.headers.get('Cookie'), GMAIL_CONNECT_CONTEXT_COOKIE)
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  try {
    const valid = await hmacVerify(raw.slice(0, dot), fromB64Url(raw.slice(dot + 1)))
    if (!valid) return null
    const payload = JSON.parse(
      new TextDecoder().decode(fromB64Url(raw.slice(0, dot))),
    ) as GmailConnectContext & { exp?: number }
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return sanitize(payload)
  } catch {
    return null
  }
}
