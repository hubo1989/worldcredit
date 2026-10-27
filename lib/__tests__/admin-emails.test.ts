// 回归：管理员身份只能来自显式白名单，不能因为「注册得早」或「用 Google 登录」
// 就自动获得。
//
// 两个授权入口都曾自动发 admin：Google 回调给任何新账号，register 给表里第一个
// 用户（并发下双方都读到 n=0，双双成为 admin）。Google 链路尤其危险——应用公网
// 可达，任何 Google 账号走完授权即拿到管理员，进而可读全库账单并调
// getSystemSettings 取走 AI 密钥。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_EMAILS, isAdminEmail } from '../admin-emails'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
import { RPC_REGISTRY } from '../api/registry'

describe('admin allowlist', () => {
  it('只认白名单里的邮箱（大小写与空白不敏感）', () => {
    for (const email of ADMIN_EMAILS) {
      expect(isAdminEmail(email)).toBe(true)
      expect(isAdminEmail(email.toUpperCase())).toBe(true)
      expect(isAdminEmail(`  ${email}  `)).toBe(true)
    }
  })

  it('拒绝任何不在白名单里的邮箱', () => {
    for (const email of [
      'attacker@example.com',
      'test@worldcredit.dev',
      'hubo@test.dev',
      'member@test.dev',
      'someone@gmail.com',
      '',
      null,
      undefined,
    ]) {
      expect(isAdminEmail(email as string | null | undefined)).toBe(false)
    }
  })

  it('不做子串/后缀匹配（hubo1989@gmail.com.evil.com 必须被拒）', () => {
    expect(isAdminEmail('hubo1989@gmail.com.evil.com')).toBe(false)
    expect(isAdminEmail('not-hubo1989@gmail.com')).toBe(false)
  })
})

describe('授权入口不得自动提权', () => {
  it('Google 回调不再硬编码 admin 角色', () => {
    const src = read('app/api/auth/google/callback/route.ts')
    // 新建用户那行必须按白名单决定角色，不能写死 'admin'
    expect(src).toMatch(/isAdminEmail\(email\)\s*\?\s*'admin'\s*:\s*'member'/)
    expect(src).not.toMatch(/name \|\| null, 'admin'\)/)
  })

  it('register 不再用「表里第一个用户」当管理员', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).not.toMatch(/COUNT\(\*\) AS n FROM users/)
    expect(src).toMatch(/isAdminEmail\(email\)\s*\?\s*'admin'\s*:\s*'member'/)
  })

  it('login 以白名单为准，历史 admin 行会在登录时被降级', () => {
    const src = read('app/api/auth/login/route.ts')
    expect(src).toMatch(/isAdminEmail\(result\.email\)\s*\?\s*['"]admin['"]\s*:\s*['"]member['"]/)
  })
})

describe('运维面仍受 admin 保护（与权限下移改造保持一致）', () => {
  it('系统设置与全站统计必须是 admin-only', () => {
    for (const [moduleName, fn] of [
      ['admin', 'getSystemSettings'],
      ['admin', 'updateSystemSettings'],
      ['dashboard', 'getDashboardStats'],
    ] as const) {
      expect(
        RPC_REGISTRY[moduleName]?.[fn]?.admin,
        `${moduleName}.${fn} 必须要求 admin`
      ).toBe(true)
    }
  })
})
