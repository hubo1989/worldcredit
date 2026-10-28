// lib/api/gmail.server.ts — Gmail 连接管理与手动同步（server only）。
import { queryOne, execute } from "../db/helpers";
import { getWorkerEnv } from "../db/client";
import { syncUserGmail, type GmailSyncSummary } from "../gmail/sync.server";

export interface GmailConnectionStatus {
  connected: boolean;
  email: string | null;
  status: "active" | "error" | "revoked" | null;
  last_sync_at: string | null;
  last_sync_summary: string | null;
  last_error: string | null;
}

export async function getGmailConnection(userId?: string): Promise<GmailConnectionStatus> {
  if (!userId) {
    return {
      connected: false,
      email: null,
      status: null,
      last_sync_at: null,
      last_sync_summary: null,
      last_error: null,
    };
  }
  const { data } = await queryOne<{
    email: string;
    status: string;
    last_sync_at: string | null;
    last_sync_summary: string | null;
    last_error: string | null;
  }>(
    "SELECT email, status, last_sync_at, last_sync_summary, last_error FROM gmail_connections WHERE user_id = ?",
    [userId],
  );
  if (!data) {
    return {
      connected: false,
      email: null,
      status: null,
      last_sync_at: null,
      last_sync_summary: null,
      last_error: null,
    };
  }
  return {
    connected: data.status === "active",
    email: data.email,
    status: data.status as GmailConnectionStatus["status"],
    last_sync_at: data.last_sync_at,
    last_sync_summary: data.last_sync_summary,
    last_error: data.last_error,
  };
}

export async function syncGmailNow(
  userId?: string,
  opts?: { maxMessages?: number },
): Promise<GmailSyncSummary> {
  if (!userId) throw new Error("未登录，无法同步 Gmail");
  return syncUserGmail(userId, opts);
}

/**
 * 断开连接：删 token、删 R2 原文副本。gmail_sync_messages 与账单/草稿是
 * 业务数据，保留（审计与既成账单不受「断开邮箱」影响）。
 */
export async function disconnectGmail(userId?: string): Promise<{ ok: true }> {
  if (!userId) return { ok: true };
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined;
  if (bucket) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix: `gmail-raw/${userId}/`, cursor });
      for (const obj of listed.objects) await bucket.delete(obj.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  await execute("DELETE FROM gmail_connections WHERE user_id = ?", [userId]);
  await execute("UPDATE gmail_sync_messages SET raw_r2_key = NULL WHERE user_id = ?", [userId]);
  return { ok: true };
}
