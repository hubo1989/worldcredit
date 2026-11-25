// lib/__tests__/sync-phase2-pull-push.test.ts — HUB-163
//
// Phase 2 sync surface: /api/sync/pull learns the 11 opportunity_* tables plus
// notification_history (composite primary keys encoded as json_array), and
// /api/sync/push accepts offline card/bill creation and the opportunity +
// notification mutations. Assertions run against the real SQLite D1 harness,
// so CHECK/FK/trigger behaviour and the 100-bind-parameter ceiling are
// exercised by the database itself.
//
// The 0038 sync triggers land with HUB-162. Until then this suite mounts an
// equivalent test-only trigger set (CREATE TRIGGER IF NOT EXISTS), which stays
// valid after 0038 merges: a duplicated sync_changes row is coalesced by the
// pull route's per-entity dedupe, so no assertion depends on trigger count.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAILS } from "../admin-emails";
import { setDb, setWorkerEnv } from "../db/client";
import { createSessionValue, type SessionUser } from "../session";
import { POST as pullHandler } from "../../app/api/sync/pull/route";
import { POST as pushHandler } from "../../app/api/sync/push/route";
import {
  FIXTURE_IDS,
  LEDGER_IDS,
  seedOpportunityFixtures,
  seedOpportunityLedgerWorld,
} from "./helpers/opportunity-fixtures";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";

interface PullChange {
  tbl: string;
  row_id: string;
  op: "upsert" | "delete";
  row?: Record<string, unknown>;
}

interface PullResponse {
  cursor: number;
  has_more: boolean;
  changes: PullChange[];
}

interface PushResult {
  id: string;
  ok: boolean;
  code?: string;
  details?: { existing_bill_id?: string };
  permanent?: boolean;
  already_processed?: boolean;
  data?: Record<string, unknown>;
}

const f = FIXTURE_IDS;
const l = LEDGER_IDS;

const ADMIN_A: SessionUser = {
  id: f.users.adminA,
  email: ADMIN_EMAILS[0],
  name: "Admin A",
  role: "admin",
  created_at: "2026-10-01T00:00:00Z",
};

const MEMBER_A: SessionUser = {
  id: f.users.memberA,
  email: "member-a@example.test",
  name: "Member A",
  role: "member",
  created_at: "2026-10-01T00:00:00Z",
};

const PHASE_2_TABLES = [
  "opportunity_definitions",
  "opportunity_rule_versions",
  "opportunity_accounts",
  "opportunity_account_cards",
  "opportunity_cycles",
  "opportunity_usages",
  "opportunity_fulfillments",
  "opportunity_tasks",
  "opportunity_task_cycles",
  "opportunity_user_states",
  "opportunity_reminder_states",
  "notification_history",
] as const;

/** Ids of the Phase 2 world seeded on top of the shared fixture. */
const IDS = {
  memberAccount: "oacc-member",
  memberCycle: "ocyc-member",
  usageDefinition: "odef-p2",
  usageVersion: "orv-p2",
  usageAccount: "oacc-p2",
  usageCycle: "ocyc-p2",
  task: "otask-self",
  taskCycle: "otc-self",
  booking: "ofl-self-booking",
  notification: "notif-self-1",
  reminderEvent: "op:cycle_expiry:oacc-self:2026-10:deadbeef",
} as const;

// ---------------------------------------------------------------------------
// Test-only stand-in for the 0038 sync triggers (HUB-162).
// ---------------------------------------------------------------------------

/** Tables whose owner is the holder named by `column`. */
const HOLDER_TABLES: ReadonlyArray<readonly [string, string]> = [
  ["opportunity_accounts", "holder_id"],
  ["opportunity_fulfillments", "holder_id"],
  ["opportunity_tasks", "holder_id"],
];

/** Tables owned through opportunity_accounts.holder_id, plus their wire row_id. */
const ACCOUNT_CHILDREN: ReadonlyArray<{
  table: string;
  column: string;
  rowId: (ref: string) => string;
}> = [
  {
    table: "opportunity_account_cards",
    column: "account_id",
    rowId: (ref) => `json_array(${ref}.account_id, ${ref}.card_id)`,
  },
  { table: "opportunity_cycles", column: "account_id", rowId: (ref) => `${ref}.id` },
  { table: "opportunity_usages", column: "account_id", rowId: (ref) => `${ref}.id` },
];

/** Tables owned through opportunity_tasks.holder_id. */
const TASK_CHILDREN: ReadonlyArray<readonly [string, string]> = [
  ["opportunity_task_cycles", "task_id"],
];

