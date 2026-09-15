// 回归：AI API Key 不得经由任何角色可见的响应外泄。
//
// 两条曾经真实存在的泄露链路：
// 1. getSystemSettings() 把 system_settings 整表原样返回，AI Key 明文进了
//    RPC 响应体——哪怕只有 admin 能调，密钥也已经到了浏览器（devtools、内存、
//    网络面板）。
// 2. 前端拿到密钥后在浏览器里直接打 LLM（Authorization: Bearer <key>），
//    密钥因此必须下发到客户端才能工作。
//
// 现在：服务端边界剥离密钥，LLM 调用全在服务端完成，浏览器既不读也不持有。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setDb } from '../db/client'
import { getSystemSettings, getSystemSettingsWithSecrets, updateSystemSettings } from '../api/admin.server'
import { RPC_REGISTRY } from '../api/registry'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

// 一个足够真实的假密钥：既出现在返回值里就一定会被 includes() 抓到。
const SECRET = 'sk-live-DO-NOT-LEAK-abcdef1234567890'

/** 最小 D1 桩：只实现 query()/execute() 走到的 prepare().bind().all()/run()。 */
function fakeDb(rows: { key: string; value: string }[]) {
  const recorded: { sql: string; params: unknown[] }[] = []
  return {
    recorded,
    prepare(sql: string) {
      let bound: unknown[] = []
      const stmt = {
        bind(...params: unknown[]) {
          bound = params
          return stmt
        },
        async all() {
          recorded.push({ sql, params: bound })
          return { results: rows, success: true, meta: {} }
        },
        async run() {
          recorded.push({ sql, params: bound })
          return { success: true, meta: { changes: 1 } }
        },
      }
      return stmt
    },
  } as unknown as D1Database & { recorded: { sql: string; params: unknown[] }[] }
}

const SECRET_ROWS = [
  { key: 'ai_api_key', value: JSON.stringify(SECRET) },
  { key: 'ai_base_url', value: JSON.stringify('https://api.openai.com/v1') },
  { key: 'ai_model', value: JSON.stringify('gpt-4o-mini') },
  { key: 'vapid_public_key', value: JSON.stringify('BFakePublicKey') },
]

beforeEach(() => {
  setDb(fakeDb(SECRET_ROWS))
})

describe('getSystemSettings：RPC 可见的那个 getter 必须脱敏', () => {
  it('返回值里不出现密钥值（任何字符串里都不能有）', async () => {
    const settings = await getSystemSettings()
    // 这条是最关键的断言：不管密钥藏在哪个字段、哪个嵌套层，序列化后都不能出现
    expect(JSON.stringify(settings)).not.toContain(SECRET)
  })

  it('不包含 ai_api_key 字段本身', async () => {
    const settings = await getSystemSettings()
    expect(settings).not.toHaveProperty('ai_api_key')
    expect(Object.keys(settings)).not.toContain('ai_api_key')
  })

  it('用 ai_api_key_set 表达「已配置」，而不是回显空字符串', async () => {
    const settings = await getSystemSettings()
    expect(settings.ai_api_key_set).toBe(true)
    // 也不能把密钥塞进一个别的字段里
    for (const value of Object.values(settings)) {
      expect(value === SECRET).toBe(false)
    }
  })

  it('非敏感设置照常返回', async () => {
    const settings = await getSystemSettings()
    expect(settings.ai_base_url).toBe('https://api.openai.com/v1')
    expect(settings.ai_model).toBe('gpt-4o-mini')
    expect(settings.vapid_public_key).toBe('BFakePublicKey')
  })

  it('未配置密钥时 ai_api_key_set 为 false', async () => {
    setDb(fakeDb([{ key: 'ai_model', value: JSON.stringify('gpt-4o') }]))
    const settings = await getSystemSettings()
    expect(settings.ai_api_key_set).toBe(false)
    expect(settings).not.toHaveProperty('ai_api_key')
  })

  it('空字符串密钥也算未配置，且不回显', async () => {
    setDb(fakeDb([{ key: 'ai_api_key', value: JSON.stringify('') }]))
    const settings = await getSystemSettings()
    expect(settings.ai_api_key_set).toBe(false)
    // 注意断言的对象：字段名 ai_api_key 不得存在，但派生标志 ai_api_key_set 必须存在
    expect(settings).not.toHaveProperty('ai_api_key')
    expect(Object.keys(settings)).toEqual(['ai_api_key_set'])
  })
})

