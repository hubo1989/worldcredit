// lib/google-id-token.ts — 校验 Google ID token（RS256 签名 + claim 检查）。
//
// 此前 callback 只做了 `payload = JSON.parse(atob(...))`：签名完全不看，任何能构造
// 一个自签 JWT 的人都能伪造任意 email 直接登录（包括白名单里的管理员邮箱）。
// 这里改为按 Google 的 JWKS 验签，并核对 iss/aud/exp/iat/nonce。

import { fromB64Url } from './base64url'

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
/** 允许的时钟偏移，以及 token 签发时间距「现在」的上限。 */
const CLOCK_SKEW_SECONDS = 60
const MAX_TOKEN_AGE_SECONDS = 600

interface JwksKey extends JsonWebKey {
  kid?: string
}

interface Jwks {
  keys?: JwksKey[]
}

interface IdTokenPayload {
  iss?: string
  aud?: string
  exp?: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  sub?: string
}

export interface GoogleIdentity {
  email: string
  name?: string
  sub: string
}

export type IdTokenFailure =
  | 'malformed'
  | 'bad-algorithm'
  | 'unknown-key'
  | 'bad-signature'
  | 'bad-issuer'
  | 'bad-audience'
  | 'expired'
  | 'stale'
  | 'bad-nonce'
  | 'email-unverified'
  | 'no-email'
  | 'jwks-unavailable'

// JWKS 缓存挂在 globalThis 上：worker 入口与 SSR bundle 各内联一份本模块，
// 模块级变量会各存一份（与 lib/db/client 的 setDb 同理）。
interface JwksCache {
  keys: JwksKey[]
  fetchedAt: number
  maxAgeMs: number
}

const cacheRef = globalThis as unknown as { __worldcreditGoogleJwks?: JwksCache }

/** 尊重 Google 的 Cache-Control max-age，并在拿不到新 JWKS 时退回旧缓存。 */
async function getJwks(forceRefresh = false): Promise<JwksKey[] | null> {
  const cached = cacheRef.__worldcreditGoogleJwks
  const now = Date.now()
  if (!forceRefresh && cached && now - cached.fetchedAt < cached.maxAgeMs) return cached.keys

  try {
    const res = await fetch(JWKS_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`)
    const body = (await res.json()) as Jwks
    const keys = Array.isArray(body.keys) ? body.keys : []
    if (keys.length === 0) throw new Error('JWKS 为空')
    const maxAgeMs = parseMaxAgeMs(res.headers.get('Cache-Control'))
    cacheRef.__worldcreditGoogleJwks = { keys, fetchedAt: now, maxAgeMs }
    return keys
  } catch (err) {
    console.error('[google-id-token] JWKS 获取失败:', err)
    // key rotation 期间短暂不可用时，仍可用旧 key 完成校验（旧 key 不会立刻失效）。
    if (cached) return cached.keys
    return null
  }
}

function parseMaxAgeMs(header: string | null): number {
  const match = header ? /max-age=(\d+)/i.exec(header) : null
  const seconds = match ? Number(match[1]) : 3600
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600_000
}

async function findKey(kid: string | undefined): Promise<JwksKey | null> {
  if (!kid) return null
  let keys = await getJwks()
  let key = keys?.find((k) => k.kid === kid)
  if (!key) {
    // kid 未命中通常是 Google 轮换了签名密钥，强制刷新一次再试。
    keys = await getJwks(true)
    key = keys?.find((k) => k.kid === kid)
  }
  return key ?? null
}

export async function verifyGoogleIdToken(
  idToken: string,
  opts: { clientId: string | string[]; nonce?: string }
): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: IdTokenFailure }> {
  const parts = idToken.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [headerB64, payloadB64, signatureB64] = parts

  let header: { alg?: string; kid?: string }
  let payload: IdTokenPayload
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64Url(headerB64))) as typeof header
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(payloadB64))) as IdTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // 只接受 RS256：允许 `none`/HS* 就意味着攻击者可以自签，或用公开信息当密钥。
  if (header.alg !== 'RS256') return { ok: false, reason: 'bad-algorithm' }

  const jwk = await findKey(header.kid)
  if (!jwk) return { ok: false, reason: 'unknown-key' }

  let verified: boolean
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true } as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      fromB64Url(signatureB64) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`) as unknown as ArrayBuffer
    )
  } catch (err) {
    console.error('[google-id-token] 验签异常:', err)
    return { ok: false, reason: 'bad-signature' }
  }
  if (!verified) return { ok: false, reason: 'bad-signature' }

  // 签名过了才轮到 claim：iss/aud 防「换个应用的 token」，exp/iat 防旧 token 重放。
  if (!payload.iss || !ISSUERS.has(payload.iss)) return { ok: false, reason: 'bad-issuer' }
  const allowedClients = Array.isArray(opts.clientId) ? opts.clientId : [opts.clientId]
  if (!payload.aud || !allowedClients.includes(payload.aud)) return { ok: false, reason: 'bad-audience' }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
    return { ok: false, reason: 'expired' }
  }
  if (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_SECONDS > now) {
    return { ok: false, reason: 'stale' }
  }
  if (now - payload.iat > MAX_TOKEN_AGE_SECONDS) return { ok: false, reason: 'stale' }

  // nonce 把 ID token 绑到本次授权请求上，防止拿别处的 token 来顶替。
  if (opts.nonce && payload.nonce !== opts.nonce) return { ok: false, reason: 'bad-nonce' }

  if (!payload.email) return { ok: false, reason: 'no-email' }
  // 未验证邮箱可能是他人未验证的地址，拿去查/建用户等于让攻击者占据该邮箱账号。
  if (payload.email_verified !== true) return { ok: false, reason: 'email-unverified' }
  if (!payload.sub) return { ok: false, reason: 'malformed' }

  return { ok: true, identity: { email: payload.email, name: payload.name, sub: payload.sub } }
}

/** 仅测试用：清空 JWKS 缓存。 */
export function __resetGoogleJwksCache() {
  delete cacheRef.__worldcreditGoogleJwks
}
