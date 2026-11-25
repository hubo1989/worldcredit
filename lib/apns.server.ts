// APNs operations for the main app Worker, including stale device cleanup.
import { getDb } from "./db";
import { broadcastApnsToUser, broadcastSilentSync, type ApnsBroadcastResult } from "./apns-broadcast";
import {
  sendApnsNotification as sendNotification,
  type ApnsConfig,
  type ApnsResponse,
  type SendPushOptions,
} from "./apns-client";

export { getApnsJwt } from "./apns-client";
export type { ApnsConfig, ApnsAlertPayload, SendPushOptions } from "./apns-client";

export async function sendApnsNotification(
  token: string,
  options: SendPushOptions,
  config: ApnsConfig,
): Promise<ApnsResponse> {
  const db = getDb();
  const owner = await db
    .prepare("SELECT user_id FROM device_tokens WHERE token = ?")
    .bind(token)
    .first<{ user_id: string }>();
  const result = await sendNotification(token, options, config);
  if (result.invalidToken && owner) {
    await db
      .prepare("DELETE FROM device_tokens WHERE token = ? AND user_id = ?")
      .bind(token, owner.user_id)
      .run();
  }
  return result;
}

type ApnsSummary = Pick<ApnsBroadcastResult, "total" | "sent" | "failed">;
type ApnsSummaryWithOutcomes = ApnsSummary & Pick<ApnsBroadcastResult, "outcomes">;

/** Broadcast to a user's iOS devices. Delivery tracking callers can request per-token results. */
export function sendApnsToUser(
  userId: string,
  options: SendPushOptions,
  config: ApnsConfig,
  prefetchedTokens: string[] | undefined,
  includeOutcomes: true,
): Promise<ApnsSummaryWithOutcomes>;
export function sendApnsToUser(
  userId: string,
  options: SendPushOptions,
  config: ApnsConfig,
  prefetchedTokens?: string[],
): Promise<ApnsSummary>;
export async function sendApnsToUser(
  userId: string,
  options: SendPushOptions,
  config: ApnsConfig,
  prefetchedTokens?: string[],
  includeOutcomes = false,
): Promise<ApnsSummary | ApnsSummaryWithOutcomes> {
  const { total, sent, failed, outcomes } = await broadcastApnsToUser(
    getDb(),
    userId,
    options,
    config,
    prefetchedTokens,
  );
  return includeOutcomes ? { total, sent, failed, outcomes } : { total, sent, failed };
}

/**
 * 触发指定用户的设备进行静默数据同步。
 */
export async function triggerSilentSyncForUser(userId: string, config: ApnsConfig): Promise<void> {
  await broadcastSilentSync(getDb(), userId, config);
}
