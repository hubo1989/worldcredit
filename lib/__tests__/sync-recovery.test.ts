import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as pullHandler } from "../../app/api/sync/pull/route";
import { setDb, setWorkerEnv } from "../db/client";
import { createSessionValue } from "../session";
import {
  createOpportunityDb,
  createSqliteD1,
  SQLITE_D1_MIGRATIONS_DIR,
  type SqliteD1,
} from "./helpers/sqlite-d1";

interface SyncChange {
  tbl: string;
  row_id: string;
  op: "upsert" | "delete";
  row?: Record<string, unknown>;
}
interface PullResponse {
  cursor: number;
  has_more: boolean;
  changes: SyncChange[];
  server_time: string;
}

const TABLES = [
  "banks",
  "card_products",
  "benefits",
  "promos",
  "card_holders",
  "credit_cards",
  "bills",
  "payments",
  "user_preferences",
  "notification_preferences",
  "recurring_payables",
  "recurring_payable_payments",
];
const dbs: SqliteD1[] = [];
const tokens = new Map<string, string>();

beforeAll(() => {
  setWorkerEnv({ SESSION_SECRET: "test-sync-recovery-secret-at-least-16-chars" });
});
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function database(legacy = false) {
  const db = legacy ? createSqliteD1() : createOpportunityDb();
  dbs.push(db);
  if (legacy) {
    for (const file of readdirSync(SQLITE_D1_MIGRATIONS_DIR).sort()) {
      if (file.endsWith(".sql") && file < "0019") {
        db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, file), "utf8"));
      }
    }
  }
  setDb(db as unknown as D1Database);
  return db;
}

function migration(db: SqliteD1, filename: string) {
  db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, filename), "utf8"));
}

function seed(db: SqliteD1) {
  db.exec(`
    INSERT INTO users (id,email,password_hash) VALUES
      ('owner-a','owner-a@example.test','hash'), ('owner-b','owner-b@example.test','hash');
    INSERT INTO banks (id,name) VALUES ('bank','测试银行');
    INSERT INTO card_products (id,bank_id,bank_name,card_name)
      VALUES ('product','bank','测试银行','测试卡');
    INSERT INTO benefits (id,card_product_id,name) VALUES ('benefit','product','测试权益');
    INSERT INTO promos (id,card_product_id,bank_id,bank_name,title)
      VALUES ('promo','product','bank','测试银行','测试优惠');
  `);
  for (const owner of ["a", "b"]) {
    db.exec(`
      INSERT INTO card_holders (id,created_by,managed_by,name)
        VALUES ('holder-${owner}','owner-${owner}','owner-${owner}','用户${owner}');
      INSERT INTO credit_cards (id,holder_id,card_product_id,billing_day)
        VALUES ('card-${owner}','holder-${owner}','product',5);
      INSERT INTO bills (id,card_id,bill_month,due_date,bill_amount)
        VALUES ('bill-${owner}','card-${owner}','2026-10','2026-10-25',1000);
      INSERT INTO payments (id,bill_id,amount,idempotency_key)
        VALUES ('payment-${owner}','bill-${owner}',100,'payment-key-${owner}');
      INSERT INTO user_preferences (id,user_id) VALUES ('prefs-${owner}','owner-${owner}');
      INSERT INTO notification_preferences (user_id) VALUES ('owner-${owner}');
      INSERT INTO recurring_payables (id,created_by,name,amount,due_day,holder_id)
        VALUES ('payable-${owner}','owner-${owner}','房租',2000,10,'holder-${owner}');
      INSERT INTO recurring_payable_payments (id,payable_id,period,amount,paid_at)
        VALUES ('recurring-payment-${owner}','payable-${owner}','2026-10',2000,'2026-10-10');
    `);
  }
}