/** Composite-key tables owned by their own user_id column. */
const USER_TABLES: ReadonlyArray<readonly [string, string]> = [
  ["opportunity_user_states", "account_id"],
  ["opportunity_reminder_states", "event_key"],
];

/**
 * Fan-out owner resolution, mirroring the 0038 UNION template: managed_by,
 * created_by and auth_user_id each yield one change row (UNION collapses the
 * single-user case to one).
 */
function fanout(holderJoin: string, rowIdExpr: string): string {
  return `SELECT u.owner_id, '%TBL%', ${rowIdExpr}, '%OP%'
    FROM (SELECT ch.managed_by AS owner_id FROM card_holders ch
            WHERE ${holderJoin} AND ch.managed_by IS NOT NULL
          UNION
          SELECT ch.created_by FROM card_holders ch
            WHERE ${holderJoin} AND ch.created_by IS NOT NULL
          UNION
          SELECT ch.auth_user_id FROM card_holders ch
            WHERE ${holderJoin} AND ch.auth_user_id IS NOT NULL) u`;
}

function mountTestTriggers(db: SqliteD1): void {
  const statements: string[] = [];
  const emit = (
    table: string,
    event: "AFTER INSERT" | "AFTER UPDATE" | "AFTER DELETE",
    ownerSelect: string,
  ) => {
    const op = event === "AFTER DELETE" ? "delete" : "upsert";
    statements.push(
      `CREATE TRIGGER IF NOT EXISTS trg_test_${table}_${event.replace(" ", "_")} ${event} ON ${table} BEGIN
         INSERT INTO sync_changes (owner_id, tbl, row_id, op) ${ownerSelect
           .replaceAll("%TBL%", table)
           .replaceAll("%OP%", op)};
       END;`,
    );
  };

  for (const [table, column] of HOLDER_TABLES) {
    for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
      const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
      emit(table, event, fanout(`ch.id = ${ref}.${column}`, `${ref}.id`));
    }
  }
  for (const { table, column, rowId } of ACCOUNT_CHILDREN) {
    for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
      const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
      const join = `ch.id = (SELECT a.holder_id FROM opportunity_accounts a WHERE a.id = ${ref}.${column})`;
      emit(table, event, fanout(join, rowId(ref)));
    }
  }
  for (const [table, column] of TASK_CHILDREN) {
    for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
      const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
      const join = `ch.id = (SELECT ot.holder_id FROM opportunity_tasks ot WHERE ot.id = ${ref}.${column})`;
      emit(table, event, fanout(join, `${ref}.id`));
    }
  }
  for (const [table, second] of USER_TABLES) {
    for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
      const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
      statements.push(
        `CREATE TRIGGER IF NOT EXISTS trg_test_${table}_${event.replace(" ", "_")} ${event} ON ${table} BEGIN
           INSERT INTO sync_changes (owner_id, tbl, row_id, op)
           VALUES (${ref}.user_id, '${table}', json_array(${ref}.user_id, ${ref}.${second}),
                   '${event === "AFTER DELETE" ? "delete" : "upsert"}');
         END;`,
      );
    }
  }
  for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
    const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
    const op = event === "AFTER DELETE" ? "delete" : "upsert";
    statements.push(
      `CREATE TRIGGER IF NOT EXISTS trg_test_opportunity_definitions_${event.replace(" ", "_")} ${event} ON opportunity_definitions BEGIN
         INSERT INTO sync_changes (owner_id, tbl, row_id, op)
           SELECT NULL, 'opportunity_definitions', ${ref}.id, '${op}'
           WHERE ${ref}.visibility = 'shared';
         INSERT INTO sync_changes (owner_id, tbl, row_id, op)
           SELECT u.owner_id, 'opportunity_definitions', ${ref}.id, '${op}'
           FROM (SELECT ch.managed_by AS owner_id FROM card_holders ch
                   WHERE ch.id = ${ref}.private_holder_id AND ch.managed_by IS NOT NULL
                 UNION
                 SELECT ch.created_by FROM card_holders ch
                   WHERE ch.id = ${ref}.private_holder_id AND ch.created_by IS NOT NULL
                 UNION
                 SELECT ch.auth_user_id FROM card_holders ch
                   WHERE ch.id = ${ref}.private_holder_id AND ch.auth_user_id IS NOT NULL) u;
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_test_opportunity_rule_versions_${event.replace(" ", "_")} ${event} ON opportunity_rule_versions BEGIN
         INSERT INTO sync_changes (owner_id, tbl, row_id, op)
           SELECT NULL, 'opportunity_rule_versions', ${ref}.id, '${op}'
           WHERE EXISTS (SELECT 1 FROM opportunity_definitions d
                          WHERE d.id = ${ref}.definition_id AND d.visibility = 'shared');
         INSERT INTO sync_changes (owner_id, tbl, row_id, op)
           SELECT u.owner_id, 'opportunity_rule_versions', ${ref}.id, '${op}'
           FROM (SELECT ch.managed_by AS owner_id FROM card_holders ch
                   WHERE ch.id = (SELECT private_holder_id FROM opportunity_definitions WHERE id = ${ref}.definition_id)
                     AND ch.managed_by IS NOT NULL
                 UNION
                 SELECT ch.created_by FROM card_holders ch
                   WHERE ch.id = (SELECT private_holder_id FROM opportunity_definitions WHERE id = ${ref}.definition_id)
                     AND ch.created_by IS NOT NULL
                 UNION
                 SELECT ch.auth_user_id FROM card_holders ch
                   WHERE ch.id = (SELECT private_holder_id FROM opportunity_definitions WHERE id = ${ref}.definition_id)
                     AND ch.auth_user_id IS NOT NULL) u
           WHERE EXISTS (SELECT 1 FROM opportunity_definitions d
                          WHERE d.id = ${ref}.definition_id AND d.visibility = 'private');
       END;`,
    );
  }
  for (const event of ["AFTER INSERT", "AFTER UPDATE", "AFTER DELETE"] as const) {
    const ref = event === "AFTER DELETE" ? "OLD" : "NEW";
    statements.push(
      `CREATE TRIGGER IF NOT EXISTS trg_test_notification_history_${event.replace(" ", "_")} ${event} ON notification_history BEGIN
         INSERT INTO sync_changes (owner_id, tbl, row_id, op)
         VALUES (${ref}.user_id, 'notification_history', ${ref}.id,
                 '${event === "AFTER DELETE" ? "delete" : "upsert"}');
       END;`,
    );
  }
  db.exec(statements.join("\n"));
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Valid RuleSnapshotV1 payload, so a usage can be recorded against it. */
const USAGE_RULES_JSON = JSON.stringify({
  schema_version: 1,
  title: "贵宾厅",
  description: null,
  category: "travel",
  time_zone: "Asia/Shanghai",
  bank_id: null,
  card_product_ids: [FIXTURE_IDS.products.cmbClassic],
  valid_from: null,
  valid_until_before: null,
  open_ended: true,
  weekdays: null,
  cycle: { kind: "monthly", anchor_month: null, anchor_day: 1, anchor_source: null },
  allocation: "recurring",
  count_limit: 6,
  amount_limit_minor: null,
  currency: null,
  unit_label: "次",
  eligibility_text: null,
  requires_personal_confirmation: false,
  claim_window: null,
  booking_window: null,
  workflow_time_basis: "fixed",
  booking_consumes: "reserve_then_use",
  cancellation_rule: "confirm_with_issuer",
  entry: { website_url: null, app_name: null, app_path: null },
});

