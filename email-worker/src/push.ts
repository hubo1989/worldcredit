import { sendApnsNotification, type ApnsConfig } from '../../lib/apns-client'
import type { Env } from './types'

/** Keep notification delivery outside the bill import transaction and response path. */
export function scheduleBillSync(env: Env, ctx: ExecutionContext, userId: string): void {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return

  const config: ApnsConfig = {
    keyP8: env.APNS_KEY_P8,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID,
    isProduction: env.APNS_ENVIRONMENT === 'production',
  }
  ctx.waitUntil(sendBillSync(env.DB, userId, config).catch(error => {
    // Delivery failure must not turn an already-persisted bill into a failed import.
    console.error('[email-worker] Silent sync delivery failed:', error)
  }))
}

async function sendBillSync(db: D1Database, userId: string, config: ApnsConfig): Promise<void> {
  const { results } = await db.prepare(
    "SELECT token FROM device_tokens WHERE user_id = ? AND platform = 'ios'"
  ).bind(userId).all<{ token: string }>()

  const outcomes = await Promise.all(results.map(async ({ token }) => {
    const result = await sendApnsNotification(token, {
      isSilent: true,
      customData: { type: 'sync', timestamp: Date.now() },
    }, config)
    if (result.invalidToken) {
      // Do not delete a device that changed ownership while the request was in flight.
      await db.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?')
        .bind(token, userId).run()
    }
    return result
  }))
  const failed = outcomes.filter(result => !result.success).length
  if (failed) {
    console.warn(
      `[email-worker] Silent sync delivery failed for ${failed}/${outcomes.length} devices`,
      outcomes.filter(result => !result.success).map(({ statusCode, error }) => ({ statusCode, error }))
    )
  }
}
