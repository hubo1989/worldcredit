// Gmail polling uses the same statement ingestion and posting rules as Email Routing.
import { getDb, getWorkerEnv } from "../db/client";
import { ingestStatementEmail, parseRawMessage, type BillParseResult } from "../email-core";
import { decryptToken } from "./token-crypto";
import { GmailApiError, refreshAccessToken, listMessageRefs, getRawMessage, type GmailClientOptions } from "./api";

export interface GmailSyncSummary {
  scanned: number;
  written: number;
  drafted: number;
  skipped: number;
  failed: number;
  remaining: number;
  errors: string[];
}

export interface SyncUserGmailOptions {
  /** When omitted, use the oldest enabled connection for legacy API callers. */
  connectionId?: string;
  maxMessages?: number;
}

const DEFAULT_QUERY =
  'newer_than:30d (账单 OR 对账单 OR 月结单 OR statement OR "payment due" OR "e-statement")';
const LEASE_MINUTES = 15;

interface SyncDeps {
  parse: (text: string) => Promise<BillParseResult>;
  fetchImpl?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  sessionSecret?: string;
  bucket?: R2Bucket | null;
}

interface GmailConnection {
  id: string;
  user_id: string;
  email: string;
  display_label: string | null;
  default_holder_id: string | null;
  attribution_mode: "auto_then_default" | "force_default_unless_conflict";
  refresh_token_enc: string;
}

let depsOverride: SyncDeps | null = null;
/** Inject external dependencies for tests without changing the production parser. */
export function __setGmailSyncDeps(deps: SyncDeps | null) {
  depsOverride = deps;
}

function extractRfcMessageId(raw: Uint8Array): string | null {
  const header = new TextDecoder().decode(raw.subarray(0, 64 * 1024)).split(/\r?\n\r?\n/, 1)[0];
  const unfolded = header.replace(/\r?\n[ \t]+/g, " ");
  const id = /^message-id:[ \t]*<?([^<>\s]+)>?/im.exec(unfolded)?.[1];
  return id && id.length <= 998 ? id.toLowerCase() : null;
}

const activeLease = "(error_msg LIKE 'lease:%' AND substr(error_msg, 7, 19) > datetime('now'))";

/** D1 takes the claim in a single statement, including across mailboxes and isolates. */
async function claimMessage(
  db: D1Database, conn: GmailConnection, gmailId: string, rfcId: string | null,
): Promise<string | null> {
  const clock = await db.prepare("SELECT 'lease:' || datetime('now', ?) || ':' || ? AS token")
    .bind(`+${LEASE_MINUTES} minutes`, crypto.randomUUID()).first<{ token: string }>();
  const lease = clock?.token;
  if (!lease) throw new Error("无法建立邮件处理租约");
  const claim = await db.prepare(
    `INSERT INTO gmail_sync_messages (connection_id, gmail_message_id, user_id, rfc_message_id, status, error_msg)
     SELECT ?, ?, ?, ?, 'failed', ?
     WHERE EXISTS (SELECT 1 FROM gmail_connections WHERE id = ? AND status = 'active' AND sync_enabled = 1)
       AND (? IS NULL OR NOT EXISTS (
         SELECT 1 FROM gmail_sync_messages WHERE user_id = ? AND rfc_message_id = ?
           AND (status != 'failed' OR ${activeLease})
       ))
     ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
       connection_id = excluded.connection_id, rfc_message_id = excluded.rfc_message_id, error_msg = excluded.error_msg
     WHERE gmail_sync_messages.status = 'failed' AND NOT COALESCE(${activeLease}, 0)`,
  ).bind(conn.id, gmailId, conn.user_id, rfcId, lease, conn.id, rfcId, conn.user_id, rfcId).run();
  return claim.meta.changes ? lease : null;
}

async function rememberDuplicate(
  db: D1Database, conn: GmailConnection, gmailId: string, rfcId: string,
): Promise<boolean> {
  const duplicate = await db.prepare(
    `INSERT INTO gmail_sync_messages (connection_id, gmail_message_id, user_id, rfc_message_id, status)
     SELECT ?, ?, ?, ?, 'skipped'
     WHERE EXISTS (SELECT 1 FROM gmail_connections WHERE id = ?)
       AND EXISTS (SELECT 1 FROM gmail_sync_messages WHERE user_id = ? AND rfc_message_id = ? AND status != 'failed')
     ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET status = 'skipped', error_msg = NULL,
       connection_id = excluded.connection_id, rfc_message_id = excluded.rfc_message_id
     WHERE gmail_sync_messages.status = 'failed' AND NOT COALESCE(${activeLease}, 0)`,
  ).bind(conn.id, gmailId, conn.user_id, rfcId, conn.id, conn.user_id, rfcId).run();
  return duplicate.meta.changes > 0;
}

