// app/api/sync/pull/route.ts — Incremental sync with optional authoritative recovery.

import { getDb } from "@/lib/db";
import { readSession } from "@/lib/session";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_RECONCILE_TARGETS = 100;
const MAX_ROW_ID_LENGTH = 256;

// SQL identifiers and predicates come exclusively from this server-owned allowlist.
// Recheck current ownership: a historical change can outlive a holder transfer.
const SYNCABLE_TABLES = {
  banks: { pk: "id", owner: null },
  card_products: { pk: "id", owner: null },
  benefits: { pk: "id", owner: null },
  promos: { pk: "id", owner: null },
  card_holders: { pk: "id", owner: "t.managed_by = ?" },
  credit_cards: {
    pk: "id",
    owner: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ch.managed_by = ?)`,
  },
  bills: {
    pk: "id",
    owner: `EXISTS (SELECT 1 FROM credit_cards cc
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE cc.id = t.card_id AND ch.managed_by = ?)`,
  },
  payments: {
    pk: "id",
    owner: `EXISTS (SELECT 1 FROM bills b
      JOIN credit_cards cc ON cc.id = b.card_id
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE b.id = t.bill_id AND ch.managed_by = ?)`,
  },
  user_preferences: { pk: "user_id", owner: "t.user_id = ?" },
  notification_preferences: { pk: "user_id", owner: "t.user_id = ?" },
  recurring_payables: { pk: "id", owner: "t.created_by = ?" },
  recurring_payable_payments: {
    pk: "id",
    owner: `EXISTS (SELECT 1 FROM recurring_payables rp
      WHERE rp.id = t.payable_id AND rp.created_by = ?)`,
  },
} as const;

type SyncTable = keyof typeof SYNCABLE_TABLES;
interface EntityTarget {
  tbl: SyncTable;
  row_id: string;
}

interface ChangeRow {
  seq: number;
  tbl: string;
  row_id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSyncTable(value: unknown): value is SyncTable {
  return typeof value === "string" && Object.hasOwn(SYNCABLE_TABLES, value);
}

function isEntityTarget(value: unknown): value is EntityTarget {
  return (
    isRecord(value) &&
    isSyncTable(value.tbl) &&
    typeof value.row_id === "string" &&
    value.row_id.trim().length > 0 &&
    value.row_id.length <= MAX_ROW_ID_LENGTH
  );
}

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed: unknown = await request.json().catch(() => ({}));
  const body = isRecord(parsed) ? parsed : {};
  const reconcile = body.reconcile === undefined ? [] : body.reconcile;
  if (
    !Array.isArray(reconcile) ||
    reconcile.length > MAX_RECONCILE_TARGETS ||
    !reconcile.every(isEntityTarget)
  ) {
    return Response.json(
      { error: "reconcile 必须是最多 100 个合法的 {tbl,row_id} 实体" },
      { status: 400 },
    );
  }

  // 分页参数必须是整数：REAL 绑定到 LIMIT 会让 has_more 永远 false，静默断页。
  const rawCursor = body.cursor === undefined ? 0 : Number(body.cursor);
  const rawLimit = body.limit === undefined ? DEFAULT_LIMIT : Number(body.limit);
  if (
    !Number.isInteger(rawCursor) ||
    rawCursor < 0 ||
    !Number.isInteger(rawLimit) ||
    rawLimit < 1
  ) {
    return Response.json({ error: "cursor/limit 必须是合法整数" }, { status: 400 });
  }
  const cursor = rawCursor;
  const limit = Math.min(MAX_LIMIT, rawLimit);
  const db = getDb();
  const rawChanges = await db
    .prepare(
      `SELECT seq, tbl, row_id FROM sync_changes
       WHERE (owner_id = ? OR owner_id IS NULL) AND seq > ?
       ORDER BY seq ASC LIMIT ?`,
    )
    .bind(session.id, cursor, limit + 1)
    .all<ChangeRow>();

  const fetched = rawChanges.results || [];
  // 多取一条判定 has_more：剩余恰好等于 limit 时不再多做一次空拉取。
  const hasMore = fetched.length > limit;
  const rows = hasMore ? fetched.slice(0, limit) : fetched;
  const maxSeq = rows.length ? rows[rows.length - 1].seq : cursor;
  const entities = new Map<string, EntityTarget>();
  for (const change of rows) {
    if (isSyncTable(change.tbl)) {
      entities.set(`${change.tbl}:${change.row_id}`, { tbl: change.tbl, row_id: change.row_id });
    } else {
      console.warn(`[sync/pull] Ignoring change for unmapped table: ${change.tbl}`);
    }
  }
  for (const target of reconcile) {
    entities.set(`${target.tbl}:${target.row_id}`, { tbl: target.tbl, row_id: target.row_id });
  }

  const targetsByTable = new Map<SyncTable, string[]>();
  for (const target of entities.values()) {
    const ids = targetsByTable.get(target.tbl) ?? [];
    ids.push(target.row_id);
    targetsByTable.set(target.tbl, ids);
  }
  const rowsByKey = new Map<string, Record<string, unknown>>();
  const batchMeta: Array<{ tbl: SyncTable; pk: string }> = [];
  const batchStatements: D1PreparedStatement[] = [];
  for (const [tbl, ids] of targetsByTable) {
    const { pk, owner } = SYNCABLE_TABLES[tbl];
    // D1 accepts at most 100 bound parameters; owner predicates reserve one slot.
    const chunkSize = owner ? 99 : 100;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      batchMeta.push({ tbl, pk });
      batchStatements.push(
        db
          .prepare(
            `SELECT t.* FROM ${tbl} t WHERE t.${pk} IN (${placeholders})${owner ? ` AND ${owner}` : ""}`,
          )
          .bind(...chunk, ...(owner ? [session.id] : [])),
      );
    }
  }
  if (batchStatements.length > 0) {
    const batchResults = await db.batch<Record<string, unknown>>(batchStatements);
    for (let i = 0; i < batchResults.length; i++) {
      const { tbl, pk } = batchMeta[i];
      for (const row of batchResults[i].results ?? []) {
        rowsByKey.set(`${tbl}:${String(row[pk])}`, row);
      }
    }
  }

  const changes = Array.from(entities.values(), (target) => {
    const row = rowsByKey.get(`${target.tbl}:${target.row_id}`);
    return row ? { ...target, op: "upsert" as const, row } : { ...target, op: "delete" as const };
  });

  return Response.json({
    cursor: maxSeq,
    has_more: hasMore,
    changes,
    server_time: new Date().toISOString(),
  });
}
