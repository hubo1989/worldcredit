// lib/apns.server.ts — APNs (Apple Push Notification service) client for Cloudflare Workers.

import { execute, query } from './db'

export interface ApnsConfig {
  keyP8?: string
  keyId?: string
  teamId?: string
  bundleId?: string
  isProduction?: boolean
}

export interface ApnsAlertPayload {
  title: string
  body: string
}

export interface SendPushOptions {
  alert?: ApnsAlertPayload
  badge?: number
  sound?: string
  isSilent?: boolean
  customData?: Record<string, unknown>
}

let cachedJwt: { token: string; expiresAt: number } | null = null

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array | string): string {
  let str: string
  if (typeof buffer === 'string') {
    str = btoa(unescape(encodeURIComponent(buffer)))
  } else {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    str = btoa(binary)
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function pemToBinary(pem: string): Uint8Array {
  const cleanPem = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '')
  const binaryString = atob(cleanPem)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 构造并签名 APNs 认证 JWT (ES256)。
 * 缓存 30 分钟以避免每次调用都重新导入私钥并签名。
 */
export async function getApnsJwt(config: ApnsConfig): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwt.expiresAt > nowSec + 60) {
    return cachedJwt.token
  }

  const { keyP8, keyId, teamId } = config
  if (!keyP8 || !keyId || !teamId) {
    throw new Error('APNs 凭证不完整（缺少 keyP8, keyId 或 teamId）')
  }

  const header = {
    alg: 'ES256',
    kid: keyId,
  }
  const payload = {
    iss: teamId,
    iat: nowSec,
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)

  const privateKeyDer = pemToBinary(keyP8)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    cryptoKey,
    dataToSign
  )

  const encodedSignature = base64UrlEncode(signature)
  const jwt = `${encodedHeader}.${encodedPayload}.${encodedSignature}`

  // 缓存 30 分钟 (1800 秒)
  cachedJwt = {
    token: jwt,
    expiresAt: nowSec + 1800,
  }

  return jwt
}

/**
 * 向单台 iOS 设备推送 APNs 消息。
 */
export async function sendApnsNotification(
  token: string,
  options: SendPushOptions,
  config: ApnsConfig
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const { keyP8, keyId, teamId } = config
  if (!keyP8 || !keyId || !teamId) {
    return { success: false, error: 'apns_not_configured' }
  }

  const bundleId = config.bundleId ?? 'com.worldcredit.app'
  const isProduction = config.isProduction ?? false
  const host = isProduction
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com'
  const endpoint = `${host}/3/device/${token}`

  let jwt: string
  try {
    jwt = await getApnsJwt(config)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }

  // 构造 aps 负载
  const aps: Record<string, unknown> = {}
  let pushType: 'alert' | 'background' = 'alert'
  let priority = '10'

  if (options.isSilent) {
    aps['content-available'] = 1
    pushType = 'background'
    priority = '5'
  } else {
    if (options.alert) {
      aps.alert = options.alert
    }
    if (typeof options.badge === 'number') {
      aps.badge = options.badge
    }
    if (options.sound) {
      aps.sound = options.sound
    }
  }

  const requestBody = {
    aps,
    ...(options.customData ?? {}),
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': pushType,
        'apns-priority': priority,
        'apns-expiration': '0',
      },
      body: JSON.stringify(requestBody),
    })

    if (res.status === 200) {
      return { success: true, statusCode: 200 }
    }

    const text = await res.text()
    // 若 Token 失效 (410 或 400 BadDeviceToken)，自动清理数据库对应记录
    if (res.status === 410 || text.includes('BadDeviceToken') || text.includes('Unregistered')) {
      await execute('DELETE FROM device_tokens WHERE token = ?', [token])
    }

    return {
      success: false,
      statusCode: res.status,
      error: `APNs error ${res.status}: ${text}`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

/**
 * 向指定用户的所有有效 iOS 设备广播推送。
 */
export async function sendApnsToUser(
  userId: string,
  options: SendPushOptions,
  config: ApnsConfig
): Promise<{ total: number; sent: number; failed: number }> {
  const { data: devices } = await query<{ token: string }>(
    "SELECT token FROM device_tokens WHERE user_id = ? AND platform = 'ios'",
    [userId]
  )

  if (!devices || devices.length === 0) {
    return { total: 0, sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  await Promise.all(
    devices.map(async ({ token }) => {
      const res = await sendApnsNotification(token, options, config)
      if (res.success) {
        sent++
      } else {
        failed++
      }
    })
  )

  return { total: devices.length, sent, failed }
}

/**
 * 触发指定用户的设备进行静默数据同步。
 */
export async function triggerSilentSyncForUser(
  userId: string,
  config: ApnsConfig
): Promise<void> {
  await sendApnsToUser(
    userId,
    {
      isSilent: true,
      customData: {
        type: 'sync',
        timestamp: Date.now(),
      },
    },
    config
  )
}
