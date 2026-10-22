// APNs operations for the main app Worker, including stale device cleanup.
import { execute, query } from './db'
import {
  sendApnsNotification as sendNotification,
  type ApnsConfig,
  type ApnsResponse,
  type SendPushOptions,
} from './apns-client'

export { getApnsJwt } from './apns-client'
export type { ApnsConfig, ApnsAlertPayload, SendPushOptions } from './apns-client'

export async function sendApnsNotification(
  token: string,
  options: SendPushOptions,
  config: ApnsConfig
): Promise<ApnsResponse> {
  const result = await sendNotification(token, options, config)
  if (result.invalidToken) {
    const { error } = await execute('DELETE FROM device_tokens WHERE token = ?', [token])
    if (error) throw new Error(error.message)
  }
  return result
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
