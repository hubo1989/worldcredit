// app/api/sync/pull/route.ts — Incremental sync with optional authoritative recovery.

import { getDb } from "@/lib/db";
import { readSession, type SessionUser } from "@/lib/session";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_RECONCILE_TARGETS = 100;
/** Single-column keys stay on the historical 256-char wire budget. */
const MAX_ROW_ID_LENGTH = 256;
/** Composite keys travel as `json_array(c1, c2)`, so they need the wider budget. */
const MAX_COMPOSITE_ROW_ID_LENGTH = 512;
/** D1 rejects any statement binding more than 100 parameters. */
const D1_MAX_BIND_PARAMS = 100;

// SQL identifiers and predicates come exclusively from this server-owned allowlist.
// Recheck current ownership: a historical change can outlive a holder transfer.
// Phase 1 tables keep their historical `managed_by` predicate untouched so the
// wire contract is byte-compatible; the Phase 2 opportunity tables resolve a
// role-aware scope (admin: created_by OR managed_by, member: auth_user_id) that
// matches lib/opportunities/scope.server.ts.
type OwnerPredicate = { sql: string; binds: unknown[] };
type OwnerResolver = (session: SessionUser, scope: OwnerPredicate) => OwnerPredicate;

/** `ch` is the card_holders alias every holder-scoped Phase 2 predicate joins on. */
function holderScope(session: SessionUser): OwnerPredicate {
  return session.role === "admin"
    ? { sql: "(ch.created_by = ? OR ch.managed_by = ?)", binds: [session.id, session.id] }
    : { sql: "ch.auth_user_id = ?", binds: [session.id] };
}

const SYNCABLE_TABLES = {
  banks: { pk: "id", owner: null },
  card_products: { pk: "id", owner: null },
  benefits: { pk: "id", owner: null },
  promos: { pk: "id", owner: null },
  card_holders: {
    pk: "id",
    owner: (session) => ({ sql: "t.managed_by = ?", binds: [session.id] }),
  },
  credit_accounts: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  credit_cards: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  bills: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM credit_cards cc
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE cc.id = t.card_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  bill_card_subtotals: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM bills b
      JOIN credit_cards cc ON cc.id = b.card_id
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE b.id = t.bill_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  payments: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM bills b
      JOIN credit_cards cc ON cc.id = b.card_id
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE b.id = t.bill_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  user_preferences: {
    pk: "user_id",
    owner: (session) => ({ sql: "t.user_id = ?", binds: [session.id] }),
  },
  notification_preferences: {
    pk: "user_id",
    owner: (session) => ({ sql: "t.user_id = ?", binds: [session.id] }),
  },
  recurring_payables: {
    pk: "id",
    owner: (session) => ({ sql: "t.created_by = ?", binds: [session.id] }),
  },
  recurring_payable_payments: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM recurring_payables rp
      WHERE rp.id = t.payable_id AND rp.created_by = ?)`,
      binds: [session.id],
    }),
  },
  payable_custom_categories: {
    pk: "id",
    owner: (session) => ({ sql: "t.user_id = ?", binds: [session.id] }),
  },
  // --- Direction 3: bill items, installments & merchant category rules (HUB-169) ---
  bill_items: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM bills b
      JOIN credit_cards cc ON cc.id = b.card_id
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE b.id = t.bill_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  installment_plans: {
    pk: "id",
    owner: (session) => ({
      sql: `EXISTS (SELECT 1 FROM credit_cards cc
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE cc.id = t.card_id AND ch.managed_by = ?)`,
      binds: [session.id],
    }),
  },
  merchant_category_rules: {
    pk: "id",
    owner: (session) => ({ sql: "t.user_id = ?", binds: [session.id] }),
  },
  // --- Phase 2: opportunity ledger + notification inbox (HUB-163) ---
  opportunity_definitions: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `(t.visibility = 'shared' OR EXISTS (SELECT 1 FROM card_holders ch
        WHERE ch.id = t.private_holder_id AND ${scope.sql}))`,
      binds: scope.binds,
    }),
  },
  opportunity_rule_versions: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM opportunity_definitions d
        WHERE d.id = t.definition_id AND (d.visibility = 'shared' OR EXISTS (
          SELECT 1 FROM card_holders ch WHERE ch.id = d.private_holder_id AND ${scope.sql})))`,
      binds: scope.binds,
    }),
  },
  opportunity_accounts: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_account_cards: {
    pk: ["account_id", "card_id"],
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_cycles: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM opportunity_accounts a
      JOIN card_holders ch ON ch.id = a.holder_id
      WHERE a.id = t.account_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_usages: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM opportunity_accounts a
      JOIN card_holders ch ON ch.id = a.holder_id
      WHERE a.id = t.account_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_fulfillments: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_tasks: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_task_cycles: {
    pk: "id",
    owner: (_session, scope) => ({
      sql: `EXISTS (SELECT 1 FROM opportunity_tasks ot
      JOIN card_holders ch ON ch.id = ot.holder_id
      WHERE ot.id = t.task_id AND ${scope.sql})`,
      binds: scope.binds,
    }),
  },
  opportunity_user_states: {
    pk: ["user_id", "account_id"],
    owner: (session, scope) => ({
      sql: `t.user_id = ? AND EXISTS (SELECT 1 FROM opportunity_accounts a
      JOIN card_holders ch ON ch.id = a.holder_id
      WHERE a.id = t.account_id AND ${scope.sql})`,
      binds: [session.id, ...scope.binds],
    }),
  },
  opportunity_reminder_states: {
    pk: ["user_id", "event_key"],
    owner: (session) => ({ sql: "t.user_id = ?", binds: [session.id] }),
  },
  notification_history: {
    pk: "id",
    // Soft-deleted rows resolve to zero rows, which the caller turns into a
    // `delete` op — that is how a soft delete reaches the client at all.
    owner: (session) => ({
      sql: "t.user_id = ? AND t.deleted_at IS NULL",
      binds: [session.id],
    }),
  },
} satisfies Record<string, { pk: string | readonly [string, string]; owner: OwnerResolver | null }>;