/**
 * Extends the shared fixture with a second (member-owned) account, a task
 * cycle, a booking fulfillment, a followed state, a reminder state and one
 * notification, so every Phase 2 table has at least one row to sync.
 */
function seedPhase2World(db: SqliteD1): void {
  db.exec(`
    INSERT INTO opportunity_accounts
      (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
    VALUES
      ('${IDS.memberAccount}', 'odef-shared', '${f.holders.memberSelf}', 'holder',
       'holder:${f.holders.memberSelf}', '${f.users.memberA}', '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_cycles
      (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
       period_start_on, period_end_before, usable_start_on, usable_end_before,
       time_zone, count_limit, created_at)
    VALUES
      ('${IDS.memberCycle}', '${IDS.memberAccount}', '${l.versions.shared}', '2026-10-01',
       '2026-10', 'regular', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01',
       'Asia/Shanghai', 3, '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_definitions
      (id, kind, visibility, private_holder_id, created_by, created_at)
    VALUES
      ('${IDS.usageDefinition}', 'benefit', 'shared', NULL, '${f.users.adminA}', '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_rule_versions
      (id, definition_id, version, effective_from, rules_json, verification, published_at)
    VALUES
      ('${IDS.usageVersion}', '${IDS.usageDefinition}', 1, '2026-01-01', '${USAGE_RULES_JSON}',
       'unverified', '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_accounts
      (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
    VALUES
      ('${IDS.usageAccount}', '${IDS.usageDefinition}', '${f.holders.self}', 'card',
       'card:${f.cards.selfMain}', '${f.users.adminA}', '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
    VALUES
      ('${IDS.usageAccount}', '${IDS.usageDefinition}', '${f.holders.self}', '${f.cards.selfMain}');

    INSERT INTO opportunity_cycles
      (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
       period_start_on, period_end_before, usable_start_on, usable_end_before,
       time_zone, count_limit, created_at)
    VALUES
      ('${IDS.usageCycle}', '${IDS.usageAccount}', '${IDS.usageVersion}', '2026-10-01',
       '2026-10', 'regular', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01',
       'Asia/Shanghai', 6, '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_tasks
      (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json, status,
       revision, created_by, created_at, updated_at)
    VALUES
      ('${IDS.task}', '${f.holders.self}', 'monthly_spend', '月度消费达标',
       '["${f.cards.selfMain}"]', '{"schema_version":1}', '{"schema_version":1}',
       'active', 1, '${f.users.adminA}', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_task_cycles
      (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json,
       period_start_on, period_end_before, deadline_at, revision, updated_at)
    VALUES
      ('${IDS.taskCycle}', '${IDS.task}', '2026-10', '{"schema_version":1}',
       '{"schema_version":1}', '2026-10-01', '2026-11-01', '2026-11-01T00:00:00Z', 1,
       '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_fulfillments
      (id, holder_id, kind, account_id, cycle_id, source_key, card_id, status, quantity,
       amount_minor, recorded_on, service_at, service_time_zone, entry_json,
       created_by, updated_by, created_at, updated_at)
    VALUES
      ('${IDS.booking}', '${f.holders.self}', 'booking', '${l.accounts.self}',
       '${l.cycles.self}', 'booking:${IDS.booking}', '${f.cards.selfMain}', 'recorded',
       1, 0, '2026-10-10', '2026-10-20T12:00:00Z', 'Asia/Shanghai', '{}',
       '${f.users.adminA}', '${f.users.adminA}', '2026-10-10T00:00:00Z',
       '2026-10-10T00:00:00Z');

    INSERT INTO opportunity_user_states (user_id, account_id, followed, revision, updated_at)
    VALUES ('${f.users.adminA}', '${l.accounts.self}', 1, 1, '2026-10-01T00:00:00Z');

    INSERT INTO opportunity_reminder_states
      (user_id, event_key, read_steps_json, dismissed_at, snooze_until, revision, updated_at)
    VALUES
      ('${f.users.adminA}', '${IDS.reminderEvent}', '[]', NULL, NULL, 1,
       '2026-10-01T00:00:00Z');

    INSERT INTO notification_history
      (id, user_id, notification_key, title, body, sent_at, status, category)
    VALUES
      ('${IDS.notification}', '${f.users.adminA}', 'bill:2026-10:reminder', '账单到期提醒',
       '本期应还 1000.00', '2026-10-10T00:00:00Z', 'sent', 'bill');
  `);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const tokens = new Map<string, string>();
let db: SqliteD1;

async function tokenFor(user: SessionUser): Promise<string> {
  const key = `${user.id}:${user.email}`;
  const cached = tokens.get(key);
  if (cached) return cached;
  const token = await createSessionValue(user);
  tokens.set(key, token);
  return token;
}

async function pull(body: unknown, user: SessionUser = ADMIN_A): Promise<PullResponse> {
  const response = await pullHandler(
    new Request("https://app.all-bill.com/api/sync/pull", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(user)}` },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as PullResponse;
}

async function push(
  mutations: Array<{ id: string; name: string; args: unknown[] }>,
  user: SessionUser = ADMIN_A,
  clientId = "ios-phase2-client",
): Promise<PushResult[]> {
  const response = await pushHandler(
    new Request("https://app.all-bill.com/api/sync/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(user)}` },
      body: JSON.stringify({ client_id: clientId, mutations }),
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: PushResult[] }).results;
}

