// lib/api/gmail.server.ts — Gmail 连接管理（server only）。
//
// HUB-154 §3.3(3)：单用户单连接 → 一用户多连接（家庭多邮箱聚合）。
// 兼容红线：`getGmailConnection` 与 `GET /api/gmail/status` 的 6 字段结构一字不改
// （{ connected, email, status, last_sync_at, last_sync_summary, last_error }），
// 既有 iOS 端点契约测试保持全绿。多连接能力全部走新增的 *Connection 系列函数。
//
// 归属：所有多连接写操作都按 user_id 归属校验，非本人 connection 一律
// MemberScopeError → HTTP 403（AC-05 / AC-12）。

import { query, queryOne, execute, batch } from "../db/helpers";
import { getWorkerEnv } from "../db/client";
import { syncUserGmail, type GmailSyncSummary } from "../gmail/sync.server";
import { MemberScopeError } from "./member-scope";
import { RpcDomainError } from "./errors";
import { tableColumns } from "./schema-columns.server";

/** 单用户最多绑定的邮箱数（HUB-154 §3.3(3)）。 */
export const MAX_GMAIL_CONNECTIONS_PER_USER = 10;

export interface GmailConnectionStatus {
  connected: boolean;
  email: string | null;
  status: "active" | "error" | "revoked" | null;
  last_sync_at: string | null;
  last_sync_summary: string | null;
  last_error: string | null;
}

export interface GmailConnectionItem {
  id: string;
  email: string;
  display_label: string | null;
  default_holder_id: string | null;
  attribution_mode: "auto_then_default" | "force_default_unless_conflict";
  sync_enabled: boolean;
  status: "active" | "error" | "revoked";
  last_sync_at: string | null;
  last_sync_summary: string | null;
  last_error: string | null;
  created_at: string | null;
}

interface ConnectionRow {
  id?: string;
  user_id: string;
  email: string;
  display_label?: string | null;
  default_holder_id?: string | null;
  attribution_mode?: string | null;
  sync_enabled?: number | boolean | null;
  status: string;
  last_sync_at: string | null;
  last_sync_summary: string | null;
  last_error: string | null;
  created_at?: string | null;
}

function emptyStatus(): GmailConnectionStatus {
  return {
    connected: false,
    email: null,
    status: null,
    last_sync_at: null,
    last_sync_summary: null,
    last_error: null,
  };
}

/**
 * 兼容入口：多连接世界里取「最早创建的 active 连接」代表整体状态。
 * 返回结构严格保持 6 字段，iOS 端点契约不变。
 */