describe('getSystemSettingsWithSecrets：服务端内部专用', () => {
  it('服务端内部能拿到真值（否则 AI 调用会失效）', async () => {
    const settings = await getSystemSettingsWithSecrets()
    expect(settings.ai_api_key).toBe(SECRET)
  })

  it('绝对没有注册进 RPC registry（防止将来被误注册）', () => {
    for (const [moduleName, mod] of Object.entries(RPC_REGISTRY)) {
      for (const [fn, entry] of Object.entries(mod)) {
        expect(fn, `${moduleName}.${fn} 不得暴露 WithSecrets 变体`).not.toMatch(/WithSecrets/)
        expect(entry.impl).not.toBe(getSystemSettingsWithSecrets)
      }
    }
  })

  it('registry 里指向 getSystemSettings 的入口仍是脱敏版本', () => {
    const entry = RPC_REGISTRY.admin?.getSystemSettings
    expect(entry).toBeTruthy()
    expect(entry.admin).toBe(true)
    expect(entry.impl).toBe(getSystemSettings)
    expect(entry.impl).not.toBe(getSystemSettingsWithSecrets)
  })
})

describe('updateSystemSettings：写路径同样不回显密钥', () => {
  it('写入密钥时响应里不含明文', async () => {
    setDb(fakeDb([]))
    const res = await updateSystemSettings('ai_api_key', SECRET)
    expect(JSON.stringify(res)).not.toContain(SECRET)
    expect(res).not.toHaveProperty('ai_api_key')
    expect((res as Record<string, unknown>).ai_api_key_set).toBe(true)
  })

  it('普通设置照旧回显，行为不变', async () => {
    setDb(fakeDb([]))
    const res = await updateSystemSettings('ai_model', 'gpt-4o')
    expect(res).toEqual({ key: 'ai_model', value: 'gpt-4o' })
  })
})

describe('源码层不变量：客户端不得再读取密钥', () => {
  it('AiFillBox 不再依赖密钥，也不再拼 Authorization 头', () => {
    const src = read('components/mobile/AiFillBox.tsx')
    expect(src).not.toMatch(/ai_api_key/)
    expect(src).not.toMatch(/getSystemSettings/)
    expect(src).not.toMatch(/Authorization/)
    expect(src).not.toMatch(/chat\/completions/)
    // 必须改走服务端 aiComplete
    expect(src).toMatch(/aiComplete\(/)
  })

  it('浏览器组件里不存在任何 ai_api_key 读取', () => {
    for (const file of ['components/mobile/AiFillBox.tsx', 'components/mobile/BillForm.tsx', 'components/mobile/CardForm.tsx']) {
      expect(read(file), `${file} 不应触及 ai_api_key`).not.toMatch(/ai_api_key/)
    }
  })

  it('管理端设置页只显示「已配置」状态，不回显明文', () => {
    const src = read('app/admin/settings/page.tsx')
    // 不允许再出现 settings.ai_api_key 这种回显绑定
    expect(src).not.toMatch(/settings\.ai_api_key/)
    expect(src).toMatch(/ai_api_key_set/)
  })

  it('服务端唯一碰密钥的文件是 ai.server.ts / ai-assistant.ts / admin.server.ts', () => {
    const src = read('lib/api/ai.server.ts')
    // 只有服务端文件 import WithSecrets 变体
    expect(src).toMatch(/getSystemSettingsWithSecrets/)
    expect(src).not.toMatch(/import \{[^}]*\bgetSystemSettings\b[^}]*\} from '\.\/admin\.server'/)
  })
})

describe('AI 调用不再依赖客户端密钥', () => {
  it('智能填充走 ai_text 类型，服务端注入密钥', () => {
    const src = read('lib/api/ai.server.ts')
    expect(src).toMatch(/bill_text/)
    expect(src).toMatch(/card_text/)
  })

  it('aiComplete 仍在 registry 中可用（无 admin 门禁，成员可用）', () => {
    const entry = RPC_REGISTRY.ai?.aiComplete
    expect(entry).toBeTruthy()
    expect(entry.admin).toBeFalsy()
  })
})

// 防回归：确认假 D1 桩本身工作正常（否则上面的断言可能只是「根本没查到数据」）
describe('测试桩自检', () => {
  it('假 D1 返回了预期的行', async () => {
    const settings = await getSystemSettingsWithSecrets()
    expect(Object.keys(settings)).toContain('ai_api_key')
    vi.restoreAllMocks()
  })
})
