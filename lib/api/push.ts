// lib/api/push.ts — client-side RPC wrappers (server: push.server.ts).
import type * as Server from './push.server'
import { callRpc } from './rpc-client'

export function subscribePush(input: Server.PushSubscribeInput) {
  // userId 位置由服务端 registry 以会话身份覆盖（bindUser: 1）
  return callRpc<typeof Server.subscribePush>('push', 'subscribePush', input, '')
}

export interface TestPushResult {
  ok: boolean
  error?: string
  data?: {
    subscriptions: number
    sent: number
    removed: number
    errors: string[]
  }
}

/**
 * 校验用户的提醒配置是否允许下发 Web Push。
 * 存量口径：若 enabled_channels 未显式设置，而旧 opportunities.web_push_enabled === false，则不开启。
 */
export function isWebPushChannelEnabled(
  config?: {
    enabled_channels?: string[]
    opportunities?: { web_push_enabled?: boolean }
  } | null
): boolean {
  if (!config) return true
  if (config.enabled_channels !== undefined) {
    return Array.isArray(config.enabled_channels) && config.enabled_channels.includes('web_push')
  }
  if (config.opportunities && config.opportunities.web_push_enabled === false) {
    return false
  }
  return true
}

/** 触发向当前用户订阅发送测试通知（收敛到统一 API 模块） */
export async function sendTestPush(): Promise<TestPushResult> {
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      credentials: 'same-origin',
    })
    const json = (await res.json().catch(() => null)) as {
      data?: {
        subscriptions: number
        sent: number
        removed: number
        errors: string[]
      }
      error?: string
    } | null

    if (!res.ok) {
      return {
        ok: false,
        error: json?.error || `推送接口请求失败 (${res.status})`,
      }
    }

    return {
      ok: true,
      data: json?.data,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '网络请求失败',
    }
  }
}
