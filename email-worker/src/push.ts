import type { ApnsConfig } from '../../lib/apns-client'
import { broadcastSilentSync } from '../../lib/apns-broadcast'
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
  const { total, failedResults } = await broadcastSilentSync(db, userId, config)
  if (failedResults.length) {
    console.warn(
      `[email-worker] Silent sync delivery failed for ${failedResults.length}/${total} devices`,
      failedResults.map(({ statusCode, error }) => ({ statusCode, error }))
    )
  }
}
