// 回归：session cookie 的线格式重构前后必须完全兼容。
//
// 本轮为了给 OAuth state cookie 复用 HMAC 原语，把 lib/session.ts 里的
// toB64Url/fromB64Url/readCookie/getSessionKey 抽到了 lib/base64url.ts、
// lib/cookies.ts、lib/hmac.ts。抽错了不会有编译报错——只会让**已签发且仍有
// 7 天有效期**的现网 cookie 全部验签失败、全员被登出。所以这里用一份「按重构前
// 写法内联生成」的 cookie 反向验证，并锁定格式与编码细节。

import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionValue, verifySessionValue } from '../session'
import { setWorkerEnv } from '../db/client'

const SECRET = 'test-secret-at-least-16-chars'

beforeAll(() => setWorkerEnv({ SESSION_SECRET: SECRET }))

/** 重构前的实现（内联版），用于生成「旧版 cookie」。 */
async function legacySessionValue(payload: Record<string, unknown>): Promise<string> {
  const enc = (b: Uint8Array) => {
    let s = ''
    for (const x of b) s += String.fromCharCode(x)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  const sig = await crypto.subtle.sign('HMAC', key, bytes as unknown as ArrayBuffer)
  return enc(bytes) + '.' + enc(new Uint8Array(sig))
}

const ADMIN = {
  id: 'user-1',
  email: 'hubo1989@gmail.com',
  name: 'Hubert',
  role: 'admin' as const,
  created_at: '2026-09-11T00:00:00.000Z',
}

describe('session cookie 线格式兼容性', () => {
  it('两段 base64url、无 padding、无 +/（与重构前一致）', async () => {
    const value = await createSessionValue(ADMIN)
    const parts = value.split('.')
    expect(parts).toHaveLength(2)
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(value).not.toContain('=')
  })

  it('载荷字段与 exp（7 天）保持不变', async () => {
    const value = await createSessionValue(ADMIN)
    const decoded = JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString())
    expect(decoded).toMatchObject(ADMIN)
    const expectedExp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
    expect(Math.abs(decoded.exp - expectedExp)).toBeLessThan(5)
  })

  it('旧版实现生成的 cookie 仍能被新版校验通过（不登出现网用户）', async () => {
    const legacy = await legacySessionValue({ ...ADMIN, exp: Math.floor(Date.now() / 1000) + 604800 })
    const parsed = await verifySessionValue(legacy)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('user-1')
    expect(parsed!.role).toBe('admin')
  })

  it('中文姓名等非 ASCII 载荷同样往返一致', async () => {
    const user = { ...ADMIN, name: '胡波 🎉' }
    const value = await createSessionValue(user)
    const parsed = await verifySessionValue(value)
    expect(parsed?.name).toBe('胡波 🎉')
    // 旧实现签的是原始字节，含多字节字符时也必须一致
    const legacy = await legacySessionValue({ ...user, exp: Math.floor(Date.now() / 1000) + 604800 })
    expect((await verifySessionValue(legacy))?.name).toBe('胡波 🎉')
  })

  it('篡改后仍被拒绝（抽取过程中没弄丢验签）', async () => {
    const value = await createSessionValue(ADMIN)
    const [payload, sig] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ ...ADMIN, id: 'attacker', role: 'admin', exp: Math.floor(Date.now() / 1000) + 604800 })).toString('base64url')
    expect(await verifySessionValue(`${forged}.${sig}`)).toBeNull()
    expect(await verifySessionValue(`${payload}.AAAA${sig.slice(4)}`)).toBeNull()
    expect(await verifySessionValue(Buffer.from(JSON.stringify(ADMIN)).toString('base64url'))).toBeNull()
  })
})