async function pull(body: unknown, user = "owner-a") {
  let token = tokens.get(user);
  if (!token) {
    token = await createSessionValue({
      id: user,
      email: `${user}@example.test`,
      name: user,
      role: "admin",
      created_at: "2026-10-01T00:00:00Z",
    });
    tokens.set(user, token);
  }
  return pullHandler(
    new Request("https://app.all-bill.com/api/sync/pull", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
}

async function pullData(body: unknown, user = "owner-a") {
  const response = await pull(body, user);
  expect(response.status).toBe(200);
  return response.json() as Promise<PullResponse>;
}

function allBusinessRows(db: SqliteD1) {
  return Object.fromEntries(
    TABLES.map((table) => [table, db.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}

describe("0020 bootstrap of a populated pre-sync database", () => {
  it("backfills all 12 tables in dependency order, preserves rows, and is idempotent", () => {
    const db = database(true);
    seed(db);
    const original = allBusinessRows(db);
    migration(db, "0019_offline_sync_tables.sql");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_changes").get()).toEqual({ n: 0 });
    migration(db, "0020_offline_sync_backfill.sql");
    const changes = db.raw
      .prepare("SELECT owner_id,tbl,row_id,op FROM sync_changes ORDER BY seq")
      .all();
    expect(changes).toHaveLength(20); // Four catalog rows and eight user rows per owner.
    expect([...new Set(changes.map((row) => row.tbl))]).toEqual(TABLES);
    for (const change of changes) {
      expect(change.op).toBe("upsert");
      expect(change.owner_id).toBe(
        TABLES.indexOf(String(change.tbl)) < 4
          ? null
          : String(change.row_id).endsWith("-a")
            ? "owner-a"
            : "owner-b",
      );
    }
    expect(allBusinessRows(db)).toEqual(original);
    migration(db, "0020_offline_sync_backfill.sql");
    expect(
      db.raw.prepare("SELECT owner_id,tbl,row_id,op FROM sync_changes ORDER BY seq").all(),
    ).toEqual(changes);
  });

  it("pages all existing rows from cursor 0 without crossing user boundaries", async () => {
    const db = database(true);
    seed(db);
    migration(db, "0019_offline_sync_tables.sql");
    migration(db, "0020_offline_sync_backfill.sql");
    for (const owner of ["a", "b"]) {
      let cursor = 0;
      const result: SyncChange[] = [];
      for (let page = 0; page < 20; page++) {
        const data = await pullData({ cursor, limit: 2 }, `owner-${owner}`);
        expect(data.cursor).toBeGreaterThanOrEqual(cursor);
        result.push(...data.changes);
        cursor = data.cursor;
        if (!data.has_more) break;
      }
      expect(result).toHaveLength(12);
      expect(result.map((change) => change.tbl)).toEqual(TABLES);
      expect(
        result
          .filter((change) => TABLES.indexOf(change.tbl) >= 4)
          .every((change) => change.row_id.endsWith(`-${owner}`)),
      ).toBe(true);
      expect(new Set(result.map((change) => `${change.tbl}:${change.row_id}`)).size).toBe(12);
      expect((await pullData({ cursor }, `owner-${owner}`)).changes).toEqual([]);
    }
  });

  it("does not duplicate rows already captured by the 0019 triggers", () => {
    const db = database(true);
    seed(db);
    migration(db, "0019_offline_sync_tables.sql");
    db.exec("INSERT INTO banks (id,name) VALUES ('new-bank','新银行')");
    migration(db, "0020_offline_sync_backfill.sql");
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM sync_changes WHERE tbl='banks' AND row_id='new-bank'")
        .get(),
    ).toEqual({ n: 1 });
  });
});

describe("authoritative pull reconciliation", () => {
  it("restores authoritative rows with an unchanged cursor and no incremental writes", async () => {
    const db = database();
    seed(db);
    const initial = await pullData({ cursor: 0 });
    const data = await pullData({
      cursor: initial.cursor,
      reconcile: [
        { tbl: "bills", row_id: "bill-a" },
        { tbl: "credit_cards", row_id: "card-a" },
      ],
    });
    expect(data.cursor).toBe(initial.cursor);
    expect(data.has_more).toBe(false);
    expect(data.changes).toEqual([
      {
        tbl: "bills",
        row_id: "bill-a",
        op: "upsert",
        row: expect.objectContaining({ bill_amount: 1000 }),
      },
      {
        tbl: "credit_cards",
        row_id: "card-a",
        op: "upsert",
        row: expect.objectContaining({ billing_day: 5 }),
      },
    ]);
    // Existing clients that omit reconcile retain the empty-increment behavior.
    expect((await pullData({ cursor: initial.cursor })).changes).toEqual([]);
  });

  it("returns delete for missing rows and all eight inaccessible user entity kinds", async () => {
    const db = database();
    seed(db);
    const ids = [
      "holder-b",
      "card-b",
      "bill-b",
      "payment-b",
      "owner-b",
      "owner-b",
      "payable-b",
      "recurring-payment-b",
    ];
    const targets = TABLES.slice(4).map((tbl, index) => ({ tbl, row_id: ids[index] }));
    targets.push({ tbl: "bills", row_id: "missing" });
    const data = await pullData({ cursor: 1_000_000, reconcile: targets });
    expect(data.cursor).toBe(1_000_000);
    expect(data.changes).toEqual(targets.map((target) => ({ ...target, op: "delete" })));
  });

  it("authorizes by managed_by/created_by, including when creator or linked holder differs", async () => {
    const db = database();
    seed(db);
    db.exec(`UPDATE card_holders SET created_by='owner-b' WHERE id='holder-a';
      UPDATE recurring_payables SET holder_id='holder-b' WHERE id='payable-a';`);
    const data = await pullData({
      cursor: 1_000_000,
      reconcile: [
        { tbl: "card_holders", row_id: "holder-a" },
        { tbl: "recurring_payables", row_id: "payable-a" },
        { tbl: "recurring_payable_payments", row_id: "recurring-payment-a" },
      ],
    });
    expect(data.changes).toHaveLength(3);
    expect(data.changes.every((change) => change.op === "upsert")).toBe(true);
  });

  it("rechecks current ownership for old incremental logs after a holder transfer", async () => {
    const db = database();
    seed(db);
    db.exec("UPDATE card_holders SET managed_by='owner-b' WHERE id='holder-a'");
    const data = await pullData({ cursor: 0 });
    for (const tbl of ["card_holders", "credit_cards", "bills", "payments"]) {
      expect(data.changes.find((change) => change.tbl === tbl)).toMatchObject({ op: "delete" });
      expect(data.changes.find((change) => change.tbl === tbl)?.row).toBeUndefined();
    }
  });

  it("merges/deduplicates reconciliation without consuming incremental page slots", async () => {
    const db = database();
    seed(db);
    const first = await pullData({
      cursor: 0,
      limit: 1,
      reconcile: [
        { tbl: "banks", row_id: "bank" },
        { tbl: "bills", row_id: "bill-a" },
        { tbl: "bills", row_id: "bill-a" },
      ],
    });
    expect(first.cursor).toBe(1);
    expect(first.has_more).toBe(true);
    expect(first.changes.map((change) => change.tbl)).toEqual(["banks", "bills"]);
    const second = await pullData({ cursor: first.cursor, limit: 1 });
    expect(second.cursor).toBe(2);
    expect(second.changes.map((change) => change.tbl)).toEqual(["card_products"]);
  });

  it("shares catalog data and accepts exactly 100 targets with bound row IDs", async () => {
    const db = database();
    seed(db);
    const targets = [
      ...TABLES.slice(0, 4).map((tbl, index) => ({
        tbl,
        row_id: ["bank", "product", "benefit", "promo"][index],
      })),
      ...Array.from({ length: 96 }, (_, index) => ({
        tbl: "bills",
        row_id: `missing-${index}' OR 1=1 --`,
      })),
    ];
    const data = await pullData({ cursor: 1_000_000, reconcile: targets });
    expect(data.changes).toHaveLength(100);
    expect(data.changes.slice(0, 4).every((change) => change.op === "upsert")).toBe(true);
    expect(data.changes.slice(4).every((change) => change.op === "delete")).toBe(true);
  });

  it("fetches more than 100 entities in bounded per-table batches instead of one query per row", async () => {
    const db = database();
    seed(db);
    const first = await pullData({ cursor: 0 });
    const values = Array.from(
      { length: 101 },
      (_, index) =>
        `('bulk-bill-${index}','card-a','2027-${String(index + 1).padStart(2, "0")}','2027-10-25',${index + 1})`,
    ).join(",");
    db.exec(`INSERT INTO bills (id,card_id,bill_month,due_date,bill_amount) VALUES ${values}`);
    const queries: string[] = [];
    let batchCalls = 0;
    const prepare = db.prepare.bind(db);
    const batch = db.batch.bind(db);
    db.prepare = (sql) => {
      queries.push(sql);
      return prepare(sql);
    };
    db.batch = (statements) => {
      batchCalls++;
      return batch(statements);
    };
    const data = await pullData({ cursor: first.cursor });
    expect(data.changes).toHaveLength(101);
    expect(data.changes[100]).toMatchObject({
      tbl: "bills",
      row_id: "bulk-bill-100",
      row: { bill_amount: 101 },
    });
    expect(queries.filter((sql) => sql.includes("SELECT t.* FROM bills t"))).toHaveLength(2);
    expect(batchCalls).toBe(1);
  });

  it("rejects fractional or negative paging params instead of silently breaking has_more", async () => {
    const db = database();
    seed(db);
    for (const bad of [{ limit: 500.5 }, { cursor: 1.5 }, { limit: -1 }, { cursor: -2 }]) {
      expect((await pull(bad)).status).toBe(400);
    }
    expect((await pull({})).status).toBe(200);
  });

  it("does not claim more pages when the last page holds exactly the limit", async () => {
    const db = database();
    seed(db);
    const first = await pullData({ cursor: 0, limit: 1 });
    expect(first.has_more).toBe(true);
    const second = await pullData({ cursor: first.cursor, limit: 1000 });
    // seed has exactly 21 remaining changes here; a full tail page must end pagination.
    expect(second.has_more).toBe(false);
    expect((await pullData({ cursor: second.cursor, limit: 1000 })).changes).toEqual([]);
  });

  it.each(
    [
      [{ tbl: "__proto__", row_id: "owner-a" }],
      [{ tbl: "constructor", row_id: "owner-a" }],
      [{ tbl: "bills;DROP TABLE users", row_id: "bill-a" }],
      [{ tbl: "bills", row_id: "" }],
      [{ tbl: "bills", row_id: "   " }],
      [{ tbl: "bills", row_id: 1 }],
      [{ tbl: "bills", row_id: "x".repeat(257) }],
      Array.from({ length: 101 }, () => ({ tbl: "bills", row_id: "bill-a" })),
    ].map((reconcile) => ({ reconcile })),
  )("rejects malformed/unsupported reconcile targets: %j", async ({ reconcile }) => {
    database();
    expect((await pull({ cursor: 0, reconcile })).status).toBe(400);
  });

  it("matches the shared Swift wire fixture against actual SQLite pull rows", async () => {
    const db = database();
    const fixture = JSON.parse(
      readFileSync(join(__dirname, "../../shared/fixtures/sync-d1-rows.json"), "utf8"),
    ) as {
      seed_sql: string;
      response: PullResponse;
    };
    db.exec(fixture.seed_sql);
    const response = await pullData({ cursor: 0 }, "sync-fixture-user");
    expect({ ...response, server_time: fixture.response.server_time }).toEqual(fixture.response);
  });
});