const usageArgs = (requestKey: string) => [
  {
    account_id: IDS.usageAccount,
    cycle_id: IDS.usageCycle,
    card_id: f.cards.selfMain,
    used_on: "2026-10-10",
    quantity: 1,
    amount_minor: 0,
    note: null,
    request_key: requestKey,
  },
];

describe("Phase 2 /api/sync/pull", () => {
  beforeAll(() => {
    setWorkerEnv({ SESSION_SECRET: "test-sync-phase2-secret-at-least-16-chars" });
  });

  beforeEach(async () => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);
    mountTestTriggers(db);
    await seedOpportunityFixtures(db);
    await seedOpportunityLedgerWorld(db);
    seedPhase2World(db);
  });

  it("ships all 12 new tables with composite keys encoded as json_array", async () => {
    const data = await pull({ cursor: 0 });
    const shipped = new Set(data.changes.map((change) => change.tbl));
    for (const table of PHASE_2_TABLES) {
      expect(shipped, table).toContain(table);
    }

    const accountCards = data.changes.find((c) => c.tbl === "opportunity_account_cards");
    expect(accountCards?.row_id).toBe(JSON.stringify([l.accounts.self, f.cards.selfMain]));
    expect(accountCards?.op).toBe("upsert");
    expect(accountCards?.row).toMatchObject({
      account_id: l.accounts.self,
      card_id: f.cards.selfMain,
      holder_id: f.holders.self,
    });

    const userState = data.changes.find((c) => c.tbl === "opportunity_user_states");
    expect(userState?.row_id).toBe(JSON.stringify([f.users.adminA, l.accounts.self]));
    expect(userState?.row).toMatchObject({ followed: 1, revision: 1 });

    const reminder = data.changes.find((c) => c.tbl === "opportunity_reminder_states");
    expect(reminder?.row_id).toBe(JSON.stringify([f.users.adminA, IDS.reminderEvent]));
  });

  it("keeps the Phase 1 response contract for existing tables", async () => {
    const data = await pull({ cursor: 0 });
    const tables = data.changes.map((change) => change.tbl);
    for (const table of ["banks", "card_products", "card_holders", "credit_cards"]) {
      expect(tables).toContain(table);
    }
    expect(data.has_more).toBe(false);
    // Cursor still advances to the newest change, so a Phase 1 client keeps paging normally.
    expect(data.cursor).toBeGreaterThan(0);
    expect((await pull({ cursor: data.cursor })).changes).toEqual([]);
  });

  it("isolates member rows to holders bound by auth_user_id", async () => {
    const mine = await pull({ cursor: 0 }, MEMBER_A);
    const accounts = mine.changes.filter((c) => c.tbl === "opportunity_accounts");
    expect(accounts.map((c) => c.row_id).sort()).toEqual([IDS.memberAccount]);

    const cycles = mine.changes.filter((c) => c.tbl === "opportunity_cycles");
    expect(cycles.map((c) => c.row_id).sort()).toEqual([IDS.memberCycle]);

    // Another user's user-scoped state never leaks.
    expect(mine.changes.filter((c) => c.tbl === "opportunity_user_states")).toEqual([]);
    expect(mine.changes.filter((c) => c.tbl === "opportunity_reminder_states")).toEqual([]);
    expect(mine.changes.filter((c) => c.tbl === "notification_history")).toEqual([]);
  });

  it("grants admins created_by OR managed_by holders and hides other admins' private data", async () => {
    const mine = await pull({ cursor: 0 }, ADMIN_A);

    const definitions = mine.changes.filter((c) => c.tbl === "opportunity_definitions");
    expect(definitions.map((c) => c.row_id).sort()).toEqual([
      IDS.usageDefinition,
      l.definitions.shared,
    ]);

    const accounts = mine.changes.filter((c) => c.tbl === "opportunity_accounts");
    expect(accounts.map((c) => c.row_id).sort()).toEqual([IDS.usageAccount, l.accounts.self]);

    // Admin B's private definition, account, cycle and usage stay invisible.
    for (const [table, rowId] of [
      ["opportunity_rule_versions", l.versions.privateB],
      ["opportunity_accounts", l.accounts.adminB],
      ["opportunity_cycles", l.cycles.adminB],
      ["opportunity_usages", l.usages.adminB],
    ] as const) {
      expect(
        mine.changes.filter((c) => c.tbl === table && c.row_id === rowId),
        `${table}:${rowId}`,
      ).toEqual([]);
    }
  });

  it("turns a notification soft delete into a delete op", async () => {
    const first = await pull({ cursor: 0 });
    expect(
      first.changes.find((c) => c.tbl === "notification_history" && c.row_id === IDS.notification)
        ?.op,
    ).toBe("upsert");

    db.exec(
      `UPDATE notification_history SET deleted_at = '2026-10-11T00:00:00Z'
       WHERE id = '${IDS.notification}'`,
    );

    const second = await pull({ cursor: first.cursor });
    const deleted = second.changes.find(
      (c) => c.tbl === "notification_history" && c.row_id === IDS.notification,
    );
    expect(deleted).toMatchObject({ op: "delete" });
    expect(deleted?.row).toBeUndefined();
  });

  it("chunks composite-key lookups under the D1 100-parameter ceiling", async () => {
    const cardValues = Array.from(
      { length: 120 },
      (_, index) =>
        `('bulk-card-${index}','${f.holders.self}','${f.products.cmbClassic}','${String(index).padStart(4, "0")}',5000,5,'active','credit',NULL)`,
    ).join(",");
    db.exec(
      `INSERT INTO credit_cards
         (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type, loan_due_day)
       VALUES ${cardValues}`,
    );
    const linkValues = Array.from(
      { length: 120 },
      (_, index) => `('${l.accounts.self}','odef-shared','${f.holders.self}','bulk-card-${index}')`,
    ).join(",");
    db.exec(
      `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
       VALUES ${linkValues}`,
    );

    const targets = Array.from({ length: 100 }, (_, index) => ({
      tbl: "opportunity_account_cards",
      row_id: JSON.stringify([l.accounts.self, `bulk-card-${index}`]),
    }));

    const prepare = db.prepare.bind(db);
    const prepared: string[] = [];
    db.prepare = (sql) => {
      prepared.push(sql);
      return prepare(sql);
    };
    const data = await pull({ cursor: 5_000_000, reconcile: targets });
    db.prepare = prepare;

    const fetched = data.changes.filter(
      (c) => c.tbl === "opportunity_account_cards" && c.op === "upsert",
    );
    // 100 composite rows at 2 binds each + 2 owner binds -> 49 rows per chunk -> 3 chunks.
    expect(fetched).toHaveLength(100);
    expect(
      prepared.filter((sql) => sql.includes("SELECT t.* FROM opportunity_account_cards t")),
    ).toHaveLength(3);
  });

  it("rejects malformed composite keys and oversized single-column keys", async () => {
    const malformed = await pullHandler(
      new Request("https://app.all-bill.com/api/sync/pull", {
        method: "POST",
        headers: { Authorization: `Bearer ${await tokenFor(ADMIN_A)}` },
        body: JSON.stringify({
          cursor: 0,
          reconcile: [{ tbl: "opportunity_account_cards", row_id: "not-a-json-array" }],
        }),
      }),
    );
    expect(malformed.status).toBe(400);

    // A composite key may use the wider 512-char budget …
    const wideComposite = JSON.stringify(["a".repeat(200), "b".repeat(200)]);
    const accepted = await pull({
      cursor: 5_000_000,
      reconcile: [{ tbl: "opportunity_account_cards", row_id: wideComposite }],
    });
    expect(accepted.changes[0]).toMatchObject({ op: "delete" });

    // … while single-column keys stay capped at 256.
    const oversized = await pullHandler(
      new Request("https://app.all-bill.com/api/sync/pull", {
        method: "POST",
        headers: { Authorization: `Bearer ${await tokenFor(ADMIN_A)}` },
        body: JSON.stringify({
          cursor: 0,
          reconcile: [{ tbl: "opportunity_accounts", row_id: "x".repeat(257) }],
        }),
      }),
    );
    expect(oversized.status).toBe(400);
  });

  it("normalizes non-compact composite keys in reconcile before lookup", async () => {
    const nonCompact = `[ "${l.accounts.self}", "${f.cards.selfMain}" ]`;
    const data = await pull({
      cursor: 5_000_000,
      reconcile: [{ tbl: "opportunity_account_cards", row_id: nonCompact }],
    });
    expect(data.changes).toEqual([
      expect.objectContaining({
        tbl: "opportunity_account_cards",
        row_id: JSON.stringify([l.accounts.self, f.cards.selfMain]),
        op: "upsert",
      }),
    ]);
  });
});

