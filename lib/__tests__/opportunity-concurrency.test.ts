// lib/__tests__/opportunity-concurrency.test.ts — plan Task 9 step 5 races,
// exercised against real SQLite. A barrier on db.batch parks both requests
// AFTER every read (pre-checks, committed-command lookup) and BEFORE any
// statement executes, so both compose their assertions against the SAME
// state — then both batches run. The database, not the harness, decides:
//   A04 last-slot race — two different keys, one quota slot: exactly one
//        commits; the loser's write_checks CHECK (or cycle CHECK) aborts it
//   A05 same-key race — both enter the batch; the loser hits the commands
//        UNIQUE and replays the committed result
//   same-key different-payload race — the loser classifies as
//        IDEMPOTENCY_CONFLICT without side effects
//   revision races — two corrections / two voids on the same expected
//        revision: one CAS wins, the other reports REVISION_CONFLICT
// After every race reconcileOpportunityCycle shows no drift.

import { describe, it, expect, beforeEach } from "vitest";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { seedOpportunityFixtures, FIXTURE_IDS } from "./helpers/opportunity-fixtures";
import { setDb } from "../db/client";
import { createOpportunityAccount } from "../opportunities/accounts.server";
import {
  recordOpportunityUsage,
  correctOpportunityUsage,
  voidOpportunityUsage,
} from "../opportunities/usages.server";
import {
  recordOpportunityBooking,
  completeOpportunityBooking,
} from "../opportunities/fulfillments.server";
import { reconcileOpportunityCycle } from "../opportunities/writes.server";
import { OpportunityError } from "../opportunities/errors";
import type { RuleSnapshotV1, OpportunityActor } from "../opportunities/types";

let db: SqliteD1;
const f = FIXTURE_IDS;
const NOW = "2026-10-15T08:00:00Z";

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: "admin" };

beforeEach(async () => {
  db = createOpportunityDb();
  await seedOpportunityFixtures(db);
  setDb(db as unknown as D1Database);
});

// ---------------------------------------------------------------------------
// World builders (same shape as opportunity-usages.test.ts, trimmed to what
// the races need)
// ---------------------------------------------------------------------------

function makeRules(overrides: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: "经典白金 贵宾厅",
    description: null,
    category: "travel",
    time_zone: "Asia/Shanghai",
    bank_id: f.banks.cmb,
    card_product_ids: [f.products.cmbClassic],
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
    ...overrides,
  };
}

let seq = 0;
const rk = (tag: string) => `concur-rk-${tag}-${String(++seq).padStart(4, "0")}`;

