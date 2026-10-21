// lib/__tests__/opportunity-accounts.test.ts — accounts, linked cards, cycles
// and opening verification (plan Task 7), against real SQLite + 0013 DDL.
// Covers the initialization/cycle half of acceptance rows A01/A02/A07/A10:
//   A01 two holders, same product → independent card accounts & quotas
//   A02 one holder, two cards, explicit shared account → one scope
//   A07 mid-cycle first materialization picks the earliest provable version
//       and clips usable_start; no overlapping windows
//   A10 opening verification and opening→used reclassification (later cases)

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  createOpportunityAccount,
  confirmOpportunityEligibility,
  materializeCycleForDate,
} from '../opportunities/accounts.server'
import type { RuleSnapshotV1 } from '../opportunities/types'
import type { OpportunityActor } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const TODAY_SHANGHAI = '2026-10-15'

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

/** A valid monthly RuleSnapshotV1 over the CMB Classic product. */
function makeRules(overrides: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '经典白金 贵宾厅',
    description: null,
    category: 'travel',
    time_zone: 'Asia/Shanghai',
    bank_id: f.banks.cmb,
    card_product_ids: [f.products.cmbClassic],
    valid_from: null,
    valid_until_before: null,
    open_ended: true,
    weekdays: null,
    cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
    allocation: 'recurring',
    count_limit: 6,
    amount_limit_minor: null,
    currency: null,
    unit_label: '次',
    eligibility_text: null,
    requires_personal_confirmation: false,
    claim_window: null,
    booking_window: null,
    workflow_time_basis: 'fixed',
    booking_consumes: 'reserve_then_use',
    cancellation_rule: 'confirm_with_issuer',
    entry: { website_url: null, app_name: null, app_path: null },
    ...overrides,
  }
}

let defSeq = 0

/** Seeds a shared definition + one published rule version with real rules. */
async function seedDefinition(db: SqliteD1, rules: RuleSnapshotV1, effectiveFrom = '2026-01-01') {
  const n = ++defSeq
  const defId = `odef-acc-${n}`
  const versionId = `orv-acc-${n}`
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
         VALUES (?, ?, 1, ?, ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
      )
      .bind(versionId, defId, effectiveFrom, JSON.stringify(rules)),
  ])
  return { defId, versionId }
}

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

// ---------------------------------------------------------------------------
// account creation
// ---------------------------------------------------------------------------

