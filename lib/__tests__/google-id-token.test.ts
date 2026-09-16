// 回归：Google ID token 必须验签并核对 claim，不能只把 payload 解出来就用。
//
// 此前 callback 是 `payload = JSON.parse(atob(...))`，签名完全不看：任何能构造
// 自签 JWT 的人都能声明任意 email（包括白名单里的管理员）直接登入。
//
// 这些用例真的用 RS256 生成密钥对并签名：正例用「Google JWKS 里发布的公钥」签，
// 反例用攻击者自己的密钥签，从而证明拒绝来自验签本身，而不是靠字段缺失侥幸。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { verifyGoogleIdToken, __resetGoogleJwksCache } from '../google-id-token'
import { toB64Url } from '../base64url'

const CLIENT_ID = '490117963106-test.apps.googleusercontent.com'

const b64urlJson = (value: unknown) => toB64Url(new TextEncoder().encode(JSON.stringify(value)))

async function generateSigner() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  return { privateKey: pair.privateKey, jwk }
}

interface Claims {
  iss?: string | null
  aud?: string | null
  exp?: number
  iat?: number
  nonce?: string | null
  email?: string
  email_verified?: boolean
  name?: string
  sub?: string
}

async function signToken(
  privateKey: CryptoKey,
  kid: string | undefined,
  claims: Claims,
  opts: { alg?: string } = {}
): Promise<string> {
  const header: Record<string, unknown> = { alg: opts.alg ?? 'RS256', typ: 'JWT' }
  if (kid) header.kid = kid
  const now = Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(claims)) {
    if (value === null) continue
    payload[key] = value
  }
  if (!('exp' in payload)) payload.exp = now + 300
  if (!('iat' in payload)) payload.iat = now
  if (!('iss' in payload)) payload.iss = 'https://accounts.google.com'
  if (!('aud' in payload)) payload.aud = CLIENT_ID

  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput) as unknown as ArrayBuffer
  )
  return `${signingInput}.${toB64Url(new Uint8Array(signature))}`
}

let google: Awaited<ReturnType<typeof generateSigner>>
let attacker: Awaited<ReturnType<typeof generateSigner>>

const KID = 'google-kid-1'

function mockJwks(kids: string[] = [KID]) {
  const keys = kids.map((kid) => ({ ...google.jwk, kid, alg: 'RS256', use: 'sig' }))
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    })
  ))
}

beforeEach(async () => {
  __resetGoogleJwksCache()
  google = await generateSigner()
  attacker = await generateSigner()
  mockJwks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetGoogleJwksCache()
})

describe('Google ID token 校验', () => {
  it('接受 Google 公钥签发的合法 token', async () => {
    const token = await signToken(google.privateKey, KID, {
      email: 'hubo1989@gmail.com',
      email_verified: true,
      name: 'Hubert',
      sub: 'google-sub-1',
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.identity).toEqual({ email: 'hubo1989@gmail.com', name: 'Hubert', sub: 'google-sub-1' })
    }
  })

  it('拒绝攻击者密钥自签的 token（这就是重构前的漏洞）', async () => {
    // kid 冒充 Google 已发布的 kid，签名却来自攻击者密钥
    const token = await signToken(attacker.privateKey, KID, {
      email: 'hubo1989@gmail.com',
      email_verified: true,
      sub: 'attacker',
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('拒绝 alg=none 的无签名 token', async () => {
    const header = b64urlJson({ alg: 'none', typ: 'JWT' })
    const payload = b64urlJson({ email: 'hubo1989@gmail.com', email_verified: true, sub: 'x', iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) })
    const result = await verifyGoogleIdToken(`${header}.${payload}.`, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'bad-algorithm' })
  })

  it('拒绝未知 kid', async () => {
    const token = await signToken(google.privateKey, 'unknown-kid', { email: 'a@b.com', email_verified: true, sub: 's' })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'unknown-key' })
  })

  it('拒绝换了 aud 的 token（别的应用的 token 不能登进来）', async () => {
    const token = await signToken(google.privateKey, KID, {
      email: 'a@b.com', email_verified: true, sub: 's', aud: 'other-client.apps.googleusercontent.com',
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'bad-audience' })
  })

  it('拒绝伪造的 iss', async () => {
    const token = await signToken(google.privateKey, KID, {
      email: 'a@b.com', email_verified: true, sub: 's', iss: 'https://evil.example.com',
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'bad-issuer' })
  })

  it('拒绝已过期的 token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signToken(google.privateKey, KID, {
      email: 'a@b.com', email_verified: true, sub: 's', exp: now - 3600, iat: now - 7200,
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('拒绝签发时间过旧的 token（限制重放窗口）', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signToken(google.privateKey, KID, {
      email: 'a@b.com', email_verified: true, sub: 's', iat: now - 7200, exp: now + 300,
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'stale' })
  })

  it('拒绝 nonce 不匹配的 token', async () => {
    const token = await signToken(google.privateKey, KID, {
      email: 'a@b.com', email_verified: true, sub: 's', nonce: 'nonce-a',
    })
    expect(await verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce: 'nonce-b' })).toEqual({
      ok: false, reason: 'bad-nonce',
    })
    expect((await verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce: 'nonce-a' })).ok).toBe(true)
  })

  it('拒绝未验证邮箱（否则可占他人邮箱账号）', async () => {
    const token = await signToken(google.privateKey, KID, {
      email: 'hubo1989@gmail.com', email_verified: false, sub: 's',
    })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'email-unverified' })
  })

  it('拒绝缺 email_verified 字段的 token', async () => {
    const token = await signToken(google.privateKey, KID, { email: 'a@b.com', sub: 's' })
    expect(await verifyGoogleIdToken(token, { clientId: CLIENT_ID })).toEqual({
      ok: false, reason: 'email-unverified',
    })
  })

  it('拒绝结构非法的 token', async () => {
    for (const bad of ['', 'a.b', 'not-a-jwt', 'a.b.c.d']) {
      const result = await verifyGoogleIdToken(bad, { clientId: CLIENT_ID })
      expect(result.ok).toBe(false)
    }
  })

  it('JWKS 不可用时拒绝，而不是放行', async () => {
    __resetGoogleJwksCache()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const token = await signToken(google.privateKey, KID, { email: 'a@b.com', email_verified: true, sub: 's' })
    const result = await verifyGoogleIdToken(token, { clientId: CLIENT_ID })
    expect(result).toEqual({ ok: false, reason: 'unknown-key' })
  })

  it('kid 轮换：缓存未命中时强制刷新 JWKS 并接受新 key', async () => {
    // 先用旧 kid 预热缓存
    const warm = await signToken(google.privateKey, KID, { email: 'a@b.com', email_verified: true, sub: 's' })
    expect((await verifyGoogleIdToken(warm, { clientId: CLIENT_ID })).ok).toBe(true)

    // Google 轮换：JWKS 里出现新 kid，旧 kid 保留（真实情况两者会共存一段时间）
    const NEW_KID = 'google-kid-2'
    mockJwks([KID, NEW_KID])
    const rotated = await signToken(google.privateKey, NEW_KID, { email: 'a@b.com', email_verified: true, sub: 's' })
    expect((await verifyGoogleIdToken(rotated, { clientId: CLIENT_ID })).ok).toBe(true)
  })
})
