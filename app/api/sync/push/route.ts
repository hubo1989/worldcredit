// app/api/sync/push/route.ts — Offline mutation push endpoint.

import { getDb } from "@/lib/db";
import { readSession } from "@/lib/session";
import { dispatchRpc } from "@/lib/api/rpc-dispatch";

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
  permanent?: boolean;
  already_processed?: boolean;
}

const MAX_MUTATIONS = 100;
const MAX_ID_LENGTH = 256;
/** Only offline mutations with row-level or key-level idempotency may use sync/push. */
const OFFLINE_SYNC_MUTATIONS = new Set([
  "bills.recordPayment",
  "bills.setBillAmountOverride",
  "cards.updateCard",
]);
const inFlightByMutation = new Map<string, Promise<MutationResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSavedResult(raw: string, id: string): MutationResult {
  try {
    const parsed = JSON.parse(raw) as MutationResult;
    if (isRecord(parsed) && typeof parsed.ok === "boolean") {
      return { ...parsed, id, already_processed: true };
    }
  } catch {
    // Fall through to retryable error so corrupted state is never reported as success.
  }
  return { id, ok: false, error: "已缓存的同步结果无效，请稍后重试", permanent: false };
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

    const claim = await db
      .prepare(
        "INSERT INTO sync_mutations (user_id, client_id, mutation_id, result) VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING",
      )
      .bind(session.id, clientId, mut.id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) {
      const existing = await db
        .prepare(
          "SELECT result FROM sync_mutations WHERE user_id = ? AND client_id = ? AND mutation_id = ?",
        )
        .bind(session.id, clientId, mut.id)
        .first<{ result: string | null }>();
      if (existing?.result) {
        results.push(parseSavedResult(existing.result, mut.id));
      } else {
        results.push({
          id: mut.id,
          ok: false,
          error: "同步操作正在处理中，请稍后重试",
          permanent: false,
        });
      }
      continue;
    }

    const module = mut.name.slice(0, dot);
    const fn = mut.name.slice(dot + 1);
    const execution = (async (): Promise<MutationResult> => {
      try {
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