describe('createOpportunityAccount', () => {
  it('独立卡账户：同产品两个 holder 各建各的，额度互不影响（A01 初始化）', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const a = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-self-0001',
    })
    const b = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.family,
      card_ids: [f.cards.familyClassic],
      scope_kind: 'card',
      request_key: 'key-acct-family-002',
    })
    expect(a.already_exists).toBe(false)
    expect(a.account.scope_key).toBe(`card:${f.cards.selfMain}`)
    expect(b.account.scope_key).toBe(`card:${f.cards.familyClassic}`)
    expect(a.account.id).not.toBe(b.account.id)

    // Both materialize the current monthly cycle independently: 10-01…11-01, 6 uses.
    expect(a.cycle).toMatchObject({
      cycle_key: 'regular:2026-10-01',
      period_start_on: '2026-10-01',
      period_end_before: '2026-11-01',
      usable_start_on: '2026-10-01',
      count_limit: 6,
      activation_state: 'active',
    })
    expect(b.cycle?.id).not.toBe(a.cycle?.id)
    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_accounts').get(),
    ).toEqual({ n: 2 })
    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_account_cards').get(),
    ).toEqual({ n: 2 })
  })

  it('同 holder 两张卡显式共享一个 holder-scope 账户（A02）', async () => {
    const { defId } = await seedDefinition(db, makeRules({ card_product_ids: [f.products.cmbClassic, f.products.cmbLife] }))
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain, f.cards.selfSecond],
      scope_kind: 'holder',
      request_key: 'key-acct-shared-03',
    })
    expect(out.account.scope_key).toBe(`holder:${f.holders.self}`)
    expect(out.account.scope_kind).toBe('holder')
    const links = db.raw
      .prepare('SELECT card_id FROM opportunity_account_cards ORDER BY card_id')
      .all() as { card_id: string }[]
    expect(links.map((r) => r.card_id).sort()).toEqual([f.cards.selfMain, f.cards.selfSecond].sort())
  })

  it('卡不属于该 holder 或不符合定义产品时拒绝', async () => {
    const { defId } = await seedDefinition(db, makeRules()) // cmbClassic only
    await expect(
      createOpportunityAccount(actorAdminA, {
        definition_id: defId,
        holder_id: f.holders.self,
        card_ids: [f.cards.familyClassic], // family's card under self's holder
        scope_kind: 'card',
        request_key: 'key-acct-mix-0004',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await expect(
      createOpportunityAccount(actorAdminA, {
        definition_id: defId,
        holder_id: f.holders.self,
        card_ids: [f.cards.selfLoan], // icbcGold, not in card_product_ids
        scope_kind: 'card',
        request_key: 'key-acct-prod-005',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_accounts').get()).toEqual({ n: 0 })
  })

  it('同卡同定义重复创建返回已有账户（幂等），不同 holder 绑定被拒', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const first = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-first-006',
    })
    const again = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-first-007',
    })
    expect(again.already_exists).toBe(true)
    expect(again.account.id).toBe(first.account.id)
    expect(again.cycle?.id).toBe(first.cycle?.id)
    // events only from the first creation
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_events').get()).toEqual({ n: 2 })

    // Binding a card that belongs to another holder is refused up front.
    await expect(
      createOpportunityAccount(actorAdminA, {
        definition_id: defId,
        holder_id: f.holders.family,
        card_ids: [f.cards.selfMain],
        scope_kind: 'card',
        request_key: 'key-acct-hijack-08',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('scope_kind=card 只能绑定一张卡', async () => {
    const { defId } = await seedDefinition(db, makeRules({ card_product_ids: [f.products.cmbClassic, f.products.cmbLife] }))
    await expect(
      createOpportunityAccount(actorAdminA, {
        definition_id: defId,
        holder_id: f.holders.self,
        card_ids: [f.cards.selfMain, f.cards.selfSecond],
        scope_kind: 'card',
        request_key: 'key-acct-card2-009',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('越权：其他管理员不能在自己范围外建账户；无 holder 绑定拒绝', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    await expect(
      createOpportunityAccount(actorAdminB, {
        definition_id: defId,
        holder_id: f.holders.self,
        card_ids: [f.cards.selfMain],
        scope_kind: 'card',
        request_key: 'key-acct-cross-010',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' })
  })

  it('allocation=grant_only 不建 regular 周期；claim_gated 建为 pending_claim', async () => {
    const grant = await seedDefinition(db, makeRules({ allocation: 'grant_only' }))
    const claim = await seedDefinition(db, makeRules({ allocation: 'claim_gated' }))
    const outGrant = await createOpportunityAccount(actorAdminA, {
      definition_id: grant.defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-grant-011',
    })
    expect(outGrant.cycle).toBeNull()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_cycles').get()).toEqual({ n: 0 })

    const outClaim = await createOpportunityAccount(actorAdminA, {
      definition_id: claim.defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-claim-012',
    })
    expect(outClaim.cycle?.activation_state).toBe('pending_claim')
  })

  it('相同请求键重放返回已提交结果（命令幂等）', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const input = {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card' as const,
      request_key: 'key-acct-idem-013',
    }
    const first = await createOpportunityAccount(actorAdminA, input)
    const replay = await createOpportunityAccount(actorAdminA, input)
    expect(replay.account.id).toBe(first.account.id)
    expect(replay.already_exists).toBe(true)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_accounts').get()).toEqual({ n: 1 })
  })
})

// ---------------------------------------------------------------------------
// cycle materialization
// ---------------------------------------------------------------------------

describe('cycle materialization', () => {
  it('月中首建：名义窗口仍是整月，可用起点截到版本生效日（A07）', async () => {
    // Version published effective 2026-10-10 — inside the nominal October window.
    const { defId, versionId } = await seedDefinition(db, makeRules(), '2026-10-10')
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-midmo-014',
    })
    expect(out.cycle).toMatchObject({
      period_start_on: '2026-10-01',
      period_end_before: '2026-11-01',
      usable_start_on: '2026-10-10', // max(period_start, version_as_of)
      count_limit: 6,
    })
    const row = db.raw
      .prepare('SELECT version_id, version_as_of_on FROM opportunity_cycles WHERE id = ?')
      .get(out.cycle!.id) as { version_id: string; version_as_of_on: string }
    expect(row.version_id).toBe(versionId)
    expect(row.version_as_of_on).toBe('2026-10-10')
  })

  it('名义开始日已有旧版本时不改选窗口内的新版本', async () => {
    // v1 effective 2026-09-01 (covers the nominal start), v2 effective 2026-10-05.
    const n = ++defSeq
    const defId = `odef-acc-${n}`
    await db.batch([
      db
        .prepare(
          `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
           VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
        )
        .bind(defId, f.users.adminA),
      db
        .prepare(
          `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, effective_until_before, rules_json, verification, published_at)
           VALUES (?, ?, 1, '2026-09-01', '2026-10-05', ?, 'user_confirmed', '2026-09-01T00:00:00Z')`,
        )
        .bind(`orv-${n}-a`, defId, JSON.stringify(makeRules({ count_limit: 2 }))),
      db
        .prepare(
          `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
           VALUES (?, ?, 2, '2026-10-05', ?, 'user_confirmed', '2026-10-05T00:00:00Z')`,
        )
        .bind(`orv-${n}-b`, defId, JSON.stringify(makeRules({ count_limit: 9 }))),
    ])

    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-oldver-15',
    })
    expect(out.cycle).toMatchObject({ usable_start_on: '2026-10-01', count_limit: 2 })
    const row = db.raw
      .prepare('SELECT version_id, version_as_of_on FROM opportunity_cycles WHERE id = ?')
      .get(out.cycle!.id) as { version_id: string; version_as_of_on: string }
    expect(row.version_id).toBe(`orv-${n}-a`)
    expect(row.version_as_of_on).toBe('2026-10-01')
  })

  it('规则有效区间与周期无交集时不建可用批次', async () => {
    const { defId } = await seedDefinition(
      db,
      makeRules({ valid_from: '2026-11-01', valid_until_before: '2026-12-01', open_ended: false }),
    )
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-novld-16',
    })
    expect(out.cycle).toBeNull()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_cycles').get()).toEqual({ n: 0 })
  })

  it('重复 materialize 同周期命中唯一约束后读取同一行', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-mat-0017',
    })
    expect(out.cycle).not.toBeNull()

    // Second materialization for the same date must return the SAME row.
    const again = await materializeCycleForDate(
      actorAdminA,
      out.account.id,
      TODAY_SHANGHAI,
      'key-acct-mat-0018',
    )
    expect(again?.id).toBe(out.cycle?.id)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_cycles').get()).toEqual({ n: 1 })
  })

  it('无任何已发布版本覆盖时 materialize 返回 null', async () => {
    // Definition with a version that starts only next year.
    const { defId } = await seedDefinition(db, makeRules(), '2027-01-01')
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-future-18',
    })
    expect(out.cycle).toBeNull()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_cycles').get()).toEqual({ n: 0 })
  })

  it('同 key 重放返回已提交的账户/周期 id，不是新生成的随机 id', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const input = {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card' as const,
      request_key: 'key-acct-replay-19',
    }
    const first = await createOpportunityAccount(actorAdminA, input)
    const second = await createOpportunityAccount(actorAdminA, input)

    // 早返回路径命中同 definition+scope 的既有账户：id 必须是提交过的那个，
    // 而不是本次新生成、从未落库的随机 UUID
    expect(second.account).toEqual(first.account)
    expect(second.cycle?.id).toBe(first.cycle?.id)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_accounts').get()).toEqual({ n: 1 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_cycles').get()).toEqual({ n: 1 })
  })
})

// ---------------------------------------------------------------------------
// eligibility confirmation
// ---------------------------------------------------------------------------

describe('confirmOpportunityEligibility', () => {
  it('保存个人资格与生效日，事件与 revision 跟进', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-elig-019',
    })
    const confirmed = await confirmOpportunityEligibility(actorAdminA, {
      account_id: out.account.id,
      eligibility: 'confirmed',
      eligible_from_on: '2026-09-20',
      note: '核卡通过',
      expected_revision: 1,
      request_key: 'key-acct-elig-020',
    })
    expect(confirmed.revision).toBe(2)
    const row = db.raw
      .prepare(
        'SELECT eligibility, eligible_from_on, eligibility_confirmed_by FROM opportunity_accounts WHERE id = ?',
      )
      .get(out.account.id) as Record<string, unknown>
    expect(row.eligibility).toBe('confirmed')
    expect(row.eligible_from_on).toBe('2026-09-20')
    expect(row.eligibility_confirmed_by).toBe(f.users.adminA)
    // an eligibility event was recorded, deltas zero
    const ev = db.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM opportunity_events WHERE entity_kind = 'account' AND event_type = 'account.eligibility_confirmed'",
      )
      .get()
    expect(ev).toEqual({ n: 1 })
  })

  it('revision 不匹配时拒绝且无副作用', async () => {
    const { defId } = await seedDefinition(db, makeRules())
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-elig-021',
    })
    await expect(
      confirmOpportunityEligibility(actorAdminA, {
        account_id: out.account.id,
        eligibility: 'confirmed',
        eligible_from_on: '2026-09-20',
        note: null,
        expected_revision: 99,
        request_key: 'key-acct-elig-022',
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    const row = db.raw
      .prepare('SELECT revision, eligibility FROM opportunity_accounts WHERE id = ?')
      .get(out.account.id) as Record<string, unknown>
    expect(row).toMatchObject({ revision: 1, eligibility: 'unknown' })
  })
})

// ---------------------------------------------------------------------------
// opening verification + legacy reclassification (A10)
// ---------------------------------------------------------------------------

import {
  confirmOpeningBalance,
  assignLegacyUsage,
  updateOpportunityCycleWorkflow,
} from '../opportunities/accounts.server'

/** Creates the standard card account + current cycle, returning both ids. */
async function setupAccount(requestKey: string) {
  const { defId } = await seedDefinition(db, makeRules())
  const out = await createOpportunityAccount(actorAdminA, {
    definition_id: defId,
    holder_id: f.holders.self,
    card_ids: [f.cards.selfMain],
    scope_kind: 'card',
    request_key: requestKey,
  })
  if (!out.cycle) throw new Error('cycle expected')
  return { defId, accountId: out.account.id, cycleId: out.cycle.id }
}

function seedRecordedUsage(cycleId: string, accountId: string, usedOn: string, quantity: number) {
  db.raw
    .prepare(
      `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-15T08:00:00Z', '2026-10-15T08:00:00Z')`,
    )
    .run(`ousg-open-${crypto.randomUUID().slice(0, 8)}`, accountId, cycleId, f.cards.selfMain, usedOn, quantity, f.users.adminA, f.users.adminA)
}

describe('confirmOpeningBalance', () => {
  it('表单输入的截至总额扣除已录入后成为 opening，无未归属历史时 verified=1', async () => {
    const { cycleId } = await setupAccount('key-acct-open-100')
    seedRecordedUsage(cycleId, (db.raw.prepare('SELECT account_id AS a FROM opportunity_cycles WHERE id = ?').get(cycleId) as { a: string }).a, '2026-10-12', 1)

    // Total consumed to date = 2, one usage already recorded → opening = 1.
    const out = await confirmOpeningBalance(actorAdminA, {
      cycle_id: cycleId,
      opening_used_count: 2,
      opening_used_minor: 0,
      as_of_on: '2026-10-14',
      reason: '银行账单核对',
      expected_revision: 1,
      request_key: 'key-acct-open-101',
    })
    expect(out).toMatchObject({ cycle_id: cycleId, revision: 2, balance_verified: 1 })
    const row = db.raw
      .prepare('SELECT opening_used_count, opening_used_minor, opening_as_of_on, balance_verified FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as Record<string, unknown>
    expect(row).toMatchObject({
      opening_used_count: 1,
      opening_used_minor: 0,
      opening_as_of_on: '2026-10-14',
      balance_verified: 1,
    })
    // The event carries the exact delta the user could not enumerate.
    const ev = db.raw
      .prepare("SELECT delta_opening_count FROM opportunity_events WHERE event_type = 'cycle.opening_verified'")
      .get() as { delta_opening_count: number }
    expect(ev.delta_opening_count).toBe(1)
  })

  it('已录入的 used 不会被重复计入 opening（输入总额等于已录入时 opening=0）', async () => {
    const { cycleId } = await setupAccount('key-acct-open-102')
    const acc = (db.raw.prepare('SELECT account_id AS a FROM opportunity_cycles WHERE id = ?').get(cycleId) as { a: string }).a
    seedRecordedUsage(cycleId, acc, '2026-10-12', 2)
    await confirmOpeningBalance(actorAdminA, {
      cycle_id: cycleId,
      opening_used_count: 2,
      opening_used_minor: 0,
      as_of_on: '2026-10-14',
      reason: null,
      expected_revision: 1,
      request_key: 'key-acct-open-103',
    })
    const row = db.raw.prepare('SELECT opening_used_count FROM opportunity_cycles WHERE id = ?').get(cycleId) as Record<string, unknown>
    expect(row.opening_used_count).toBe(0)
  })

  it('与已录入冲突（负 opening）时拒绝且无副作用', async () => {
    const { cycleId } = await setupAccount('key-acct-open-104')
    const acc = (db.raw.prepare('SELECT account_id AS a FROM opportunity_cycles WHERE id = ?').get(cycleId) as { a: string }).a
    seedRecordedUsage(cycleId, acc, '2026-10-12', 2)
    await expect(
      confirmOpeningBalance(actorAdminA, {
        cycle_id: cycleId,
        opening_used_count: 1,
        opening_used_minor: 0,
        as_of_on: '2026-10-14',
        reason: null,
        expected_revision: 1,
        request_key: 'key-acct-open-105',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    const row = db.raw.prepare('SELECT opening_used_count, revision, balance_verified FROM opportunity_cycles WHERE id = ?').get(cycleId) as Record<string, unknown>
    expect(row).toMatchObject({ opening_used_count: 0, revision: 1, balance_verified: 0 })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE event_type = 'cycle.opening_verified'").get()).toEqual({ n: 0 })
  })

  it('存在未归属旧记录时核对保存但 verified=0', async () => {
    const { defId, cycleId } = await setupAccount('key-acct-open-106')
    // A legacy benefit usage on the definition's product, unassigned.
    db.raw
      .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at, note) VALUES (?, ?, ?, ?)')
      .run('bu-legacy-1', f.benefits.cmbClassicLounge, '2026-10-08', '历史使用')
    // link the fixture benefit to the definition so the scope check finds it
    db.raw
      .prepare('UPDATE opportunity_definitions SET legacy_benefit_id = ? WHERE id = ?')
      .run(f.benefits.cmbClassicLounge, defId)

    const out = await confirmOpeningBalance(actorAdminA, {
      cycle_id: cycleId,
      opening_used_count: 3,
      opening_used_minor: 0,
      as_of_on: '2026-10-14',
      reason: null,
      expected_revision: 1,
      request_key: 'key-acct-open-107',
    })
    expect(out.balance_verified).toBe(0)
    const row = db.raw.prepare('SELECT opening_used_count, balance_verified FROM opportunity_cycles WHERE id = ?').get(cycleId) as Record<string, unknown>
    expect(row).toMatchObject({ opening_used_count: 3, balance_verified: 0 })
  })

  it('revision 不匹配拒绝', async () => {
    const { cycleId } = await setupAccount('key-acct-open-108')
    await expect(
      confirmOpeningBalance(actorAdminA, {
        cycle_id: cycleId,
        opening_used_count: 1,
        opening_used_minor: 0,
        as_of_on: '2026-10-14',
        reason: null,
        expected_revision: 42,
        request_key: 'key-acct-open-109',
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })
})

describe('assignLegacyUsage', () => {
  async function setupWithOpening(opening: number) {
    const ctx = await setupAccount('key-acct-legacy-110')
    await confirmOpeningBalance(actorAdminA, {
      cycle_id: ctx.cycleId,
      opening_used_count: opening,
      opening_used_minor: 0,
      as_of_on: '2026-10-14',
      reason: null,
      expected_revision: 1,
      request_key: 'key-acct-legacy-111',
    })
    db.raw
      .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at, note) VALUES (?, ?, ?, ?)')
      .run('bu-legacy-2', f.benefits.cmbClassicLounge, '2026-10-08', '待归属')
    db.raw
      .prepare('UPDATE opportunity_definitions SET legacy_benefit_id = ? WHERE id = ?')
      .run(f.benefits.cmbClassicLounge, ctx.defId)
    return ctx
  }

  it('included_in_opening=true：opening→used 转分类，总耗用不变（A10）', async () => {
    const { accountId, cycleId } = await setupWithOpening(3)
    const out = await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages',
      source_id: 'bu-legacy-2',
      account_id: accountId,
      cycle_id: cycleId,
      card_id: f.cards.selfMain,
      used_on: '2026-10-08',
      quantity: 2,
      amount_minor: 0,
      included_in_opening: true,
      reason: '已含在 10-14 核对总额中',
      request_key: 'key-acct-legacy-112',
    })
    expect(out).toMatchObject({ included_in_opening: true })
    const cycle = db.raw
      .prepare('SELECT opening_used_count, used_count, used_minor FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as Record<string, number>
    expect(cycle).toMatchObject({ opening_used_count: 1, used_count: 2, used_minor: 0 }) // 3−2 / 0+2
    const link = db.raw
      .prepare('SELECT included_in_opening, offset_opening_count, offset_opening_minor FROM opportunity_legacy_links WHERE source_table = ? AND source_id = ?')
      .get('benefit_usages', 'bu-legacy-2') as Record<string, unknown>
    expect(link).toMatchObject({ included_in_opening: 1, offset_opening_count: 2, offset_opening_minor: 0 })
    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get(),
    ).toEqual({ n: 1 })
  })

  it('opening 不足以覆盖 included 记录时整批失败（先核对）', async () => {
    const { accountId, cycleId } = await setupWithOpening(1)
    await expect(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages',
        source_id: 'bu-legacy-2',
        account_id: accountId,
        cycle_id: cycleId,
        card_id: f.cards.selfMain,
        used_on: '2026-10-08',
        quantity: 5,
        amount_minor: 0,
        included_in_opening: true,
        reason: '归属备注',
        request_key: 'key-acct-legacy-113',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get()).toEqual({ n: 0 })
    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_legacy_links').get(),
    ).toEqual({ n: 0 })
  })

  it('included_in_opening=false：正常扣减 used，超额被拒', async () => {
    const { accountId, cycleId } = await setupWithOpening(0)
    const out = await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages',
      source_id: 'bu-legacy-2',
      account_id: accountId,
      cycle_id: cycleId,
      card_id: f.cards.selfMain,
      used_on: '2026-10-08',
      quantity: 2,
      amount_minor: 0,
      included_in_opening: false,
      reason: '未含在核对中',
      request_key: 'key-acct-legacy-114',
    })
    expect(out.included_in_opening).toBe(false)
    const cycle = db.raw
      .prepare('SELECT used_count FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as Record<string, number>
    expect(cycle.used_count).toBe(2)

    // Same source twice → refused (one mapping per source row).
    await expect(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages',
        source_id: 'bu-legacy-2',
        account_id: accountId,
        cycle_id: cycleId,
        card_id: f.cards.selfMain,
        used_on: '2026-10-08',
        quantity: 2,
        amount_minor: 0,
        included_in_opening: false,
        reason: '归属备注',
        request_key: 'key-acct-legacy-115',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('越权账户拒绝', async () => {
    const { accountId, cycleId } = await setupWithOpening(3)
    await expect(
      assignLegacyUsage(actorAdminB, {
        source_table: 'benefit_usages',
        source_id: 'bu-legacy-2',
        account_id: accountId,
        cycle_id: cycleId,
        card_id: f.cards.selfMain,
        used_on: '2026-10-08',
        quantity: 1,
        amount_minor: 0,
        included_in_opening: true,
        reason: '归属备注',
        request_key: 'key-acct-legacy-116',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' })
  })
})

describe('updateOpportunityCycleWorkflow', () => {
  it('per_cycle 规则可录入该批次的绝对窗口，事件与 revision 跟进', async () => {
    const { defId } = await seedDefinition(db, makeRules({ workflow_time_basis: 'per_cycle' }))
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-wf-00117',
    })
    const cycleId = out.cycle!.id
    const res = await updateOpportunityCycleWorkflow(actorAdminA, {
      cycle_id: cycleId,
      claim_window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-31T23:59:59Z' },
      booking_window: null,
      reason: '按 10 月批次录入',
      expected_revision: 1,
      request_key: 'key-acct-wf-00118',
    })
    expect(res.revision).toBe(2)
    const row = db.raw
      .prepare('SELECT workflow_json, revision FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as { workflow_json: string; revision: number }
    expect(JSON.parse(row.workflow_json)).toEqual({
      claim_window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-31T23:59:59Z' },
    })
    expect(row.revision).toBe(2)
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM opportunity_events WHERE event_type = 'cycle.workflow_updated'").get(),
    ).toEqual({ n: 1 })
  })

  it('fixed 规则不允许录入批次窗口', async () => {
    const ctx = await setupAccount('key-acct-wf-00119') // makeRules default: fixed
    await expect(
      updateOpportunityCycleWorkflow(actorAdminA, {
        cycle_id: ctx.cycleId,
        claim_window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-31T23:59:59Z' },
        booking_window: null,
        reason: null,
        expected_revision: 1,
        request_key: 'key-acct-wf-00120',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('revision 不匹配拒绝', async () => {
    const { defId } = await seedDefinition(db, makeRules({ workflow_time_basis: 'per_cycle' }))
    const out = await createOpportunityAccount(actorAdminA, {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: 'key-acct-wf-00121',
    })
    await expect(
      updateOpportunityCycleWorkflow(actorAdminA, {
        cycle_id: out.cycle!.id,
        claim_window: null,
        booking_window: { opens_at: '2026-10-20T00:00:00Z', closes_at: '2026-10-30T00:00:00Z' },
        reason: null,
        expected_revision: 9,
        request_key: 'key-acct-wf-00122',
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })
})

// ---------------------------------------------------------------------------
// credit_cards.issued_on / activated_on (Task 7 step 4)
// ---------------------------------------------------------------------------

import { createCard, updateCard, getCardsByHolder } from '../api/cards.server'

describe('card issued_on/activated_on', () => {
  it('创建时保存，读取返回；更新不传保持不变，显式传 null 清空', async () => {
    const created = await createCard({
      holder_id: f.holders.self,
      card_product_id: f.products.cmbClassic,
      card_number_last4: '7777',
      credit_limit: 10000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      issued_on: '2024-02-29',
      activated_on: null,
    } as never)
    expect(created.issued_on).toBe('2024-02-29')
    expect(created.activated_on).toBeNull()

    // A patch that omits the fields leaves them untouched (old callers).
    await updateCard(created.id, { credit_limit: 20000 })
    const cards = await getCardsByHolder(f.holders.self)
    const row = cards.find((c) => c.id === created.id)!
    expect(row.issued_on).toBe('2024-02-29')

    // Explicit null clears.
    await updateCard(created.id, { issued_on: null })
    const cleared = (await getCardsByHolder(f.holders.self)).find((c) => c.id === created.id)!
    expect(cleared.issued_on).toBeNull()
  })
})
