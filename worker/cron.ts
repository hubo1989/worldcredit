// worker/cron.ts — Scheduled handler for daily bill reminders + notification scan
// Deployed as part of the main Worker (cron trigger in wrangler.jsonc)

import webpush from "web-push";
import { sendApnsToUser } from "../lib/apns.server";
import { isWebPushChannelEnabled } from "../lib/notifications.shared";
import {
  buildDailyNotificationCandidates,
  isUserInQuietHours,
  type PrefetchedUserNotificationPrefs,
} from "../lib/notifications-engine.server";

interface CronEnv {
  DB: D1Database;
  ATTACHMENTS?: R2Bucket;
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
 * 校验用户的偏好设置是否开启了主动推送通道（Web Push / APNs 共用主开关）。
 * 若 enabled_channels 未设置而旧 opportunities.web_push_enabled === false，绝不下发。
 */
export function isUserWebPushEnabled(reminderConfigRaw?: string | null): boolean {
  return isWebPushChannelEnabled(reminderConfigRaw);
}

interface ExistingHistoryRow {
  id: string;
  notification_key: string;
  read_at: string | null;
  deleted_at: string | null;
  push_sent_at: string | null;
}

async function loadExistingHistoryByKey(
  db: D1Database,
  userId: string,
  keys: string[],
): Promise<Map<string, ExistingHistoryRow>> {
  const byKey = new Map<string, ExistingHistoryRow>();
  const CHUNK_SIZE = 50;
  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT id, notification_key, read_at, deleted_at, push_sent_at
         FROM notification_history
         WHERE user_id = ? AND notification_key IN (${placeholders})`,
      )
      .bind(userId, ...chunk)
      .all<ExistingHistoryRow>();
    for (const row of rows.results || []) {
      byKey.set(row.notification_key, row);
    }
  }
  return byKey;
}

export async function handleScheduled(
  scheduledEvent: ScheduledEvent,
  env: CronEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  console.log("[cron] Running daily notification scan...");

  const db = env.DB;
  if (env.ATTACHMENTS) _ctx.waitUntil(pruneOrphanDraftAttachments(db, env.ATTACHMENTS));
  await pruneStaleMutationsAndAuthAttempts(db);
  const nowDate =
    scheduledEvent &&
    typeof scheduledEvent.scheduledTime === "number" &&
    Number.isFinite(scheduledEvent.scheduledTime)
      ? new Date(scheduledEvent.scheduledTime)
      : new Date();
  const nowIso = nowDate.toISOString();

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

  // 2. Batch-prefetch subscriptions, iOS tokens, and preference tables once before the user loop
  const [subs, iosTokens, prefRows, legacyRows] = await Promise.all([
    db
      .prepare("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions")
      .all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>(),
    db
      .prepare("SELECT id, user_id, token FROM device_tokens WHERE platform = 'ios'")
      .all<{ id: string; user_id: string; token: string }>(),
    db
      .prepare("SELECT user_id, reminder_config FROM user_preferences")
      .all<{ user_id: string; reminder_config: string | null }>(),
    db
      .prepare("SELECT user_id, bill_due_enabled, overdue_enabled, due_days_before FROM notification_preferences")
      .all<{ user_id: string; bill_due_enabled: number; overdue_enabled: number; due_days_before: number }>(),
  ]);
  const subscriptions = subs.results || [];
  const iosDevices = iosTokens.results || [];
  const prefByUser = new Map<string, string | null>(
    (prefRows.results || []).map((row) => [row.user_id, row.reminder_config ?? null]),
  );
  const legacyByUser = new Map<
    string,
    { bill_due_enabled: number; overdue_enabled: number; due_days_before: number }
  >((legacyRows.results || []).map((row) => [row.user_id, row]));

  // 3. Process each user
  let sentCount = 0;
  let inboxCount = 0;

  for (const userId of userIds) {
    try {
      const userSubs = subscriptions.filter((s) => s.user_id === userId);
      const userDevices = iosDevices.filter((d) => d.user_id === userId);
      const prefetched: PrefetchedUserNotificationPrefs = {
        reminderConfigRaw: prefByUser.get(userId) ?? null,
        legacyRow: legacyByUser.get(userId) ?? null,
      };

      const { context, candidates } = await buildDailyNotificationCandidates(db, userId, undefined, {
        now: nowDate,
        prefetched,
      });
      if (!candidates.length) continue;

      const inQuiet = isUserInQuietHours(context, nowDate);
      const pushChannelEnabled = isUserWebPushEnabled(context.reminderConfigRaw);
      const canSendWebPush = !inQuiet && userSubs.length > 0 && pushChannelEnabled;
      const canSendApns =
        !inQuiet &&
        userDevices.length > 0 &&
        pushChannelEnabled &&
        Boolean(env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID);

      const existingByKey = await loadExistingHistoryByKey(
        db,
        userId,
        candidates.map((c) => c.notification_key),
      );

      for (const candidate of candidates) {
        const existing = existingByKey.get(candidate.notification_key);

        // 已删除 / 已读 / 已推送：绝不复活或二次发送
        if (existing && (existing.deleted_at || existing.read_at || existing.push_sent_at)) {
          continue;
        }

        if (!canSendWebPush && !canSendApns) {
          if (!existing) {
            const insertRes = await db
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
            if (Number(insertRes.meta?.changes ?? 0) > 0) inboxCount++;
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
              errors.push(`APNs failed for ${apnsResult.failed}/${apnsResult.total} devices`);
            }
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }

        let finalStatus: "sent" | "failed" | "skipped";
        if (deliveredAny) {
          finalStatus = "sent";
        } else if (errors.length > 0) {
          finalStatus = "failed";
        } else {
          finalStatus = "skipped";
        }
        const finalError = errors.length > 0 ? errors.join("; ") : null;
        const pushSentAt = deliveredAny ? nowIso : null;

        const upsertRes = await db
          .prepare(
            `INSERT INTO notification_history
               (id, user_id, notification_key, category, title, body, target_url, metadata_json, sent_at, status, push_sent_at, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, notification_key) DO UPDATE SET
               title = excluded.title,
               body = excluded.body,
               target_url = excluded.target_url,
               metadata_json = excluded.metadata_json,
               status = excluded.status,
               push_sent_at = COALESCE(notification_history.push_sent_at, excluded.push_sent_at),
               error = excluded.error
             WHERE notification_history.deleted_at IS NULL
               AND notification_history.read_at IS NULL
               AND notification_history.push_sent_at IS NULL`,
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

        if (deliveredAny) sentCount++;
        else if (Number(upsertRes.meta?.changes ?? 0) > 0) inboxCount++;
      }
    } catch (err) {
      console.error(`[cron] Failed processing user ${userId}:`, err);
    }
  }

  console.log(
    `[cron] Notification scan complete. Sent ${sentCount} push notifications, saved ${inboxCount} inbox items.`,
  );
}

async function pruneOrphanDraftAttachments(db: D1Database, bucket: R2Bucket): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  try {
    do {
      const page: R2Objects = await bucket.list({ prefix: "draft-files/", limit: 90, cursor });
      const expired = page.objects.filter(object => object.uploaded.getTime() < cutoff);
      if (expired.length) {
        const rows = await db.prepare(
          `SELECT id, record_type, storage_path FROM record_attachments WHERE bucket = 'record-attachments'
             AND storage_path IN (${expired.map(() => "?").join(",")})`,
        ).bind(...expired.map(object => object.key)).all<{ id: string; record_type: string; storage_path: string }>();
        const records = new Map(rows.results.map(row => [row.storage_path, row]));
        const removedKeys: string[] = [];
        for (const object of expired) {
          const record = records.get(object.key);
          if (!record) {
            removedKeys.push(object.key);
            continue;
          }
          const removed = await db.prepare(
            `DELETE FROM record_attachments WHERE id = ? AND (
               (record_type = 'bill' AND NOT EXISTS (SELECT 1 FROM bills WHERE id = record_attachments.record_id))
               OR (record_type = 'draft' AND NOT EXISTS (SELECT 1 FROM bill_import_drafts d
                 WHERE d.created_by = record_attachments.uploaded_by AND d.status != 'discarded'
                   AND (d.id = record_attachments.record_id OR d.file_ref = record_attachments.id
                     OR EXISTS (SELECT 1 FROM json_each(
                       CASE WHEN json_valid(d.parsed_payload) THEN d.parsed_payload ELSE '{}' END, '$.attachment_ids'
                     ) WHERE value = record_attachments.id))))
             )`,
          ).bind(record.id).run();
          if (removed.meta.changes) removedKeys.push(object.key);
        }
        if (removedKeys.length) await bucket.delete(removedKeys);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.warn("[cron] Draft attachment cleanup failed:", error);
  }
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