export async function getGmailConnection(userId?: string): Promise<GmailConnectionStatus> {
  if (!userId) return emptyStatus();
  const { data } = await queryOne<ConnectionRow>(
    `SELECT email, status, last_sync_at, last_sync_summary, last_error
     FROM gmail_connections WHERE user_id = ?
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
    [userId],
  );
  if (!data) return emptyStatus();
  return {
    connected: data.status === "active",
    email: data.email,
    status: data.status as GmailConnectionStatus["status"],
    last_sync_at: data.last_sync_at,
    last_sync_summary: data.last_sync_summary,
    last_error: data.last_error,
  };
}

function rowToItem(row: ConnectionRow): GmailConnectionItem {
  return {
    id: row.id || "",
    email: row.email,
    display_label: row.display_label ?? null,
    default_holder_id: row.default_holder_id ?? null,
    attribution_mode:
      row.attribution_mode === "force_default_unless_conflict"
        ? "force_default_unless_conflict"
        : "auto_then_default",
    sync_enabled: row.sync_enabled === 1 || row.sync_enabled === true,
    status: row.status as GmailConnectionItem["status"],
    last_sync_at: row.last_sync_at,
    last_sync_summary: row.last_sync_summary,
    last_error: row.last_error,
    created_at: row.created_at ?? null,
  };
}

/** 当前列出的连接（0034 之前 id 列不存在，退化为 user_id 派生，保证前端有稳定 key）。 */
export async function getGmailConnections(userId?: string): Promise<GmailConnectionItem[]> {
  if (!userId) return [];
  const columns = await tableColumns("gmail_connections");
  const idExpr = columns.has("id") ? "id" : "'gconn_' || user_id AS id";
  const optional = ["display_label", "default_holder_id", "attribution_mode", "sync_enabled"]
    .filter(name => columns.has(name))
    .join(", ");
  const { data, error } = await query<ConnectionRow>(
    `SELECT ${idExpr}, user_id, email${optional ? ", " + optional : ""},
            status, last_sync_at, last_sync_summary, last_error, created_at
     FROM gmail_connections WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  if (error) throw new Error(error.message);
  return (data || []).map(rowToItem);
}

async function loadOwnedConnection(
  connectionId: unknown,
  userId: unknown,
): Promise<GmailConnectionItem> {
  if (typeof connectionId !== "string" || !connectionId) {
    throw new RpcDomainError("VALIDATION_FAILED", "缺少邮箱连接 ID");
  }
  if (typeof userId !== "string" || !userId) throw new MemberScopeError("未登录");
  const columns = await tableColumns("gmail_connections");
  if (!columns.has("id")) {
    throw new RpcDomainError("CONFLICT", "多邮箱管理需要数据库迁移 0034，请联系管理员");
  }
  const optional = ["display_label", "default_holder_id", "attribution_mode", "sync_enabled"]
    .filter(name => columns.has(name))
    .join(", ");
  const { data, error } = await queryOne<ConnectionRow>(
    `SELECT id, user_id, email${optional ? ", " + optional : ""},
            status, last_sync_at, last_sync_summary, last_error, created_at
     FROM gmail_connections WHERE id = ?`,
    [connectionId],
  );
  if (error) throw new Error(error.message);
  // 不区分「不存在」与「不属于你」，避免用 id 枚举他人邮箱。
  if (!data || data.user_id !== userId) {
    throw new MemberScopeError("无权操作其他用户的邮箱连接");
  }
  return rowToItem(data);
}

export interface UpdateGmailConnectionPatch {
  display_label?: string | null;
  default_holder_id?: string | null;
  attribution_mode?: "auto_then_default" | "force_default_unless_conflict";
  sync_enabled?: boolean;
}

export async function updateGmailConnection(
  connectionId: string,
  patch: UpdateGmailConnectionPatch,
  userId?: string,
): Promise<GmailConnectionItem> {
  const current = await loadOwnedConnection(connectionId, userId);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new RpcDomainError("VALIDATION_FAILED", "缺少邮箱连接更新参数");
  }

  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.display_label !== undefined) {
    const label = patch.display_label?.trim() || null;
    if (label && label.length > 40) {
      throw new RpcDomainError("VALIDATION_FAILED", "邮箱备注不能超过 40 个字符");
    }
    fields.push("display_label = ?");
    params.push(label);
  }
  if (patch.default_holder_id !== undefined) {
    fields.push("default_holder_id = ?");
    params.push(patch.default_holder_id);
  }
  if (patch.attribution_mode !== undefined) {
    if (!["auto_then_default", "force_default_unless_conflict"].includes(patch.attribution_mode)) {
      throw new RpcDomainError("VALIDATION_FAILED", "归属模式不合法");
    }
    fields.push("attribution_mode = ?");
    params.push(patch.attribution_mode);
  }
  if (patch.sync_enabled !== undefined) {
    fields.push("sync_enabled = ?");
    params.push(patch.sync_enabled ? 1 : 0);
  }
  if (fields.length === 0) {
    throw new RpcDomainError("VALIDATION_FAILED", "没有需要更新的字段");
  }

  const columns = await tableColumns("gmail_connections");
  const applicable = fields.filter(field => {
    const name = field.split(" ")[0];
    return columns.has(name);
  });
  if (applicable.length === 0) {
    throw new RpcDomainError("CONFLICT", "多邮箱管理需要数据库迁移 0034，请联系管理员");
  }

  params.push(connectionId);
  const { error } = await execute(
    `UPDATE gmail_connections SET ${applicable.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    params,
  );
  if (error) throw new Error(error.message);
  void current;
  return loadOwnedConnection(connectionId, userId);
}

/**
 * 同步：传 connectionId 只同步该邮箱；省略则轮询该用户全部 active + sync_enabled 邮箱。
 * 返回各邮箱的 summary，失败项进 errors，不中断其它邮箱（AC-05）。
 */
type SyncedConnection = {
  id: string;
  email: string;
  /** 该邮箱未被选中同步（停用 / 关闭了同步开关）。 */
  skipped?: boolean;
  /** 同步失败原因；失败与「没被选中」必须可区分。 */
  error?: string;
};

export async function syncGmailConnection(
  opts?: { connectionId?: string; maxMessages?: number },
  userId?: string,
): Promise<GmailSyncSummary & { connections: SyncedConnection[] }> {
  if (!userId) throw new MemberScopeError("未登录，无法同步 Gmail");
  const merged: GmailSyncSummary & { connections: SyncedConnection[] } = {
    scanned: 0,
    written: 0,
    drafted: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    errors: [],
    connections: [],
  };

  let targets: GmailConnectionItem[];
  if (opts?.connectionId) {
    const one = await loadOwnedConnection(opts.connectionId, userId);
    targets = [one];
  } else {
    targets = (await getGmailConnections(userId)).filter(
      item => item.status === "active" && item.sync_enabled,
    );
  }

  // 没有可同步的邮箱：直接交给引擎抛它自己的「未连接 Gmail 或连接已停用」，
  // 保持 iOS 旧客户端对 400 + 中文文案的依赖不被静默改成 200。
  if (targets.length === 0) {
    const summary = await syncUserGmail(userId, { maxMessages: opts?.maxMessages });
    return { ...summary, connections: [] };
  }

  for (const target of targets) {
    if (target.status !== "active" || !target.sync_enabled) {
      merged.connections.push({ id: target.id, email: target.email, skipped: true });
      continue;
    }
    try {
      const summary = await syncUserGmail(userId, {
        maxMessages: opts?.maxMessages,
        connectionId: target.id,
      });
      merged.scanned += summary.scanned;
      merged.written += summary.written;
      merged.drafted += summary.drafted;
      merged.skipped += summary.skipped;
      merged.failed += summary.failed;
      merged.remaining += summary.remaining;
      merged.errors.push(...summary.errors);
      merged.connections.push({ id: target.id, email: target.email });
    } catch (err) {
      // 失败 ≠ 跳过：skipped 只表示「该邮箱没被选中同步」（停用/关闭开关），
      // 失败要带 error 出去，否则客户端会把同步故障当成「没有新邮件」。
      const message = err instanceof Error ? err.message : String(err);
      merged.failed++;
      merged.errors.push(`${target.email}: ${message}`);
      merged.connections.push({ id: target.id, email: target.email, error: message });
    }
  }
  return merged;
}

/** 兼容入口：同步当前用户的（首个）连接。 */
export async function syncGmailNow(
  userId?: string,
  opts?: { maxMessages?: number },
): Promise<GmailSyncSummary> {
  if (!userId) throw new Error("未登录，无法同步 Gmail");
  return syncUserGmail(userId, opts);
}

/**
 * 先暂停新同步并清理新旧 R2 键，再清引用和删除连接。保留账单与同步审计，
 * 因为删除连接会通过 ON DELETE SET NULL 解除审计行的关联。
 */
export async function disconnectGmailConnection(
  connectionId: string,
  userId?: string,
): Promise<{ ok: true; id: string }> {
  const target = await loadOwnedConnection(connectionId, userId);
  const params = [userId, connectionId];
  const { error: pauseError } = await execute(
    "UPDATE gmail_connections SET sync_enabled = 0 WHERE user_id = ? AND id = ?",
    params,
  );
  if (pauseError) throw new Error(pauseError.message);

  // The sync engine checks sync_enabled when taking a lease. Allow existing leases
  // to finish before listing objects they may still be writing.
  const { data: lease, error: leaseError } = await queryOne(
    `SELECT 1 FROM gmail_sync_messages WHERE user_id = ? AND connection_id = ?
       AND status = 'failed' AND error_msg LIKE 'lease:%'
       AND substr(error_msg, 7, 19) > datetime('now') LIMIT 1`,
    params,
  );
  if (leaseError) throw new Error(leaseError.message);
  if (lease) throw new RpcDomainError("CONFLICT", "邮箱正在同步，请稍后重试解绑");

  const userPrefix = `gmail-raw/${userId}/`;
  const connectionPrefix = `${userPrefix}${connectionId}/`;
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined;
  let lastKey = "";
  for (;;) {
    const { data: keys, error } = await query<{ raw_r2_key: string }>(
      `SELECT DISTINCT raw_r2_key FROM gmail_sync_messages
       WHERE user_id = ? AND connection_id = ? AND raw_r2_key > ?
       ORDER BY raw_r2_key LIMIT 100`,
      [...params, lastKey],
    );
    if (error) throw new Error(error.message);
    if (!keys?.length) break;
    if (!bucket) throw new Error("附件存储暂不可用，请稍后重试解绑");
    for (const { raw_r2_key: key } of keys) {
      // Old keys have a single segment after the user prefix. A connection
      // may only delete its own directory or one of these legacy keys.
      if (key.startsWith(connectionPrefix) ||
          (key.startsWith(userPrefix) && !key.slice(userPrefix.length).includes("/"))) {
        await bucket.delete(key);
      }
      lastKey = key;
    }
  }

  if (bucket) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix: connectionPrefix, cursor });
      for (const obj of listed.objects) await bucket.delete(obj.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  const { error } = await batch([
    {
      sql: "UPDATE gmail_sync_messages SET raw_r2_key = NULL WHERE user_id = ? AND connection_id = ?",
      params,
    },
    { sql: "DELETE FROM gmail_connections WHERE user_id = ? AND id = ?", params },
  ]);
  if (error) throw new Error(error.message);
  return { ok: true, id: target.id };
}

/**
 * 兼容入口：断开当前用户的全部连接（旧行为，Web/iOS 既有按钮仍在用）。
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

/** 连接数闸门：超过上限直接拒绝，避免把家庭邮箱配成无底洞。 */
export async function assertGmailConnectionCapacity(userId: string): Promise<void> {
  const { data } = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM gmail_connections WHERE user_id = ?",
    [userId],
  );
  if (Number(data?.n ?? 0) >= MAX_GMAIL_CONNECTIONS_PER_USER) {
    throw new RpcDomainError(
      "CONFLICT",
      `每个用户最多绑定 ${MAX_GMAIL_CONNECTIONS_PER_USER} 个邮箱`,
    );
  }
}

/**
 * 连接建立后补写持卡人映射与备注。
 * 放在这里而不是 lib/gmail/connect.server.ts：后者属于 HUB-155 的文件边界，
 * 且 0034 之前这两列不存在，必须按列存在性动态更新。
 */
export async function applyGmailConnectionDefaults(
  userId: string,
  params: { defaultHolderId?: string | null; displayLabel?: string | null },
): Promise<void> {
  if (!params?.defaultHolderId && !params?.displayLabel) return;
  const columns = await tableColumns("gmail_connections");
  const fields: string[] = [];
  const values: unknown[] = [];
  if (params.defaultHolderId && columns.has("default_holder_id")) {
    fields.push("default_holder_id = ?");
    values.push(params.defaultHolderId);
  }
  if (params.displayLabel && columns.has("display_label")) {
    fields.push("display_label = ?");
    values.push(params.displayLabel.trim().slice(0, 40));
  }
  if (fields.length === 0) return;
  values.push(userId);
  await execute(
    `UPDATE gmail_connections SET ${fields.join(", ")} WHERE user_id = ?`,
    values,
  );
}