export async function syncUserGmail(
  userId: string, opts?: SyncUserGmailOptions,
): Promise<GmailSyncSummary> {
  const db = getDb();
  const conn = await db.prepare(
    `SELECT id, user_id, email, display_label, default_holder_id, attribution_mode, refresh_token_enc
     FROM gmail_connections WHERE user_id = ? AND status = 'active' AND sync_enabled = 1 AND (? IS NULL OR id = ?)
     ORDER BY created_at, id LIMIT 1`,
  ).bind(userId, opts?.connectionId ?? null, opts?.connectionId ?? null).first<GmailConnection>();
  if (!conn) throw new Error("未连接 Gmail 或连接已停用");
  return syncConnection(db, conn, opts?.maxMessages);
}

async function syncConnection(db: D1Database, conn: GmailConnection, maxMessages?: number): Promise<GmailSyncSummary> {
  const summary: GmailSyncSummary = { scanned: 0, written: 0, drafted: 0, skipped: 0, failed: 0, remaining: 0, errors: [] };
  const env = getWorkerEnv() as {
    SESSION_SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; ATTACHMENTS?: R2Bucket;
    IMAGES?: ImagesBinding;
  };
  const deps = depsOverride;
  const secret = deps?.sessionSecret ?? env.SESSION_SECRET ?? process.env.SESSION_SECRET ?? "";
  const store = deps?.bucket !== undefined ? deps.bucket : env.ATTACHMENTS;
  const client: GmailClientOptions = {
    fetchImpl: deps?.fetchImpl,
    clientId: deps?.clientId ?? env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
    clientSecret: deps?.clientSecret ?? env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
  };
  let refreshToken: string;
  try {
    refreshToken = await decryptToken(conn.refresh_token_enc, secret);
  } catch {
    throw new Error("无法读取 Gmail 授权凭据，请重试");
  }
  const access = await refreshAccessToken(refreshToken, client);
  if (!access.accessToken || !Number.isFinite(access.expiresIn) || access.expiresIn <= 0) {
    throw new Error("Gmail 返回了无效的授权响应");
  }
  await db.prepare(
    "UPDATE gmail_connections SET access_token_expires_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
  ).bind(new Date(Date.now() + access.expiresIn * 1000).toISOString(), conn.id, conn.user_id).run();

  let processed = 0;
  let pageToken: string | undefined;
  const visitedTokens = new Set<string>();
  do {
    const { refs, nextPageToken } = await listMessageRefs(access.accessToken, DEFAULT_QUERY, { ...client, pageToken });
    const ids = [...new Set(refs.map(ref => ref.id))];
    const seen = ids.length ? await db.prepare(
      `SELECT gmail_message_id FROM gmail_sync_messages WHERE user_id = ? AND status != 'failed'
       AND gmail_message_id IN (${ids.map(() => "?").join(",")})`,
    ).bind(conn.user_id, ...ids).all<{ gmail_message_id: string }>() : null;
    const terminal = new Set(seen?.results.map(row => row.gmail_message_id));
    for (const ref of refs) {
      summary.scanned++;
      if (terminal.has(ref.id)) continue;
      if (maxMessages !== undefined && processed >= maxMessages) {
        summary.remaining++;
        continue;
      }
      let lease: string | null = null;
      try {
        const raw = await getRawMessage(access.accessToken, ref.id, client);
        const rfcId = extractRfcMessageId(raw);
        lease = await claimMessage(db, conn, ref.id, rfcId);
        if (!lease) {
          if (rfcId && await rememberDuplicate(db, conn, ref.id, rfcId)) summary.skipped++;
          // A concurrent delivery can still be in flight. A later run may retry it.
          terminal.add(ref.id);
          continue;
        }
        const top = parseRawMessage(raw);
        const rawKey = store ? `gmail-raw/${conn.user_id}/${conn.id}/${encodeURIComponent(ref.id)}.eml` : null;
        if (store && rawKey) await store.put(rawKey, raw as Uint8Array<ArrayBuffer>);
        const outcome = await ingestStatementEmail({
          db, userId: conn.user_id, top, bucket: store, secret, imagesBinding: env.IMAGES,
          deliveryId: rfcId ? `rfc:${rfcId}` : `gmail:${conn.id}:${ref.id}`,
          connection: {
            id: conn.id, email: conn.email, label: conn.display_label, defaultHolderId: conn.default_holder_id,
            attributionMode: conn.attribution_mode,
          },
          parseText: deps?.parse,
        });
        const status = outcome.billIds.length ? "bill_written" : outcome.draftIds.length ? "draft_parked" : "skipped";
        await db.prepare(
          `UPDATE gmail_sync_messages SET thread_id = ?, from_email = ?, subject = ?, internal_date = ?,
            raw_r2_key = ?, status = ?, bill_id = ?, draft_id = ?, parse_confidence = ?, error_msg = ?
           WHERE user_id = ? AND gmail_message_id = ? AND error_msg = ?`,
        ).bind(ref.threadId, top.headers.from, top.headers.subject, top.headers.date, rawKey, status,
          outcome.billIds[0] ?? null, outcome.draftIds[0] ?? null, outcome.confidence, outcome.reason,
          conn.user_id, ref.id, lease).run();
        summary.written += outcome.billIds.length;
        summary.drafted += outcome.draftIds.length;
        if (status === "skipped") summary.skipped++;
        terminal.add(ref.id);
      } catch (error) {
        const message = deps ? String(error).slice(0, 300) : "邮件获取或入库失败，可重试";
        summary.failed++;
        summary.errors.push(`${ref.id}: ${message}`);
        if (lease) {
          await db.prepare("UPDATE gmail_sync_messages SET error_msg = ? WHERE user_id = ? AND gmail_message_id = ? AND error_msg = ?")
            .bind(message, conn.user_id, ref.id, lease).run();
        } else {
          await db.prepare(
            `INSERT INTO gmail_sync_messages (connection_id, gmail_message_id, user_id, status, error_msg)
             SELECT ?, ?, ?, 'failed', ? WHERE EXISTS (SELECT 1 FROM gmail_connections WHERE id = ?)
             ON CONFLICT(user_id, gmail_message_id) DO NOTHING`,
          ).bind(conn.id, ref.id, conn.user_id, message, conn.id).run();
        }
      }
      processed++;
    }
    if (nextPageToken && visitedTokens.has(nextPageToken)) throw new Error("Gmail 返回重复分页标记");
    if (nextPageToken) visitedTokens.add(nextPageToken);
    pageToken = nextPageToken ?? undefined;
  } while (pageToken);

  const summaryText = `扫描 ${summary.scanned}｜落账单 ${summary.written}｜草稿 ${summary.drafted}｜跳过 ${summary.skipped}｜失败 ${summary.failed}`;
  await db.prepare(
    `UPDATE gmail_connections SET last_sync_at = datetime('now'), last_sync_summary = ?,
      last_error = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(summaryText, summary.errors[0] ?? null, conn.id, conn.user_id).run();
  return summary;
}

/** Iterate enabled connections with a bounded per-mailbox batch. */
export async function syncAllGmailConnections(): Promise<{ users: number; failures: number }> {
  const db = getDb();
  const users = new Set<string>();
  let failures = 0;
  let cursor = "";
  for (;;) {
    const page = await db.prepare(
      `SELECT id, user_id, email, display_label, default_holder_id, attribution_mode, refresh_token_enc
       FROM gmail_connections WHERE status = 'active' AND sync_enabled = 1 AND id > ? ORDER BY id LIMIT 25`,
    ).bind(cursor).all<GmailConnection>();
    if (!page.results.length) break;
    for (const conn of page.results) {
      cursor = conn.id;
      users.add(conn.user_id);
      try {
        await syncConnection(db, conn, 20);
      } catch (error) {
        failures++;
        const needsReauthorization = error instanceof GmailApiError && (error.invalidGrant || error.status === 401);
        const message = error instanceof GmailApiError ? error.message : "Gmail 同步失败，可重试";
        await db.prepare(
          `UPDATE gmail_connections SET status = ?, last_error = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ? AND status = 'active' AND refresh_token_enc = ?`,
        ).bind(needsReauthorization ? "error" : "active", message, conn.id, conn.user_id, conn.refresh_token_enc).run();
      }
    }
  }
  return { users: users.size, failures };
}
