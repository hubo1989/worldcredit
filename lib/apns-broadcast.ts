import {
  sendApnsNotification,
  type ApnsConfig,
  type ApnsResponse,
  type SendPushOptions,
} from "./apns-client";

/** Parameterized for both Workers; never reads a global database binding. */
export async function broadcastApnsToUser(
  db: D1Database,
  userId: string,
  options: SendPushOptions,
  config: ApnsConfig,
): Promise<{ total: number; sent: number; failed: number; failedResults: ApnsResponse[] }> {
  const { results: devices } = await db
    .prepare("SELECT token FROM device_tokens WHERE user_id = ? AND platform = 'ios'")
    .bind(userId)
    .all<{ token: string }>();

  const outcomes = await Promise.all(
    devices.map(async ({ token }) => {
      const result = await sendApnsNotification(token, options, config);
      if (result.invalidToken) {
        // A device may have changed accounts while the APNs request was in flight.
        await db
          .prepare("DELETE FROM device_tokens WHERE token = ? AND user_id = ?")
          .bind(token, userId)
          .run();
      }
      return result;
    }),
  );
  const failedResults = outcomes.filter((result) => !result.success);
  return {
    total: outcomes.length,
    sent: outcomes.length - failedResults.length,
    failed: failedResults.length,
    failedResults,
  };
}

export function broadcastSilentSync(db: D1Database, userId: string, config: ApnsConfig) {
  return broadcastApnsToUser(
    db,
    userId,
    {
      isSilent: true,
      customData: { type: "sync", timestamp: Date.now() },
    },
    config,
  );
}