describe("Phase 2 /api/sync/push", () => {
  beforeAll(() => {
    setWorkerEnv({ SESSION_SECRET: "test-sync-phase2-secret-at-least-16-chars" });
  });

  beforeEach(async () => {
    db = createOpportunityDb();
    setDb(db as unknown as D1Database);
    mountTestTriggers(db);
    await seedOpportunityFixtures(db);
    await seedOpportunityLedgerWorld(db);
    seedPhase2World(db);
  });

  it("creates a card under the client UUID and replays it idempotently", async () => {
    const clientId = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEFFFF0000";
    const args = [
      {
        id: clientId,
        holder_id: f.holders.self,
        card_product_id: f.products.cmbClassic,
        billing_day: 5,
      },
    ];
    const [first] = await push([{ id: "mut-card-1", name: "cards.createCard", args }]);
    expect(first).toMatchObject({ ok: true });
    const stored = db.raw
      .prepare("SELECT id FROM credit_cards WHERE holder_id = ?")
      .all(f.holders.self) as Array<{ id: string }>;
    expect(stored.map((row) => row.id)).toContain(clientId.toLowerCase());

    const [replay] = await push([{ id: "mut-card-1", name: "cards.createCard", args }]);
    expect(replay).toMatchObject({ ok: true, already_processed: true });
    // A different mutation id carrying the same client UUID must not create a second card.
    const [sibling] = await push([{ id: "mut-card-2", name: "cards.createCard", args }]);
    expect(sibling).toMatchObject({ ok: true });
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM credit_cards WHERE id = ?")
        .get(clientId.toLowerCase()),
    ).toEqual({ n: 1 });
  });

  it("reports a cross-holder client UUID collision as a permanent conflict", async () => {
    const clientId = "bbbbbbbb-cccc-4ddd-8eee-ffff00001111";
    db.exec(
      `INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day)
       VALUES ('${clientId}', '${f.holders.family}', '${f.products.cmbClassic}', 5)`,
    );
    const [result] = await push([
      {
        id: "mut-card-collide",
        name: "cards.createCard",
        args: [
          {
            id: clientId,
            holder_id: f.holders.self,
            card_product_id: f.products.cmbClassic,
            billing_day: 5,
          },
        ],
      },
    ]);
    expect(result).toMatchObject({ ok: false, permanent: true, code: "CONFLICT" });
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM credit_cards WHERE id = ?").get(clientId),
    ).toEqual({ n: 1 });
  });

  it("creates a bill under the client UUID and returns the winning bill on a same-month clash", async () => {
    db.exec(
      `INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount)
       VALUES ('bill-existing', '${f.cards.selfMain}', '2026-10', '2026-10-25', 1000)`,
    );
    const [clash] = await push([
      {
        id: "mut-bill-clash",
        name: "bills.createBill",
        args: [
          {
            id: "cccccccc-dddd-4eee-8fff-000011112222",
            card_id: f.cards.selfMain,
            bill_month: "2026-10",
            due_date: "2026-10-25",
            bill_amount: 1000,
          },
        ],
      },
    ]);
    expect(clash).toMatchObject({
      ok: false,
      permanent: true,
      code: "CONFLICT",
      details: { existing_bill_id: "bill-existing" },
    });

    const fresh = {
      id: "dddddddd-eeee-4fff-8000-111122223333",
      card_id: f.cards.selfMain,
      bill_month: "2026-11",
      due_date: "2026-11-25",
      bill_amount: 1200,
    };
    const [created] = await push([{ id: "mut-bill-1", name: "bills.createBill", args: [fresh] }]);
    expect(created).toMatchObject({ ok: true });
    const [replay] = await push([{ id: "mut-bill-1", name: "bills.createBill", args: [fresh] }]);
    expect(replay).toMatchObject({ ok: true, already_processed: true });
    const [sibling] = await push([{ id: "mut-bill-2", name: "bills.createBill", args: [fresh] }]);
    expect(sibling).toMatchObject({ ok: true });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM bills WHERE id = ?").get(fresh.id)).toEqual({
      n: 1,
    });
  });

  it("replays an opportunity usage on request_key without writing twice", async () => {
    const first = await push([
      {
        id: "mut-usage-1",
        name: "opportunities.recordOpportunityUsage",
        args: usageArgs("rk-usage-00000001"),
      },
    ]);
    expect(first[0]).toMatchObject({ ok: true });

    // Same request_key under a new mutation id: the command engine replays it.
    const sibling = await push([
      {
        id: "mut-usage-2",
        name: "opportunities.recordOpportunityUsage",
        args: usageArgs("rk-usage-00000001"),
      },
    ]);
    expect(sibling[0]).toMatchObject({ ok: true });
    // Identical mutation id: the sync receipt short-circuits it.
    const replay = await push([
      {
        id: "mut-usage-1",
        name: "opportunities.recordOpportunityUsage",
        args: usageArgs("rk-usage-00000001"),
      },
    ]);
    expect(replay[0]).toMatchObject({ ok: true, already_processed: true });

    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_usages WHERE account_id = ?")
        .get(IDS.usageAccount),
    ).toEqual({ n: 1 });
  });

  it("reflects a pushed usage in the next incremental pull", async () => {
    const start = await pull({ cursor: 0 });
    await push([
      {
        id: "mut-usage-pull",
        name: "opportunities.recordOpportunityUsage",
        args: usageArgs("rk-usage-00000002"),
      },
    ]);
    const next = await pull({ cursor: start.cursor });
    const usages = next.changes.filter((c) => c.tbl === "opportunity_usages");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ op: "upsert" });
    expect(usages[0].row).toMatchObject({
      account_id: IDS.usageAccount,
      cycle_id: IDS.usageCycle,
      quantity: 1,
      status: "active",
    });
  });

  it("treats a repeated follow without expected_revision as the same intent", async () => {
    const args = [{ account_id: l.accounts.self, followed: false }];
    const [first] = await push([
      { id: "mut-follow-1", name: "opportunities.setOpportunityFollowed", args },
    ]);
    expect(first).toMatchObject({ ok: true, data: { followed: false, revision: 2 } });

    const [second] = await push([
      { id: "mut-follow-2", name: "opportunities.setOpportunityFollowed", args },
    ]);
    expect(second).toMatchObject({ ok: true, data: { followed: false, revision: 2 } });
    expect(
      db.raw
        .prepare(
          "SELECT revision, followed FROM opportunity_user_states WHERE user_id = ? AND account_id = ?",
        )
        .get(f.users.adminA, l.accounts.self),
    ).toEqual({ revision: 2, followed: 0 });
  });

  it("treats a repeated reminder action without expected_revision as the same intent", async () => {
    const args = [{ event_key: IDS.reminderEvent, action: "dismiss" }];
    const [first] = await push([
      { id: "mut-rem-1", name: "opportunities.updateOpportunityReminderState", args },
    ]);
    expect(first).toMatchObject({ ok: true, data: { revision: 2 } });

    const [second] = await push([
      { id: "mut-rem-2", name: "opportunities.updateOpportunityReminderState", args },
    ]);
    expect(second).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(
      db.raw
        .prepare(
          "SELECT revision FROM opportunity_reminder_states WHERE user_id = ? AND event_key = ?",
        )
        .get(f.users.adminA, IDS.reminderEvent),
    ).toEqual({ revision: 2 });
  });

  it("deletes a notification idempotently and surfaces it as a delete op", async () => {
    const args = ["ignored-by-server", IDS.notification];
    const [first] = await push([
      { id: "mut-notif-1", name: "notifications.deleteNotification", args },
    ]);
    expect(first).toMatchObject({ ok: true, data: { deleted: true } });
    const [second] = await push([
      { id: "mut-notif-2", name: "notifications.deleteNotification", args },
    ]);
    expect(second).toMatchObject({ ok: true, data: { deleted: false } });

    const data = await pull({ cursor: 0 });
    expect(
      data.changes.find((c) => c.tbl === "notification_history" && c.row_id === IDS.notification),
    ).toMatchObject({ op: "delete" });
  });

  it("rejects unsafe offline payloads before any write", async () => {
    const results = await push([
      {
        id: "mut-usage-nokey",
        name: "opportunities.recordOpportunityUsage",
        args: [{ ...usageArgs("rk-unused-000000001")[0], request_key: "" }],
      },
      {
        id: "mut-usage-norev",
        name: "opportunities.voidOpportunityUsage",
        args: [{ usage_id: "ousg-self", reason: "误记", request_key: "rk-void-0001" }],
      },
      {
        id: "mut-card-noid",
        name: "cards.createCard",
        args: [
          { holder_id: f.holders.self, card_product_id: f.products.cmbClassic, billing_day: 5 },
        ],
      },
      {
        id: "mut-bill-noid",
        name: "bills.createBill",
        args: [
          {
            card_id: f.cards.selfMain,
            bill_month: "2026-11",
            due_date: "2026-11-25",
            bill_amount: 1,
          },
        ],
      },
      {
        id: "mut-rem-bad",
        name: "opportunities.updateOpportunityReminderState",
        args: [{ event_key: "not-an-event", action: "dismiss" }],
      },
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(results.every((result) => result.permanent === true)).toBe(true);
    expect(results.every((result) => result.code === "VALIDATION_FAILED")).toBe(true);
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_usages WHERE account_id = ?")
        .get(IDS.usageAccount),
    ).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_commands").get()).toEqual({
      n: 0,
    });
  });

  it("keeps non-allowlisted RPCs out of the offline surface", async () => {
    const [result] = await push([
      {
        id: "mut-disallowed",
        name: "opportunities.saveOpportunityTask",
        args: [{ holder_id: f.holders.self }],
      },
    ]);
    expect(result).toMatchObject({ ok: false, permanent: true });
  });
});
