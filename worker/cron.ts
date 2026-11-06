// worker/cron.ts — Scheduled handler for daily bill reminders + notification scan
// Deployed as part of the main Worker (cron trigger in wrangler.jsonc)

import webpush from "web-push";
import { getLocalTodayString } from "../lib/utils";
import { sendApnsToUser } from "../lib/apns.server";

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

interface BillWithCard {
  id: string;
  account_id: string | null;
  card_id: string;
  bill_month: string;
  bill_amount: number;
  min_payment: number | null;
  due_date: string;
  status: string;
  holder_id: string;
  created_by: string;
  bank_name: string | null;
  card_name: string | null;
  card_number_last4: string | null;
  account_statement_mode: string | null;
  /** 卡级别名称覆盖（NULL = 使用卡产品默认名称）。 */
  name_override: string | null;
}

export async function handleScheduled(
  _event: ScheduledEvent,
  env: CronEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  console.log("[cron] Running daily notification scan...");

  const db = env.DB;
  await pruneStaleMutationsAndAuthAttempts(db);
  const today = getLocalTodayString("Asia/Shanghai");

  // 1. Get all unpaid/overdue bills with card + holder info + account mode
  const bills = await db
    .prepare(
      `
    SELECT b.id, b.account_id, b.card_id, b.bill_month,
           COALESCE(b.bill_amount_override, b.bill_amount) AS bill_amount,
           b.min_payment, b.due_date, b.status,
           ch.id AS holder_id, ch.created_by,
           cp.bank_name, cp.card_name, cc.name_override, cc.card_number_last4,
           ca.statement_mode AS account_statement_mode
    FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    LEFT JOIN card_products cp ON cc.card_product_id = cp.id
    LEFT JOIN credit_accounts ca ON (b.account_id = ca.id OR (b.account_id IS NULL AND cc.account_id = ca.id))
    WHERE b.status IN ('unpaid', 'partial', 'overdue')
  `,
    )
    .all<BillWithCard>();
  const allBills = bills.results || [];

  // 1.1 批量收集合并账户下的 active 卡信息
  const mergedAccountIds = Array.from(
    new Set(
      allBills
        .filter((b) => b.account_statement_mode === "merged" && b.account_id)
        .map((b) => b.account_id as string),
    ),
  );
  const accountCardsMap: Record<string, { count: number; firstTail: string }> = {};
  if (mergedAccountIds.length > 0) {
    const placeholders = mergedAccountIds.map(() => "?").join(",");
    const memberStmt = await db
      .prepare(
        `SELECT account_id, card_number_last4 FROM credit_cards WHERE account_id IN (${placeholders}) AND status = 'active' ORDER BY created_at ASC`,
      )
      .bind(...mergedAccountIds)
      .all<{ account_id: string; card_number_last4: string | null }>();
    for (const mc of memberStmt.results || []) {
      if (!accountCardsMap[mc.account_id]) {
        accountCardsMap[mc.account_id] = { count: 0, firstTail: mc.card_number_last4 || "" };
      }
      accountCardsMap[mc.account_id].count++;
    }
  }

  // 2. Get all notification preferences and user preferences (reminder channels)
  const prefs = await db
    .prepare(
      "SELECT user_id, bill_due_enabled, overdue_enabled, due_days_before FROM notification_preferences",
    )
    .all<{
      user_id: string;
      bill_due_enabled: number;
      overdue_enabled: number;
      due_days_before: number;
    }>();
  const allPrefs = prefs.results || [];

  const userPrefs = await db
    .prepare("SELECT user_id, reminder_config FROM user_preferences")
    .all<{ user_id: string; reminder_config: string }>();
  const reminderConfigMap = new Map<string, string>();
  for (const row of userPrefs.results || []) {
    reminderConfigMap.set(row.user_id, row.reminder_config);
  }

  if (!allPrefs.length || !allBills.length) {
    console.log("[cron] No preferences or no bills. Done.");
    return;
  }

  // 3. Get all push subscriptions (Web Push & iOS device tokens)
  const subs = await db
    .prepare("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions")
    .all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>();
  const subscriptions = subs.results || [];

  const iosTokens = await db
    .prepare("SELECT id, user_id, token FROM device_tokens WHERE platform = 'ios'")
    .all<{ id: string; user_id: string; token: string }>();
  const iosDevices = iosTokens.results || [];

  if (!subscriptions.length && !iosDevices.length) {
    console.log("[cron] No push subscriptions or iOS devices.");
    return;
  }

  // 4. Process each user
  let sentCount = 0;
  for (const pref of allPrefs) {
    const userId = pref.user_id;
    const userSubs = subscriptions.filter((s) => s.user_id === userId);
    const userDevices = iosDevices.filter((d) => d.user_id === userId);
    if (!userSubs.length && !userDevices.length) continue;

    for (const bill of allBills) {
      // Skip bills not belonging to this user
      if (bill.created_by !== userId) continue;
      if (bill.status === "paid") continue;

      const dueDate = new Date(bill.due_date);
      const todayDate = new Date(today);
      const daysUntil = Math.ceil(
        (dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      let title: string | null = null;
      let body: string | null = null;
      const notificationKey = `bill:${bill.id}:${today}`;

      // 若为合并账户且有多张 active 卡，文案升级为合并账单口径
      const accInfo = bill.account_id ? accountCardsMap[bill.account_id] : null;
      const isMultiCardMerged = Boolean(
        bill.account_statement_mode === "merged" && accInfo && accInfo.count > 1,
      );

      const bankPrefix = bill.bank_name || "";
      let cardSubject: string;
      if (isMultiCardMerged && accInfo) {
        cardSubject = `${bankPrefix}合并账单（含尾号 ${accInfo.firstTail} 等 ${accInfo.count} 张卡）`;
      } else {
        const cardName = bill.name_override || bill.card_name || "";
        cardSubject = `${bankPrefix} ${cardName}`.trim();
      }

      if (daysUntil < 0 && pref.overdue_enabled === 1) {
        title = `已逾期：${cardSubject}`;
        body = `${cardSubject}账单 ¥${bill.bill_amount} 已逾期 ${Math.abs(daysUntil)} 天`;
      } else if (
        daysUntil >= 0 &&
        daysUntil <= pref.due_days_before &&
        pref.bill_due_enabled === 1
      ) {
        if (daysUntil === 0) {
          title = `今天到期：${cardSubject}`;
          body = `${cardSubject}账单 ¥${bill.bill_amount} 今天到期`;
        } else {
          title = `${daysUntil}天后还款：${cardSubject}`;
          body = `${cardSubject}账单 ¥${bill.bill_amount} ${daysUntil}天后到期`;
        }
      }

      if (!title || !body) continue;

      // 5. Check dedup
      const existing = await db
        .prepare("SELECT id FROM notification_history WHERE user_id = ? AND notification_key = ?")
        .bind(userId, notificationKey)
        .first();
      if (existing) continue;

      // 6. Send push notification
      try {
        const canSendWebPush = isUserWebPushEnabled(reminderConfigMap.get(userId));
        if (userSubs.length > 0 && canSendWebPush) {
          const { staleIds } = await sendPushToSubscriptions(env, userSubs, title, body);
          // Drop subscriptions the push service reports as gone (404/410).
          for (const id of staleIds) {
            await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id).run();
          }
        }

        // Send to iOS devices via APNs if configured
        if (userDevices.length > 0 && env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID) {
          const apnsResult = await sendApnsToUser(
            userId,
            {
              alert: { title, body },
              sound: "default",
              badge: 1,
              customData: {
                type: "bill_reminder",
                billId: bill.id,
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
          if (apnsResult.failed > 0) {
            console.warn(
              `[cron] APNs delivery failed for ${apnsResult.failed}/${apnsResult.total} devices on bill ${bill.id}`,
            );
            if (userSubs.length === 0 && apnsResult.sent === 0) {
              throw new Error(`APNs failed for all ${apnsResult.total} devices`);
            }
          }
        }

        await db
          .prepare(
            "INSERT INTO notification_history (id, user_id, notification_key, title, body, status) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(crypto.randomUUID(), userId, notificationKey, title, body, "sent")
          .run();
        sentCount++;
      } catch (err) {
        console.error(`[cron] Failed to send notification for bill ${bill.id}:`, err);
        await db
          .prepare(
            "INSERT INTO notification_history (id, user_id, notification_key, title, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            userId,
            notificationKey,
            title,
            body,
            "failed",
            err instanceof Error ? err.message : String(err),
          )
          .run();
      }
    }
  }

  console.log(`[cron] Notification scan complete. Sent ${sentCount} notifications.`);
}

async function pruneStaleMutationsAndAuthAttempts(db: D1Database): Promise<void> {
  try {
    const now = new Date().toISOString();
    // Prune stale sync mutations that have been pending for > 10 minutes without progress.
    // This clears orphaned locks from crashed Workers while preserving legitimate in-flight operations.
    await db
      .prepare(
        "DELETE FROM sync_mutations WHERE result IS NULL AND processed_at < datetime(?, '-10 minutes')",
      )
      .bind(now)
      .run();

    // 只清理已过窗的登录限流记录。sync_changes 不能按时间删除：
    // 新装或长期离线设备的 cursor 仍指向旧 seq，删行会让它们永久漏账，而
    // reconcile 只能找回客户端已知的实体，无法补回这些历史变更。
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

  const payload = JSON.stringify({ title, body, url: "/bills" });
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
        // Subscription expired or removed — let the caller clean it up.
        staleIds.push(sub.id);
      } else {
        throw err;
      }
    }
  }
  return { sent, staleIds };
}
