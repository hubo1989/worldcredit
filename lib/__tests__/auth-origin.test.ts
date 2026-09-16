// 回归：OAuth 回调域名必须是固定的 APP_ORIGIN，而不是浏览器当前访问的域名。
//
// 曾经的写法是 `${url.origin}/api/auth/google/callback`，于是每个能访问到
// Worker 的域名都算一个候选回调地址：自定义域名上线后 Google Console 没有登记
// app.all-bill.com，Google 直接回 400 redirect_uri_mismatch，失败发生在进入本应用
// 之前，服务端日志里看不到任何线索。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAuthOrigin, googleRedirectUri, GOOGLE_CALLBACK_PATH } from '../auth-origin'
import { setWorkerEnv } from '../db/client'

const APP_ORIGIN = 'https://app.all-bill.com'
const WORKERS_ORIGIN = 'https://worldcredit.hubo1989.workers.dev'

const req = (origin: string) => new Request(`${origin}/api/auth/google/start`)

beforeEach(() => {
  delete process.env.APP_ORIGIN
  setWorkerEnv({ APP_ORIGIN })
})

afterEach(() => {
  delete process.env.APP_ORIGIN
  setWorkerEnv({})
})

describe('resolveAuthOrigin', () => {
  it('自定义域名请求使用 APP_ORIGIN', () => {
    expect(resolveAuthOrigin(req(APP_ORIGIN))).toBe(APP_ORIGIN)
  })

  it('workers.dev 请求也改用 APP_ORIGIN（否则就是未登记的 redirect_uri）', () => {
    expect(resolveAuthOrigin(req(WORKERS_ORIGIN))).toBe(APP_ORIGIN)
  })

  it('本机开发回退到请求自身 origin，便于本地调试', () => {
    for (const host of ['http://localhost:3050', 'http://127.0.0.1:3050', 'http://credit.localhost:3050']) {
      expect(resolveAuthOrigin(req(host))).toBe(host)
      expect(googleRedirectUri(req(host))).toBe(`${host}${GOOGLE_CALLBACK_PATH}`)
    }
  })

  it('未配置 APP_ORIGIN 时退回请求 origin，不会把登录整体打挂', () => {
    setWorkerEnv({})
    expect(resolveAuthOrigin(req(WORKERS_ORIGIN))).toBe(WORKERS_ORIGIN)
  })

  it('APP_ORIGIN 非法时忽略并使用请求 origin', () => {
    for (const bad of ['app.all-bill.com', 'ftp://app.all-bill.com', 'https://', '   ']) {
      setWorkerEnv({ APP_ORIGIN: bad })
      expect(resolveAuthOrigin(req(WORKERS_ORIGIN))).toBe(WORKERS_ORIGIN)
    }
  })

  it('容忍尾斜杠与带路径的写法，一律归一化为 origin', () => {
    for (const value of [`${APP_ORIGIN}/`, `${APP_ORIGIN}/login`]) {
      setWorkerEnv({ APP_ORIGIN: value })
      expect(resolveAuthOrigin(req(WORKERS_ORIGIN))).toBe(APP_ORIGIN)
      // 归一化后不会出现 "//api/..." 这类会再次触发 mismatch 的地址
      expect(googleRedirectUri(req(WORKERS_ORIGIN))).toBe(`${APP_ORIGIN}${GOOGLE_CALLBACK_PATH}`)
    }
  })

  it('授权请求与换取 token 必须用同一个 redirect_uri', () => {
    // 同一个 request 上两次调用必须完全一致；两次调用分别发生在 start 和
    // callback，任何一边单独改动都会触发 invalid_grant。
    const request = req(WORKERS_ORIGIN)
    expect(googleRedirectUri(request)).toBe(googleRedirectUri(request))
    expect(googleRedirectUri(request)).toBe(`${APP_ORIGIN}${GOOGLE_CALLBACK_PATH}`)
  })

  it('worker 绑定优先于 process.env', () => {
    process.env.APP_ORIGIN = 'https://env.example.com'
    expect(resolveAuthOrigin(req(WORKERS_ORIGIN))).toBe(APP_ORIGIN)
  })
})

describe('Google 路由不得再按请求域名拼回调地址', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8')

  it('两个路由都走 auth-origin 的 helper', () => {
    for (const rel of ['app/api/auth/google/start/route.ts', 'app/api/auth/google/callback/route.ts']) {
      expect(read(rel), rel).toMatch(/from '@\/lib\/auth-origin'/)
    }
  })

  it('callback 里不再出现 url.origin（回跳与 token 交换都在规范域名上）', () => {
    expect(read('app/api/auth/google/callback/route.ts')).not.toMatch(/url\.origin/)
  })

  it('start 会把非规范入口转交到 APP_ORIGIN（state cookie 不跨父域）', () => {
    // 下发 state cookie 的主机必须与收到回调的主机一致，否则从 workers.dev 发起
    // 授权时浏览器把 cookie 存在 workers.dev，回调落在 APP_ORIGIN 就必然校验失败。
    expect(read('app/api/auth/google/start/route.ts')).toMatch(/url\.origin !== canonicalOrigin/)
  })
})
