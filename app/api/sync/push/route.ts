// app/api/sync/push/route.ts — Offline mutation push endpoint.

import { getDb } from "@/lib/db";
import { readSession } from "@/lib/session";
import { dispatchRpc } from "@/lib/api/rpc-dispatch";
import { isValidUuid, parseIsoTimestampMs } from "@/lib/validation-patterns";

interface MutationItem {
  id: string;
  name: string; // e.g. "bills.recordPayment"
  args: unknown[];
}

interface MutationResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  details?: unknown;
  permanent?: boolean;
  already_processed?: boolean;
}

const MAX_MUTATIONS = 100;
const MAX_ID_LENGTH = 256;
const MAX_REQUEST_KEY_LENGTH = 128;
/** Only offline mutations with row-level or key-level idempotency may use sync/push. */
const OFFLINE_SYNC_MUTATIONS = new Set([
  "bills.recordPayment",
  "bills.setBillAmountOverride",
  "bills.updateBillFields",
  "bills.clearOverride",
  "cards.updateCard",
  // Phase 2 (HUB-163): offline create + opportunity/notification replay.
  "cards.createCard",
  "bills.createBill",
  "bills.supplementMissingBill",
  "payments.updatePayment",
  "payables.createRecurringPayable",
  "payables.updateRecurringPayable",
  "notifications.markNotificationRead",
  "notifications.markAllNotificationsRead",
  "notifications.deleteNotification",
  "preferences.updateUserPreferences",
  "opportunities.recordOpportunityUsage",
  "opportunities.correctOpportunityUsage",
  "opportunities.voidOpportunityUsage",
  "opportunities.recordOpportunityClaim",
  "opportunities.voidOpportunityClaim",
  "opportunities.recordOpportunityBooking",
  "opportunities.completeOpportunityBooking",
  "opportunities.cancelOpportunityBooking",
  "opportunities.updateManualTaskProgress",
  "opportunities.recordTaskRewardReceived",
  "opportunities.setOpportunityFollowed",
  "opportunities.updateOpportunityReminderState",
]);

/** Ledger writes whose `opportunity_commands(actor, request_key)` row is the replay anchor. */
const REQUEST_KEY_MUTATIONS = new Set([
  "opportunities.recordOpportunityUsage",
  "opportunities.correctOpportunityUsage",
  "opportunities.voidOpportunityUsage",
  "opportunities.recordOpportunityClaim",
  "opportunities.voidOpportunityClaim",
  "opportunities.recordOpportunityBooking",
  "opportunities.completeOpportunityBooking",
  "opportunities.cancelOpportunityBooking",
  "opportunities.updateManualTaskProgress",
  "opportunities.recordTaskRewardReceived",
]);

/** Ledger writes that additionally compare-and-swap on `expected_revision`. */
const REVISION_MUTATIONS = new Set([
  "opportunities.correctOpportunityUsage",
  "opportunities.voidOpportunityUsage",
  "opportunities.voidOpportunityClaim",
  "opportunities.completeOpportunityBooking",
  "opportunities.cancelOpportunityBooking",
  "opportunities.updateManualTaskProgress",
]);

const REMINDER_ACTIONS = new Set(["read", "dismiss", "snooze", "restore"]);

