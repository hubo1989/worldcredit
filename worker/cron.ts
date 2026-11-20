// worker/cron.ts — Scheduled handler for daily bill reminders + notification scan
// Deployed as part of the main Worker (cron trigger in wrangler.jsonc)

import webpush from "web-push";
import { getLocalTodayString } from "../lib/utils";
import { sendApnsToUser } from "../lib/apns.server";
import {
  buildDailyNotificationCandidates,
  isUserInQuietHours,
} from "../lib/notifications-engine.server";

interface CronEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENVIRONMENT?: string;
}

/**
 * 校验用户的偏好设置是否开启了 Web Push（统一存量兼容口径与迁移判断）。
 * 若 enabled_channels 未设置而旧 opportunities.web_push_enabled === false，绝不下发。
 */
export function isUserWebPushEnabled(reminderConfigRaw?: string | null): boolean {
  if (!reminderConfigRaw) return true;
  try {
    const parsed = JSON.parse(reminderConfigRaw) as {
      enabled_channels?: string[];
      opportunities?: { web_push_enabled?: boolean };
    };
    if (parsed.enabled_channels !== undefined) {
      return (
        Array.isArray(parsed.enabled_channels) &&
        parsed.enabled_channels.includes("web_push")
      );
    }
    if (parsed.opportunities && parsed.opportunities.web_push_enabled === false) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function handleScheduled(
  _event: ScheduledEvent,
  env: CronEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  console.log("[cron] Running daily notification scan...");

  const db = env.DB;
  await pruneStaleMutationsAndAuthAttempts(db);
  const nowDate =
    _event && typeof _event.scheduledTime === "number" && Number.isFinite(_event.scheduledTime)
      ? new Date(_event.scheduledTime)
      : new Date();
  const nowIso = nowDate.toISOString();
  const today = getLocalTodayString("Asia/Shanghai", nowDate);

  // 1. Collect target users (users table + fallback preference tables for isolated tests)
  const userRows = await db
    .prepare(
      `SELECT id FROM users
       UNION
       SELECT user_id AS id FROM user_preferences
       UNION
       SELECT user_id AS id FROM notification_preferences`,
    )
    .all<{ id: string }>();
  const userIds = (userRows.results || []).map((r) => r.id).filter(Boolean);

  if (!userIds.length) {
    console.log("[cron] No users found. Done.");
    return;
  }

  // 2. Get all push subscriptions (Web Push & iOS device tokens)
  const subs = await db
    .prepare("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions")
    .all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>();
  const subscriptions = subs.results || [];

  const iosTokens = await db
    .prepare("SELECT id, user_id, token FROM device_tokens WHERE platform = 'ios'")
    .all<{ id: string; user_id: string; token: string }>();
  const iosDevices = iosTokens.results || [];

  // 3. Process each user
  let sentCount = 0;
  let inboxCount = 0;

  for (const userId of userIds) {
    const userSubs = subscriptions.filter((s) => s.user_id === userId);
    const userDevices = iosDevices.filter((d) => d.user_id === userId);

    const { context, candidates } = await buildDailyNotificationCandidates(db, userId, today);
    if (!candidates.length) continue;

    const inQuiet = isUserInQuietHours(context, nowDate);
    const canSendWebPush =
      !inQuiet && userSubs.length > 0 && isUserWebPushEnabled(context.reminderConfigRaw);
    const canSendApns =
      !inQuiet &&
      userDevices.length > 0 &&
      Boolean(env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID);

    for (const candidate of candidates) {
      const existing = await db
        .prepare(
          `SELECT id, read_at, deleted_at, push_sent_at
           FROM notification_history
           WHERE user_id = ? AND notification_key = ?`,
        )
        .bind(userId, candidate.notification_key)
        .first<{
          id: string;
          read_at: string | null;
          deleted_at: string | null;
          push_sent_at: string | null;
        }>();

      // 已删除 / 已读 / 已推送：绝不复活或二次发送
      if (existing && (existing.deleted_at || existing.read_at || existing.push_sent_at)) {
        continue;
      }

      if (!canSendWebPush && !canSendApns) {
        if (!existing) {
          await db
            .prepare(
              `INSERT OR IGNORE INTO notification_history
                 (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status, push_sent_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', NULL)`,
            )
            .bind(
              crypto.randomUUID(),
              userId,
              candidate.notification_key,
              candidate.category,
              candidate.title,
              candidate.body,
              candidate.target_url,
              candidate.metadata_json,
              nowIso,
            )
            .run();
          inboxCount++;
        }
        continue;
      }

      let deliveredAny = false;
      const errors: string[] = [];

      if (canSendWebPush) {
        try {
          const { sent, staleIds } = await sendPushToSubscriptions(
            env,
            userSubs,
            candidate.title,
            candidate.body,
            candidate.target_url,
          );
          if (sent > 0) deliveredAny = true;
          for (const id of staleIds) {
            await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id).run();
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      if (canSendApns && env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID) {
        try {
          const apnsResult = await sendApnsToUser(
            userId,
            {
              alert: { title: candidate.title, body: candidate.body },
              sound: "default",
              badge: 1,
              customData: {
                type: candidate.category,
                url: candidate.target_url,
              },
            },
            {
              keyP8: env.APNS_KEY_P8,
              keyId: env.APNS_KEY_ID,
              teamId: env.APNS_TEAM_ID,
              bundleId: env.APNS_BUNDLE_ID,
              isProduction: env.APNS_ENVIRONMENT === "production",
            },
            userDevices.map((d) => d.token),
          );
          if (apnsResult.sent > 0) deliveredAny = true;
          if (apnsResult.failed > 0) {
            console.warn(
              `[cron] APNs delivery failed for ${apnsResult.failed}/${apnsResult.total} devices on ${candidate.notification_key}`,
            );
            if (apnsResult.sent === 0) {
              errors.push(`APNs failed for all ${apnsResult.total} devices`);
            }
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      const finalStatus = deliveredAny ? "sent" : errors.length > 0 ? "failed" : "skipped";
      const finalError = errors.length > 0 && !deliveredAny ? errors.join("; ") : null;
      const pushSentAt = deliveredAny ? nowIso : null;

      if (existing) {
        await db
          .prepare(
            `UPDATE notification_history
             SET title = ?, body = ?, target_url = ?, metadata_json = ?, status = ?, push_sent_at = ?, error = ?
             WHERE id = ?`,
          )
          .bind(
            candidate.title,
            candidate.body,
            candidate.target_url,
            candidate.metadata_json,
            finalStatus,
            pushSentAt,
            finalError,
            existing.id,
          )
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO notification_history
               (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status, push_sent_at, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            userId,
            candidate.notification_key,
            candidate.category,
            candidate.title,
            candidate.body,
            candidate.target_url,
            candidate.metadata_json,
            nowIso,
            finalStatus,
            pushSentAt,
            finalError,
          )
          .run();
      }

      if (deliveredAny) sentCount++;
      else inboxCount++;
    }
  }

  console.log(
    `[cron] Notification scan complete. Sent ${sentCount} push notifications, saved ${inboxCount} inbox items.`,
  );
}

async function pruneStaleMutationsAndAuthAttempts(db: D1Database): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db
      .prepare(
        "DELETE FROM sync_mutations WHERE result IS NULL AND processed_at < datetime(?, '-10 minutes')",
      )
      .bind(now)
      .run();

    await db
      .prepare("DELETE FROM auth_login_attempts WHERE window_expires_at <= datetime(?)")
      .bind(now)
      .run();
  } catch (err) {
    console.warn("[cron] Stale mutations/auth prune skipped:", err);
  }
}

async function sendPushToSubscriptions(
  env: CronEnv,
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
  title: string,
  body: string,
  targetUrl = "/bills",
): Promise<{ sent: number; staleIds: string[] }> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys not configured (npx wrangler secret put VAPID_PRIVATE_KEY)");
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:admin@worldcredit.app",
    publicKey,
    privateKey,
  );

  const payload = JSON.stringify({ title, body, url: targetUrl });
  let sent = 0;
  const staleIds: string[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        staleIds.push(sub.id);
      } else {
        throw err;
      }
    }
  }
  return { sent, staleIds };
}
