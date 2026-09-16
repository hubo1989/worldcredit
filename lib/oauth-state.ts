// lib/oauth-state.ts — signed, single-use OAuth `state` bound to the browser.
//
// 此前 start 生成 `state` 后直接丢掉，callback 也从不校验，等于没有 CSRF 防护：
// 攻击者可以先自行走一遍授权拿到 (code, state)，再把该回调地址喂给受害者，
// 受害者的会话就会变成攻击者的 Google 账号（login CSRF / 会话固定）。
//
// 现在的做法：state 随下发一起写进 HttpOnly 签名 cookie，且同时作为 ID token
// 的 nonce，callback 必须两者都对得上才继续。签名（而不是只靠 HttpOnly）是必要
// 的：兄弟子域可以给父域种 cookie（cookie tossing），没有签名就能被提前固定。

import { encodeB64UrlJson, fromB64Url, toB64Url } from './base64url'
import { readCookie } from './cookies'
import { hmacSign, hmacVerify } from './hmac'

export const OAUTH_STATE_COOKIE = 'wc_oauth_state'

/** 授权往返应在一分钟内完成；留 10 分钟足够覆盖用户手动选择账号的停顿。 */
const STATE_MAX_AGE_SECONDS = 600

interface StatePayload {
  state: string
  exp: number
}

export interface IssuedOAuthState {
  state: string
  cookie: string
}

export async function issueOAuthState(): Promise<IssuedOAuthState> {
  const state = crypto.randomUUID()
  const payload = encodeB64UrlJson({
    state,
    exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SECONDS,
  } satisfies StatePayload)
  const signature = toB64Url(await hmacSign(payload))
  return {
    state,
    cookie:
      `${OAUTH_STATE_COOKIE}=${payload}.${signature}` +
      `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_MAX_AGE_SECONDS}`,
  }
}

export function clearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/**
 * 校验 callback 收到的 `state`：必须与签名 cookie 内的一致且未过期。
 *
 * 真正的「一次性」由 cookie 失效（callback 回写 Max-Age=0）+ Google 授权码
 * 本身只能用一次共同保证；这里不做服务端存储，因此不要把本函数当成重放防护。
 */
export async function verifyOAuthState(
  request: Request,
  stateFromQuery: string | null
): Promise<boolean> {
  if (!stateFromQuery) return false
  const raw = readCookie(request.headers.get('Cookie'), OAUTH_STATE_COOKIE)
  if (!raw) return false

  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return false
  const payloadPart = raw.slice(0, dot)

  try {
    const valid = await hmacVerify(payloadPart, fromB64Url(raw.slice(dot + 1)))
    if (!valid) {
      console.warn('[oauth-state] reject=bad-signature')
      return false
    }
  } catch (err) {
    console.error('[oauth-state] verify failed:', err)
    return false
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(payloadPart))) as StatePayload
  } catch {
    return false
  }
  if (!payload || typeof payload.state !== 'string' || typeof payload.exp !== 'number') return false
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    console.warn('[oauth-state] reject=expired')
    return false
  }
  if (payload.state !== stateFromQuery) {
    console.warn('[oauth-state] reject=state-mismatch')
    return false
  }
  return true
}