async function setupWorld(rules: RuleSnapshotV1): Promise<{ accountId: string; cycleId: string }> {
  const n = ++seq;
  const defId = `odef-concur-${n}`;
  const versionId = `orv-concur-${n}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
      )
      .bind(defId, f.users.adminA),
    db
      .prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
      )
      .bind(versionId, defId, JSON.stringify(rules)),
  ]);
  const created = await createOpportunityAccount(
    actorAdminA,
    {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: "card",
      request_key: rk("world"),
    },
    { now: NOW },
  );
  if (!created.cycle) throw new Error("setupWorld: no current cycle materialized");
  return { accountId: created.account.id, cycleId: created.cycle.id };
}

// ---------------------------------------------------------------------------
// Barrier: park every db.batch call until `participants` have all arrived —
// i.e. every racing request finished its reads (pre-checks, committed-command
// lookup) and composed its assertions against the SAME state. Batches then
// run strictly one after another, which is what D1 gives you anyway: each
// batch is one transaction and the loser executes against the winner's
// committed rows, so the DATABASE decides the race, never the harness.
// ---------------------------------------------------------------------------

function installBatchBarrier(participants: number): void {
  const original = db.batch.bind(db);
  let arrived = 0;
  let releaseAll!: () => void;
  const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
  let previous: Promise<unknown> = allArrived;
  db.batch = (async (statements: D1PreparedStatement[]) => {
    arrived += 1;
    if (arrived >= participants) releaseAll();
    await allArrived;
    // serialize: this batch starts only after the previous one finished
    const prev = previous;
    let finished!: () => void;
    previous = new Promise<void>((resolve) => (finished = resolve));
    await prev;
    try {
      return await original(statements);
    } finally {
      finished();
    }
  }) as unknown as typeof db.batch;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function errorCode(result: Settled<unknown>): string | null {
  return result.ok ? null : (result.error as OpportunityError).code;
}

function recordUsage(accountId: string, cycleId: string, over: Record<string, unknown> = {}) {
  return recordOpportunityUsage(
    actorAdminA,
    {
      account_id: accountId,
      cycle_id: cycleId,
      card_id: f.cards.selfMain,
      used_on: "2026-10-10",
      quantity: 1,
      amount_minor: 0,
      note: null,
      request_key: rk("race"),
      ...over,
    },
    { now: NOW },
  );
}

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

describe("并发竞争（barrier 后同状态入批）", () => {
  it("A04：余额 1，两个不同 key 各记 1，只成功一次", async () => {
    const w = await setupWorld(makeRules({ count_limit: 1 }));
    installBatchBarrier(2);

    const [a, b] = await Promise.all([
      settle(recordUsage(w.accountId, w.cycleId, { request_key: rk("a") })),
      settle(recordUsage(w.accountId, w.cycleId, { request_key: rk("b") })),
    ]);
    const codes = [a, b].map(errorCode);
    expect(codes.filter((c) => c === null)).toHaveLength(1);
    expect(codes).toContain("QUOTA_EXCEEDED");

    const cycle = db.raw
      .prepare("SELECT used_count, revision FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number; revision: number };
    expect(cycle).toEqual({ used_count: 1, revision: 2 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_usages").get()).toEqual({ n: 1 });
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'")
        .get(),
    ).toEqual({ n: 1 });
    // the loser's command rolled back entirely
    expect(
      db.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM opportunity_commands WHERE command_type = 'recordOpportunityUsage'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_write_checks").get()).toEqual({
      n: 0,
    });
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });

  it("A05：相同 key 并发重试，输者重放已提交结果，不双写", async () => {
    const w = await setupWorld(makeRules({ count_limit: 6 }));
    const input = {
      account_id: w.accountId,
      cycle_id: w.cycleId,
      card_id: f.cards.selfMain,
      used_on: "2026-10-10",
      quantity: 1,
      amount_minor: 0,
      note: null,
      request_key: rk("same"),
    };
    installBatchBarrier(2);

    const [a, b] = await Promise.all([
      settle(recordOpportunityUsage(actorAdminA, input, { now: NOW })),
      settle(recordOpportunityUsage(actorAdminA, { ...input }, { now: NOW })),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.value).toEqual(a.value);

    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_usages").get()).toEqual({ n: 1 });
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'")
        .get(),
    ).toEqual({ n: 1 });
    const cycle = db.raw
      .prepare("SELECT used_count FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number };
    expect(cycle.used_count).toBe(1);
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });

  it("A05：相同 key 并发但参数不同，输者 IDEMPOTENCY_CONFLICT", async () => {
    const w = await setupWorld(makeRules({ count_limit: 6 }));
    const key = rk("diff");
    installBatchBarrier(2);

    const [q1, q3] = await Promise.all([
      settle(recordUsage(w.accountId, w.cycleId, { quantity: 1, request_key: key })),
      settle(recordUsage(w.accountId, w.cycleId, { quantity: 3, request_key: key })),
    ]);
    // 哈希是异步操作，调用顺序不保证入批顺序；任一请求都可能合法获胜。
    expect([errorCode(q1), errorCode(q3)].sort()).toEqual(["IDEMPOTENCY_CONFLICT", null]);
    const winner = q1.ok ? q1 : q3;
    if (!winner.ok) throw new Error("同 key 异参竞争必须有一个成功结果");
    const winningQuantity = q1.ok ? 1 : 3;
    const cycle = db.raw
      .prepare("SELECT used_count, revision FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number; revision: number };
    expect(cycle).toEqual({ used_count: winningQuantity, revision: 2 });
    expect(db.raw.prepare("SELECT id, quantity FROM opportunity_usages").all()).toEqual([
      { id: winner.value.usage_id, quantity: winningQuantity },
    ]);
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      db.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM opportunity_commands WHERE command_type = 'recordOpportunityUsage'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_write_checks").get()).toEqual({
      n: 0,
    });
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });

  it("两个更正携带同一 expected_revision，只有一个 CAS 成功", async () => {
    const w = await setupWorld(makeRules({ count_limit: 6 }));
    const base = await recordUsage(w.accountId, w.cycleId, { request_key: rk("base") });
    installBatchBarrier(2);

    const correct = (note: string) =>
      settle(
        correctOpportunityUsage(
          actorAdminA,
          {
            usage_id: base.usage_id,
            note,
            reason: `并发更正 ${note}`,
            expected_revision: 1,
            request_key: rk(`corr-${note}`),
          },
          { now: NOW },
        ),
      );
    const [a, b] = await Promise.all([correct("甲"), correct("乙")]);
    const codes = [errorCode(a), errorCode(b)];
    expect(codes.filter((c) => c === null)).toHaveLength(1);
    expect(codes).toContain("REVISION_CONFLICT");

    const usage = db.raw
      .prepare("SELECT note, revision FROM opportunity_usages WHERE id = ?")
      .get(base.usage_id) as { note: string; revision: number };
    expect(usage.revision).toBe(2);
    expect(["甲", "乙"]).toContain(usage.note);
    expect(
      db.raw
        .prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'usage'")
        .get(),
    ).toEqual({ n: 2 }); // recorded + one corrected
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });

  it("两个撤销携带同一 expected_revision，只反冲一次", async () => {
    const w = await setupWorld(makeRules({ count_limit: 6 }));
    const base = await recordUsage(w.accountId, w.cycleId, {
      quantity: 2,
      request_key: rk("base"),
    });
    installBatchBarrier(2);

    const voidIt = (reason: string) =>
      settle(
        voidOpportunityUsage(
          actorAdminA,
          {
            usage_id: base.usage_id,
            reason,
            expected_revision: 1,
            request_key: rk(`void-${reason}`),
          },
          { now: NOW },
        ),
      );
    const [a, b] = await Promise.all([voidIt("记错卡"), voidIt("重复撤销")]);
    const codes = [errorCode(a), errorCode(b)];
    expect(codes.filter((c) => c === null)).toHaveLength(1);
    // 输者输在“已有人撤销”，这是事实而非修订号过期
    expect(codes).toContain("INVALID_TRANSITION");

    const cycle = db.raw
      .prepare("SELECT used_count FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number };
    expect(cycle.used_count).toBe(0); // 反冲恰好一次
    const usage = db.raw
      .prepare("SELECT status, revision FROM opportunity_usages WHERE id = ?")
      .get(base.usage_id) as { status: string; revision: number };
    expect(usage).toEqual({ status: "voided", revision: 2 });
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 20 races: bookings vs usages and double completion
// ---------------------------------------------------------------------------

describe("预约并发（Task 20）", () => {
  it("最后额度：直接使用与预约并发，只成功一个，无漂移", async () => {
    const w = await setupWorld(makeRules({ count_limit: 1 }));
    installBatchBarrier(2);

    const [use, book] = await Promise.all([
      settle(recordUsage(w.accountId, w.cycleId, { request_key: rk("use") })),
      settle(
        recordOpportunityBooking(
          actorAdminA,
          {
            account_id: w.accountId,
            cycle_id: w.cycleId,
            card_id: f.cards.selfMain,
            service_at: "2026-10-20T10:00:00+08:00",
            service_time_zone: "Asia/Shanghai",
            quantity: 1,
            amount_minor: 0,
            request_key: rk("book"),
          },
          { now: NOW },
        ),
      ),
    ]);
    const codes = [errorCode(use), errorCode(book)];
    expect(codes.filter((c) => c === null)).toHaveLength(1);
    expect(codes).toContain("QUOTA_EXCEEDED");

    const cycle = db.raw
      .prepare("SELECT used_count, reserved_count FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number; reserved_count: number };
    expect(cycle.used_count + cycle.reserved_count).toBe(1);
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });

  it("两次 complete 同 revision：只成功一次，另一报告冲突", async () => {
    const w = await setupWorld(makeRules({ count_limit: 2 }));
    const booking = await recordOpportunityBooking(
      actorAdminA,
      {
        account_id: w.accountId,
        cycle_id: w.cycleId,
        card_id: f.cards.selfMain,
        service_at: "2026-10-20T10:00:00+08:00",
        service_time_zone: "Asia/Shanghai",
        quantity: 1,
        amount_minor: 0,
        request_key: rk("book"),
      },
      { now: NOW },
    );
    installBatchBarrier(2);
    const [a, b] = await Promise.all([
      settle(
        completeOpportunityBooking(
          actorAdminA,
          {
            fulfillment_id: booking.fulfillment_id,
            used_on: "2026-10-20",
            expected_revision: 1,
            request_key: rk("c1"),
          },
          { now: NOW },
        ),
      ),
      settle(
        completeOpportunityBooking(
          actorAdminA,
          {
            fulfillment_id: booking.fulfillment_id,
            used_on: "2026-10-20",
            expected_revision: 1,
            request_key: rk("c2"),
          },
          { now: NOW },
        ),
      ),
    ]);
    const codes = [errorCode(a), errorCode(b)];
    expect(codes.filter((c) => c === null)).toHaveLength(1);
    // 输者命中批内 CAS 断言或状态前读
    expect(codes.some((c) => c === "INVALID_TRANSITION" || c === "REVISION_CONFLICT")).toBe(true);

    const cycle = db.raw
      .prepare("SELECT used_count, reserved_count FROM opportunity_cycles WHERE id = ?")
      .get(w.cycleId) as { used_count: number; reserved_count: number };
    expect(cycle).toEqual({ used_count: 1, reserved_count: 0 });
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_usages").get() as { n: number }).n,
    ).toBe(1);
    expect((await reconcileOpportunityCycle(actorAdminA, w.cycleId)).ok).toBe(true);
  });
});
