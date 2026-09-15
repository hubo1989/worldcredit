// lib/auth-origin.ts — 认证流程的规范 origin（server only）。
//
// OAuth 的 redirect_uri 必须与 Google Console 里登记的地址逐字符一致，而且
// 授权请求与换取 token 这两次调用必须使用同一个值。此前 start/callback 都直接
// 用 request.url 的 origin，等于把回调域名交给浏览器实际访问的域名来决定：
// workers.dev 域名、自定义域名、或前面多一层代理都各算一个 origin，只要有一个
// 没在 Google 侧登记，Google 就回 400 redirect_uri_mismatch，而且失败发生在进入
// 我们的 callback 之前，应用日志里什么都看不到。
//
// 所以生产固定使用 APP_ORIGIN（wrangler.jsonc 的 vars），只有本机开发
// （localhost / 127.0.0.1 / *.localhost）才回退到请求自身的 origin，这样本地
// 调试不需要为了让 Google 回调落到 localhost 而改动生产配置。

import { getWorkerEnv } from './db/client'

/** Google OAuth 回调路径。start 与 callback 必须共用同一个值，否则两次调用的
 *  redirect_uri 不一致，Google 会以 invalid_grant / mismatch 拒绝换取 token。 */
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost')
}

/** 只接受 http(s) 的裸 origin；非法或空值一律当未配置处理，避免把一个笔误
 *  变成全站无法登录。 */
function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    console.error(`[auth-origin] APP_ORIGIN 不是合法 URL，已忽略：${trimmed}`)
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.error(`[auth-origin] APP_ORIGIN 必须是 http/https，已忽略：${trimmed}`)
    return null
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    // 带路径的写法几乎都是误配（例如写成 .../login），只取 origin 并留一条日志。
    console.warn(`[auth-origin] APP_ORIGIN 含路径，已按 origin 处理：${trimmed} -> ${url.origin}`)
  }
  return url.origin
}

function configuredOrigin(): string | null {
  // 生产由 worker/index.ts 的 setWorkerEnv(env) 注入；本地或测试环境回退到
  // process.env，两者都没有时视为未配置。
  const fromBindings = normalizeOrigin(getWorkerEnv().APP_ORIGIN)
  if (fromBindings) return fromBindings
  return normalizeOrigin(typeof process !== 'undefined' ? process.env?.APP_ORIGIN : undefined)
}

/**
 * 解析本次认证流程应当使用的 origin。
 * - 本机开发：请求自身的 origin（localhost 调试不需要生产域名参与）
 * - 其余情况：APP_ORIGIN；未配置或非法时退回请求 origin（保持旧行为，不至于
 *   因为漏配一个变量就把 Google 登录整体打挂）
 */
export function resolveAuthOrigin(request: Request): string {
  const url = new URL(request.url)
  if (isLocalHost(url.hostname)) return url.origin

  const configured = configuredOrigin()
  if (!configured) return url.origin

  if (configured !== url.origin) {
    // 值得留痕：说明请求不是从规范域名进来的（例如有人直接访问 workers.dev），
    // 回调会统一被拉到 APP_ORIGIN。
    console.log(`[auth-origin] request origin=${url.origin} -> callback origin=${configured}`)
  }
  return configured
}

/** 完整的 Google redirect_uri，start 与 callback 共用。 */
export function googleRedirectUri(request: Request): string {
  return `${resolveAuthOrigin(request)}${GOOGLE_CALLBACK_PATH}`
}
