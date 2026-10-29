// lib/gmail/sync.server.ts — Gmail 拉取 → 解析 → 落账单/停草稿（server only）。
//
// 路由口径与 email-worker 完全一致（共用 lib/email-core）：
//   字段齐 + 持卡人命中 + 卡命中/可建 → upsertBillForCard 直接合并落账单
//   其余（认不出人、卡对不上、字段缺）→ parkBillAsDraft 预填草稿，账单页手改
// 每个 Gmail message 必写 gmail_sync_messages 一行做去重与审计。

import { getDb, getWorkerEnv } from "../db/client";
import { query, queryOne, execute } from "../db/helpers";
import {
  loadAiConfig,
  parseBillWithAI,
  parseRawMessage,
  loadHolderScope,
  resolveHolder,
  extractHeaderDisplayName,
  extractNameFromBody,
  findOrCreateCardForHolder,
  upsertBillForCard,
  parkBillAsDraft,
  syncBillingDayFromBill,
  type BillParseResult,
} from "../email-core";
import { decryptToken } from "./token-crypto";
import { refreshAccessToken, listMessageRefs, getRawMessage, type GmailClientOptions } from "./api";

export interface GmailSyncSummary {
  scanned: number;
  written: number;
  drafted: number;
  skipped: number;
  failed: number;
  /**
   * 本次匹配到、但还没处理的邮件数（分批闸门截断的部分）。
   * 客户端循环调用直到 remaining === 0；cron 不设限，恒为 0。
   */
  remaining: number;
  errors: string[];
}

export interface SyncUserGmailOptions {
  /** 单次调用最多处理的新邮件数；省略 = 不设限（cron 全量跑）。 */
  maxMessages?: number;
}

/** 预筛查询：宁可多拉几封让 AI 用 email_kind 门禁过滤，也不要漏账单。 */
const DEFAULT_QUERY =
  'newer_than:30d (账单 OR 对账单 OR 月结单 OR statement OR "payment due" OR "e-statement")';

interface SyncDeps {
  parse: (text: string) => Promise<BillParseResult>;
  fetchImpl?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  sessionSecret?: string;
  bucket?: R2Bucket | null;
}

let depsOverride: SyncDeps | null = null;
/** 仅测试用：注入 AI 解析、fetch 与 R2。 */
export function __setGmailSyncDeps(deps: SyncDeps | null) {
  depsOverride = deps;
}

function resolveSecret(override?: string): string {
  if (override) return override;
  const env = getWorkerEnv() as { SESSION_SECRET?: string };
  return (
    env.SESSION_SECRET ??
    (typeof process !== "undefined" ? (process.env?.SESSION_SECRET ?? "") : "")
  );
}