type SyncTable = keyof typeof SYNCABLE_TABLES;

function pkColumns(tbl: SyncTable): readonly [string] | readonly [string, string] {
  const { pk } = SYNCABLE_TABLES[tbl];
  return Array.isArray(pk) ? (pk as readonly [string, string]) : [pk as string];
}

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

/** Composite keys arrive as SQLite `json_array(c1, c2)` text. */
function parseCompositeRowId(value: string): [string, string] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [first, second] = parsed;
  return typeof first === "string" && typeof second === "string" ? [first, second] : null;
}

function isValidRowId(tbl: SyncTable, rowId: unknown): rowId is string {
  const composite = Array.isArray(SYNCABLE_TABLES[tbl].pk);
  const budget = composite ? MAX_COMPOSITE_ROW_ID_LENGTH : MAX_ROW_ID_LENGTH;
  if (typeof rowId !== "string" || rowId.length === 0 || rowId.length > budget) {
    return false;
  }
  return composite ? parseCompositeRowId(rowId) !== null : rowId.trim().length > 0;
}

function isEntityTarget(value: unknown): value is EntityTarget {
  return isRecord(value) && isSyncTable(value.tbl) && isValidRowId(value.tbl, value.row_id);
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
    if (!isSyncTable(change.tbl)) {
      console.warn(`[sync/pull] Ignoring change for unmapped table: ${change.tbl}`);
      continue;
    }
    // A malformed composite key cannot be loaded or deleted safely; skipping it
    // keeps the cursor moving instead of failing the whole page.
    if (!isValidRowId(change.tbl, change.row_id)) {
      console.warn(`[sync/pull] Ignoring change with malformed row_id: ${change.tbl}`);
      continue;
    }
    entities.set(`${change.tbl}:${change.row_id}`, { tbl: change.tbl, row_id: change.row_id });
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
  const batchMeta: Array<{ tbl: SyncTable; pk: readonly string[] }> = [];
  const batchStatements: D1PreparedStatement[] = [];
  const scope = holderScope(session);
  for (const [tbl, ids] of targetsByTable) {
    const pkCols = pkColumns(tbl);
    const owner = SYNCABLE_TABLES[tbl].owner;
    const ownerClause = owner ? owner(session, scope) : null;
    const ownerBinds = ownerClause?.binds ?? [];
    const colsPerRow = pkCols.length;
    // ownerBinds reserve slots on every chunk; the remainder is split across rows.
    const chunkSize = Math.max(
      1,
      Math.floor((D1_MAX_BIND_PARAMS - ownerBinds.length) / colsPerRow),
    );
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      if (colsPerRow === 1) {
        const placeholders = chunk.map(() => "?").join(",");
        batchMeta.push({ tbl, pk: pkCols });
        batchStatements.push(
          db
            .prepare(
              `SELECT t.* FROM ${tbl} t WHERE t.${pkCols[0]} IN (${placeholders})${ownerClause ? ` AND ${ownerClause.sql}` : ""}`,
            )
            .bind(...chunk, ...ownerBinds),
        );
        continue;
      }
      // Row-value tuples `(c1, c2) IN ((?, ?), …)` keep the composite primary
      // key usable by the index instead of falling back to a full scan.
      const tuples = chunk.map((id) => parseCompositeRowId(id) as [string, string]);
      const placeholders = tuples.map(() => "(?,?)").join(",");
      const rowValue = pkCols.map((col) => `t.${col}`).join(",");
      batchMeta.push({ tbl, pk: pkCols });
      batchStatements.push(
        db
          .prepare(
            `SELECT t.* FROM ${tbl} t WHERE (${rowValue}) IN (${placeholders})${ownerClause ? ` AND ${ownerClause.sql}` : ""}`,
          )
          .bind(...tuples.flat(), ...ownerBinds),
      );
    }
  }
  if (batchStatements.length > 0) {
    const batchResults = await db.batch<Record<string, unknown>>(batchStatements);
    for (let i = 0; i < batchResults.length; i++) {
      const { tbl, pk } = batchMeta[i];
      for (const row of batchResults[i].results ?? []) {
        const key =
          pk.length === 1 ? String(row[pk[0]]) : JSON.stringify(pk.map((col) => row[col]));
        rowsByKey.set(`${tbl}:${key}`, row);
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
