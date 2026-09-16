// 回归：OAuth state 必须「签名 + 与浏览器绑定 + 一次性」。
//
// 此前 start 生成 state 后直接丢弃、callback 从不校验，等于没有 CSRF 防护：
// 攻击者先自行走一遍授权拿到 (code, state)，再把回调地址喂给受害者，受害者
// 的会话就变成攻击者的 Google 账号。

import { describe, it, expect, beforeEach } from 'vitest'
import { issueOAuthState, verifyOAuthState, OAUTH_STATE_COOKIE } from '../oauth-state'
import { setWorkerEnv } from '../db/client'

beforeEach(() => {
  setWorkerEnv({ SESSION_SECRET: 'test-secret-at-least-16-chars' })
})

const cookieOf = (setCookie: string) => setCookie.split(';')[0]

const requestWith = (cookie: string | null, state: string | null) =>
  new Request(`https://app.all-bill.com/api/auth/google/callback?state=${state ?? ''}`, {
    headers: cookie ? { Cookie: cookie } : {},
  })

describe('OAuth state', () => {
  it('签发的 state 能被同一次授权校验通过', async () => {
    const { state, cookie } = await issueOAuthState()
    expect(state).toMatch(/^[0-9a-f-]{36}$/)
    expect(await verifyOAuthState(requestWith(cookieOf(cookie), state), state)).toBe(true)
  })

  it('没有 cookie 时拒绝（攻击者只拿到 code/state 无法推进）', async () => {
    const { state } = await issueOAuthState()
    expect(await verifyOAuthState(requestWith(null, state), state)).toBe(false)
  })

  it('query 里的 state 与 cookie 内不一致时拒绝', async () => {
    const { cookie } = await issueOAuthState()
    expect(await verifyOAuthState(requestWith(cookieOf(cookie), 'other-state'), 'other-state')).toBe(false)
  })

  it('缺少 state 参数时拒绝', async () => {
    const { cookie } = await issueOAuthState()
    expect(await verifyOAuthState(requestWith(cookieOf(cookie), null), null)).toBe(false)
  })

  it('篡改 cookie 载荷会被签名拦下（cookie tossing 防护）', async () => {
    const { state, cookie } = await issueOAuthState()
    const raw = cookieOf(cookie).slice(OAUTH_STATE_COOKIE.length + 1)
    const [payload, sig] = raw.split('.')
    const forged = Buffer.from(
      JSON.stringify({ state: 'attacker-state', exp: Math.floor(Date.now() / 1000) + 600 })
    ).toString('base64url')
    const forgedCookie = `${OAUTH_STATE_COOKIE}=${forged}.${sig}`
    expect(await verifyOAuthState(requestWith(forgedCookie, 'attacker-state'), 'attacker-state')).toBe(false)

    // 载荷不动、签名动，同样必须失败
    const badSig = `${OAUTH_STATE_COOKIE}=${payload}.AAAA${sig.slice(4)}`
    expect(await verifyOAuthState(requestWith(badSig, state), state)).toBe(false)
  })

  it('不认未签名的裸 state cookie（不能提前固定）', async () => {
    const raw = Buffer.from(JSON.stringify({ state: 'attacker', exp: Date.now() / 1000 + 600 })).toString('base64url')
    const cookie = `${OAUTH_STATE_COOKIE}=${raw}`
    expect(await verifyOAuthState(requestWith(cookie, 'attacker'), 'attacker')).toBe(false)
  })

  it('过期的 state 被拒绝', async () => {
    const { state, cookie } = await issueOAuthState()
    const raw = cookieOf(cookie).slice(OAUTH_STATE_COOKIE.length + 1)
    const [payload, sig] = raw.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    decoded.exp = Math.floor(Date.now() / 1000) - 10
    const expired = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    expect(
      await verifyOAuthState(requestWith(`${OAUTH_STATE_COOKIE}=${expired}.${sig}`, state), state)
    ).toBe(false)
  })

  it('两次签发得到不同的 state，且互不通用', async () => {
    const a = await issueOAuthState()
    const b = await issueOAuthState()
    expect(a.state).not.toBe(b.state)
    expect(await verifyOAuthState(requestWith(cookieOf(a.cookie), b.state), b.state)).toBe(false)
  })

  it('cookie 属性：HttpOnly + SameSite=Lax + Path=/', async () => {
    const { cookie } = await issueOAuthState()
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=\d+/)
  })
})