/** parseRawMessage 不单独留 message-id，这里从原始字节头部取，用于审计对账。 */
function extractRfcMessageId(raw: Uint8Array): string | null {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(raw.subarray(0, 2048));
  const m = head.match(/^message-id:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

export async function syncUserGmail(
  userId: string,
  opts?: SyncUserGmailOptions,
): Promise<GmailSyncSummary> {
  const summary: GmailSyncSummary = {
    scanned: 0,
    written: 0,
    drafted: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    errors: [],
  };
  const db = getDb();

  const conn = await queryOne<{ user_id: string; refresh_token_enc: string }>(
    "SELECT user_id, refresh_token_enc FROM gmail_connections WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  if (conn.error) throw new Error(conn.error.message);
  if (!conn.data) throw new Error("未连接 Gmail 或连接已停用");

  const deps: SyncDeps = depsOverride ?? {
    parse: async (text) => parseBillWithAI(await loadAiConfig(db), text),
  };
  const secret = resolveSecret(deps.sessionSecret);
  const env = getWorkerEnv() as {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    ATTACHMENTS?: R2Bucket;
  };
  const clientOpts: GmailClientOptions = {
    fetchImpl: deps.fetchImpl,
    clientId: deps.clientId ?? env.GOOGLE_CLIENT_ID ?? process.env?.GOOGLE_CLIENT_ID,
    clientSecret:
      deps.clientSecret ?? env.GOOGLE_CLIENT_SECRET ?? process.env?.GOOGLE_CLIENT_SECRET,
  };

  const refreshToken = await decryptToken(conn.data.refresh_token_enc, secret);
  const tokens = await refreshAccessToken(refreshToken, clientOpts);
  await execute(
    "UPDATE gmail_connections SET access_token_expires_at = ?, updated_at = datetime('now') WHERE user_id = ?",
    [new Date(Date.now() + tokens.expiresIn * 1000).toISOString(), userId],
  );

  const { refs } = await listMessageRefs(tokens.accessToken, DEFAULT_QUERY, clientOpts);
  summary.scanned = refs.length;

  // 分批闸门：每封邮件都要过一遍 LLM 解析（实测 5–15s/封），一次性处理
  // 几十封会跑几分钟，超过 Cloudflare ~100s 代理超时——客户端先收到 524
  // 报「同步失败」，worker 却还在后台推进（2026-10-28 首次回填实测 9 分钟）。
  // 所以手动同步必须分轮：每轮 maxMessages 封，客户端看 remaining 续拉。
  const maxMessages = opts?.maxMessages;
  let alreadySeen = 0;
  let processed = 0;

  for (const ref of refs) {
    // failed 不算「已处理」：子请求超限这类瞬态错误不该永久挡住重试，
    // 只有 bill_written/draft_parked/skipped 才走去重跳过。
    const seen = await queryOne(
      "SELECT gmail_message_id FROM gmail_sync_messages WHERE gmail_message_id = ? AND status != 'failed'",
      [ref.id],
    );
    if (seen.data) {
      alreadySeen++;
      continue;
    }
    // continue 而不是 break：把剩余量数完，remaining 才准
    if (maxMessages !== undefined && processed >= maxMessages) continue;

    try {
      const raw = await getRawMessage(tokens.accessToken, ref.id, clientOpts);
      const parsedTop = parseRawMessage(raw);
      const r2Key = `gmail-raw/${userId}/${ref.id}.eml`;
      const bucket = deps.bucket !== undefined ? deps.bucket : (env.ATTACHMENTS ?? null);
      if (bucket) await bucket.put(r2Key, raw as unknown as ArrayBuffer);

      const aiResult = await deps.parse(parsedTop.text);
      const outcome = await routeParsedMessage({ db, userId, top: parsedTop, aiResult });

      // gmail_message_id 是主键：重试命中旧 failed 行时用 upsert 原地覆盖，
      // 而不是让主键冲突把整封邮件再打成 failed。
      await execute(
        `INSERT INTO gmail_sync_messages
           (gmail_message_id, user_id, thread_id, rfc_message_id, from_email, subject, internal_date,
            raw_r2_key, status, bill_id, draft_id, parse_confidence, error_msg)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(gmail_message_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           rfc_message_id = excluded.rfc_message_id,
           from_email = excluded.from_email,
           subject = excluded.subject,
           internal_date = excluded.internal_date,
           raw_r2_key = excluded.raw_r2_key,
           status = excluded.status,
           bill_id = excluded.bill_id,
           draft_id = excluded.draft_id,
           parse_confidence = excluded.parse_confidence,
           error_msg = excluded.error_msg`,
        [
          ref.id,
          userId,
          ref.threadId,
          extractRfcMessageId(raw),
          parsedTop.headers.from ?? null,
          parsedTop.headers.subject ?? null,
          parsedTop.headers.date ?? null,
          r2Key,
          outcome.status,
          outcome.billId ?? null,
          outcome.draftId ?? null,
          typeof aiResult.confidence === "number" ? aiResult.confidence : null,
          outcome.reason ?? null,
        ],
      );
      if (outcome.status === "bill_written") summary.written++;
      else if (outcome.status === "draft_parked") summary.drafted++;
      else if (outcome.status === "skipped") summary.skipped++;
      else summary.failed++;
      processed++;
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${ref.id}: ${msg}`);
      await execute(
        "INSERT INTO gmail_sync_messages (gmail_message_id, user_id, status, error_msg) VALUES (?,?, 'failed', ?) ON CONFLICT(gmail_message_id) DO UPDATE SET status = 'failed', error_msg = excluded.error_msg",
        [ref.id, userId, msg],
      );
      processed++;
    }
  }

  summary.remaining = refs.length - alreadySeen - processed;

  const summaryText = `扫描 ${summary.scanned}｜落账单 ${summary.written}｜草稿 ${summary.drafted}｜跳过 ${summary.skipped}｜失败 ${summary.failed}`;
  await execute(
    "UPDATE gmail_connections SET last_sync_at = datetime('now'), last_sync_summary = ?, last_error = ?, updated_at = datetime('now') WHERE user_id = ?",
    [summaryText, summary.errors[0] ?? null, userId],
  );
  return summary;
}

interface RouteOutcome {
  status: "bill_written" | "draft_parked" | "skipped" | "failed";
  billId?: string | null;
  draftId?: string | null;
  reason?: string | null;
}

/**
 * 与 email-worker/src/index.ts 同款路由：
 *   email_kind 非 statement、字段缺 → skipped
 *   认得出人且（卡命中或可信可建卡）→ upsertBillForCard
 *   其余一切「解析出了账单但自动落不下去」→ 预填草稿
 */
async function routeParsedMessage(params: {
  db: D1Database;
  userId: string;
  top: ReturnType<typeof parseRawMessage>;
  aiResult: BillParseResult;
}): Promise<RouteOutcome> {
  const { db, userId, top, aiResult } = params;

  if (aiResult.email_kind && aiResult.email_kind !== "statement") {
    return { status: "skipped", reason: `非账单邮件（email_kind=${aiResult.email_kind}）` };
  }
  const zeroBill = Number(aiResult.bill_amount) === 0;
  if (
    aiResult.is_bill === false ||
    !aiResult.bill_month ||
    aiResult.bill_amount == null ||
    Number.isNaN(Number(aiResult.bill_amount)) ||
    (!zeroBill && !aiResult.due_date)
  ) {
    return { status: "skipped", reason: "Not a bill email or missing required fields" };
  }

  const scope = await loadHolderScope(db, userId);
  const toHeader = top.headers.to ?? "";
  const resolution = resolveHolder({
    holders: scope.holders,
    defaultHolderId: scope.defaultHolderId,
    headerName: extractHeaderDisplayName(toHeader),
    bodyName: extractNameFromBody(top.text),
  });
  const trusted = resolution.source === "header_name" || resolution.source === "body_honorific";

  const prefill = { ...aiResult, raw_text: top.text.slice(0, 2000) };

  if (!resolution.holderId) {
    const draftId = await parkBillAsDraft(db, userId, prefill);
    return { status: "draft_parked", draftId, reason: "未找到持卡人，预填草稿待人工确认" };
  }

  const created = await findOrCreateCardForHolder(db, {
    holderId: resolution.holderId,
    cardTail: aiResult.card_last4 ?? null,
    bankName: aiResult.bank_name ?? null,
    currency: aiResult.currency ?? null,
    statementDate: aiResult.statement_date ?? null,
    statementDay: aiResult.statement_day ?? null,
    dueDate: aiResult.due_date ?? null,
    receivedDate: top.headers.date ?? null,
    allowCreate: trusted,
  });
  if (!created.ok) {
    const draftId = await parkBillAsDraft(db, userId, prefill);
    return { status: "draft_parked", draftId, reason: `${created.reason}｜草稿已预填` };
  }

  const outcome = await upsertBillForCard(db, created.cardId, aiResult, { trusted });
  await syncBillingDayFromBill(db, created.cardId, aiResult);
  return {
    status: "bill_written",
    billId: outcome.billId,
    reason: outcome.action === "preserved" ? outcome.reason : null,
  };
}

/** cron 用：同步全部 active 连接，单用户失败不影响其他用户。 */
export async function syncAllGmailConnections(): Promise<{ users: number; failures: number }> {
  const rows = await query<{ user_id: string }>(
    "SELECT user_id FROM gmail_connections WHERE status = 'active'",
  );
  let failures = 0;
  for (const row of rows.data ?? []) {
    try {
      await syncUserGmail(row.user_id);
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      await execute(
        "UPDATE gmail_connections SET status = 'error', last_error = ?, updated_at = datetime('now') WHERE user_id = ?",
        [msg.slice(0, 300), row.user_id],
      );
    }
  }
  return { users: rows.data?.length ?? 0, failures };
}