const inFlightByMutation = new Map<string, Promise<MutationResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateOfflineReplaySafety(mut: MutationItem): { error: string; code: string } | null {
  if (mut.name === "payables.createRecurringPayable") {
    const payload = mut.args[0];
    if (!isRecord(payload) || !isValidUuid(payload.id)) {
      return {
        error: "离线创建固定支出必须提供合法的客户端 UUID id",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "cards.createCard") {
    const payload = mut.args[0];
    if (!isRecord(payload) || !isValidUuid(payload.id)) {
      return {
        error: "离线建卡必须提供合法的客户端 UUID id",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "bills.createBill") {
    const payload = mut.args[0];
    if (!isRecord(payload) || !isValidUuid(payload.id)) {
      return {
        error: "离线建账单必须提供合法的客户端 UUID id",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "bills.supplementMissingBill") {
    const payload = mut.args[0];
    if (!isRecord(payload) || !isValidUuid(payload.id)) {
      return {
        error: "离线补录账单必须提供合法的客户端 UUID id",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "opportunities.setOpportunityFollowed") {
    const payload = mut.args[0];
    if (
      !isRecord(payload) ||
      typeof payload.account_id !== "string" ||
      !payload.account_id.trim()
    ) {
      return {
        error: "离线关注状态必须提供合法的 account_id",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "opportunities.updateOpportunityReminderState") {
    const payload = mut.args[0];
    if (
      !isRecord(payload) ||
      typeof payload.event_key !== "string" ||
      !payload.event_key.startsWith("op:") ||
      typeof payload.action !== "string" ||
      !REMINDER_ACTIONS.has(payload.action)
    ) {
      return {
        error: "离线提醒状态必须提供合法的 event_key 与 action",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "notifications.deleteNotification") {
    const notificationId = mut.args[1];
    if (typeof notificationId !== "string" || !notificationId.trim()) {
      return {
        error: "离线删除通知必须提供合法的通知 ID",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (REQUEST_KEY_MUTATIONS.has(mut.name)) {
    const payload = mut.args[0];
    if (
      !isRecord(payload) ||
      typeof payload.request_key !== "string" ||
      !payload.request_key.trim() ||
      payload.request_key.length > MAX_REQUEST_KEY_LENGTH
    ) {
      return {
        error: "离线权益变更必须提供合法的 request_key（1–128 字符）",
        code: "VALIDATION_FAILED",
      };
    }
    if (
      REVISION_MUTATIONS.has(mut.name) &&
      (!Number.isInteger(payload.expected_revision) || (payload.expected_revision as number) < 1)
    ) {
      return {
        error: "离线权益变更必须提供正整数 expected_revision",
        code: "VALIDATION_FAILED",
      };
    }
  } else if (mut.name === "notifications.markAllNotificationsRead") {
    if (parseIsoTimestampMs(mut.args[1]) === null) {
      return {
        error: "离线全部标记已读必须提供合法的截止时间戳 (beforeIso)",
        code: "VALIDATION_FAILED",
      };
    }
  }
  return null;
}

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed: unknown = await request.json().catch(() => ({}));
  const body = isRecord(parsed) ? parsed : {};
  const clientId = body.client_id;
  const mutations = body.mutations;

  if (typeof clientId !== "string" || !clientId.trim() || clientId.length > MAX_ID_LENGTH) {
    return Response.json({ error: "缺少合法的 client_id" }, { status: 400 });
  }
  if (!Array.isArray(mutations) || mutations.length > MAX_MUTATIONS) {
    return Response.json({ error: "缺少合法的 mutations 数组" }, { status: 400 });
  }

  const db = getDb();
  const results: MutationResult[] = [];

  for (const rawMut of mutations) {
    if (
      !isRecord(rawMut) ||
      typeof rawMut.id !== "string" ||
      !rawMut.id.trim() ||
      rawMut.id.length > MAX_ID_LENGTH ||
      typeof rawMut.name !== "string" ||
      !rawMut.name.trim() ||
      !Array.isArray(rawMut.args)
    ) {
      results.push({
        id: isRecord(rawMut) && typeof rawMut.id === "string" && rawMut.id ? rawMut.id : "unknown",
        ok: false,
        error: "不合法的 mutation 格式",
        permanent: true,
      });
      continue;
    }
    const mut: MutationItem = { id: rawMut.id, name: rawMut.name, args: rawMut.args };
    const dot = mut.name.indexOf(".");
    if (dot <= 0 || dot === mut.name.length - 1 || !OFFLINE_SYNC_MUTATIONS.has(mut.name)) {
      results.push({
        id: mut.id,
        ok: false,
        error: `不支持的离线同步调用: ${mut.name}`,
        permanent: true,
      });
      continue;
    }

    const key = `${session.id}:${clientId}:${mut.id}`;
    const running = inFlightByMutation.get(key);
    if (running) {
      results.push({ ...(await running), already_processed: true });
      continue;
    }

    // Try to claim the mutation atomically. If conflict, either it's being processed by this instance,
    // or another instance completed/fell behind with a stale lock. We allow re-claiming after 5 minutes.
    const now = Math.floor(Date.now() / 1000);
    const staleThreshold = now - 5 * 60;
    const claim = await db
      .prepare(
        "INSERT INTO sync_mutations (user_id, client_id, mutation_id, result) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id, client_id, mutation_id) DO NOTHING",
      )
      .bind(session.id, clientId, mut.id)
      .run();

    let claimSuccess = false;

    if ((claim.meta?.changes ?? 0) > 0) {
      claimSuccess = true;
    } else {
      // Conflict: check if existing result is available (completed) or still pending but not stale
      const check = await db
        .prepare(
          "SELECT result, processed_at FROM sync_mutations WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
        )
        .bind(session.id, clientId, mut.id)
        .first<{ result: string | null; processed_at: string }>();

      if (check?.result) {
        // Already completed: return the stored result immediately, marked as replayed.
        try {
          const parsed = JSON.parse(check.result) as MutationResult;
          if (typeof parsed?.ok === "boolean") {
            results.push({ ...parsed, id: mut.id, already_processed: true });
          } else {
            throw new Error("corrupt result");
          }
        } catch {
          // 损坏回执删除后按未处理重放：白名单内 mutation 均幂等，
          // 不删行会让后续所有重试永久命中坏数据（死循环）。
          await db
            .prepare(
              "DELETE FROM sync_mutations WHERE user_id = ? AND client_id = ? AND mutation_id = ? AND result IS NOT NULL",
            )
            .bind(session.id, clientId, mut.id)
            .run();
          results.push({
            id: mut.id,
            ok: false,
            error: "缓存结果损坏，已重置，请重试",
            permanent: false,
          });
        }
        continue;
      }

      // Still pending (NULL result) or row concurrently deleted: check staleness.
      // A missing row reads as epoch 0 — always stale — so the reclaim path re-inserts it.
      const processedAt = new Date(check?.processed_at ?? "1970-01-01T00:00:00Z").getTime() / 1000;
      if (processedAt < staleThreshold) {
        // Stale lock: reclaim ownership and proceed
        try {
          await db
            .prepare(
              "UPDATE sync_mutations SET result = NULL WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
            )
            .bind(session.id, clientId, mut.id)
            .run();
          // Verify we successfully reclaimed
          const verifyClaim = await db
            .prepare(
              "INSERT INTO sync_mutations (user_id, client_id, mutation_id, result) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id, client_id, mutation_id) DO NOTHING",
            )
            .bind(session.id, clientId, mut.id)
            .run();
          if (verifyClaim.meta?.changes === 1) claimSuccess = true;
        } catch {
          // Cleanup failed -> refuse to avoid corruption
          results.push({
            id: mut.id,
            ok: false,
            error: "清理锁失败，请稍后重试",
            permanent: false,
          });
          continue;
        }
      } else {
        // Not stale yet: wait for original request or fail gracefully
        results.push({
          id: mut.id,
          ok: false,
          error: "同步操作正在处理中，请稍后重试",
          permanent: false,
        });
        continue;
      }
    }

    if (!claimSuccess) {
      // Should not reach here, but just in case
      results.push({ id: mut.id, ok: false, error: "未知错误，请稍后重试", permanent: false });
      continue;
    }

    const module = mut.name.slice(0, dot);
    const fn = mut.name.slice(dot + 1);
    const execution = (async (): Promise<MutationResult> => {
      try {
        const safetyError = validateOfflineReplaySafety(mut);
        if (safetyError) {
          const invalidResult: MutationResult = {
            id: mut.id,
            ok: false,
            error: safetyError.error,
            code: safetyError.code,
            permanent: true,
          };
          await db
            .prepare(
              "UPDATE sync_mutations SET result = ? WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
            )
            .bind(JSON.stringify(invalidResult), session.id, clientId, mut.id)
            .run();
          return invalidResult;
        }
        const dispatchRes = await dispatchRpc(module, fn, mut.args, session);
        if (dispatchRes.ok) {
          const successResult: MutationResult = { id: mut.id, ok: true, data: dispatchRes.data };
          await db
            .prepare(
              "UPDATE sync_mutations SET result = ? WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
            )
            .bind(JSON.stringify(successResult), session.id, clientId, mut.id)
            .run();
          return successResult;
        }
        const isPermanent = dispatchRes.status < 500;
        const failureResult: MutationResult = {
          id: mut.id,
          ok: false,
          error: dispatchRes.error,
          code: dispatchRes.code,
          details: dispatchRes.details,
          permanent: isPermanent,
        };
        if (isPermanent) {
          await db
            .prepare(
              "UPDATE sync_mutations SET result = ? WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
            )
            .bind(JSON.stringify(failureResult), session.id, clientId, mut.id)
            .run();
        } else {
          await db
            .prepare(
              "DELETE FROM sync_mutations WHERE user_id = ? AND client_id = ? AND mutation_id = ? AND result IS NULL",
            )
            .bind(session.id, clientId, mut.id)
            .run();
        }
        return failureResult;
      } catch (err) {
        await db
          .prepare(
            "DELETE FROM sync_mutations WHERE user_id = ? AND client_id = ? AND mutation_id = ? AND result IS NULL",
          )
          .bind(session.id, clientId, mut.id)
          .run();
        throw err;
      } finally {
        inFlightByMutation.delete(key);
      }
    })();
    inFlightByMutation.set(key, execution);
    results.push(await execution);
  }

  return Response.json({ results });
}
