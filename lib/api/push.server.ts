// lib/api/push.server.ts — Web Push subscription management (server side).

import { queryOne, execute, uuid, now } from '../db'

export interface PushSubscribeInput {
  endpoint: string
  p256dh: string
  auth: string
}

// Upsert on the UNIQUE endpoint column so re-subscriptions don't duplicate.
// userId is bound to the session by the RPC registry (bindUser: 1).
export async function subscribePush(input: PushSubscribeInput, userId: string): Promise<void> {
  if (!input?.endpoint || !input.p256dh || !input.auth) {
    throw new Error('推送订阅数据不完整')
  }
  const { error } = await execute(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [uuid(), userId, input.endpoint, input.p256dh, input.auth, now()]
  )
  if (error) throw new Error(error.message)
}

export async function getPushPublicKeySetting(): Promise<string | null> {
  const { data } = await queryOne<{ value: string }>(
    "SELECT value FROM system_settings WHERE key = 'vapid_public_key'"
  )
  return data?.value ?? null
}
