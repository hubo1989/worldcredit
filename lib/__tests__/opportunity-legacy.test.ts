// lib/__tests__/opportunity-legacy.test.ts — Task 10: legacy catalog wrap,
// attribution and compat adapters (tech spec §6.3/§11), against real SQLite:
//   0015 wrap     — definitions/versions appear once, unverified, no fake
//                   maintainer, rules parse, promos prove their own start
//   unassigned   — admin-only, notes never leak for holder-less rows, promo
//                   rows stay inside the caller's holder scope
//   assignment   — once per source, opening reclassification keeps the
//                   verified total constant, scope/verification refusals
//   compat writes — recordBenefitUsage adapter (unique→ledger, ambiguous,
//                   no-account), delete→archive keeps old rows, mergeHolders
//                   blocked by ledger dependencies
//   backfill     — script dry-run classifies, --apply writes exactly once,
//                   re-run is a no-op

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, wrapLegacyCatalog, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { DatabaseSync } from 'node:sqlite'
import {
  getUnassignedLegacyUsages,
  assignLegacyUsage,
} from '../opportunities/legacy.server'
import { createOpportunityAccount, confirmOpeningBalance } from '../opportunities/accounts.server'
import { deleteBenefit, getAllMyBenefits, recordBenefitUsage } from '../api/benefits.server'
import { deletePromo } from '../api/admin.server'
import { mergeHolders } from '../api/holders.server'
import { reconcileOpportunityCycle } from '../opportunities/writes.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'
// The backfill script is plain ESM JavaScript (no TS runner exists for
// scripts/); TS infers loose types from it, so summary/failed accesses below
// cast to the shapes the script actually returns.
import {
  applyLocalMigrations,
  wrapLegacyCatalog as scriptWrap,
  classifyPromoUsages,
  applyPromoBackfill,
} from '../../scripts/opportunities-backfill.mjs'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }
const actorMemberA: OpportunityActor = { user_id: f.users.memberA, role: 'member' }

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  wrapLegacyCatalog(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

// ---------------------------------------------------------------------------
// 0015 catalog wrap
// ---------------------------------------------------------------------------

describe('0015 legacy catalog wrap', () => {
  it('每条旧 benefit/promo 恰好包装一个 unverified 定义，created_by 不伪造', () => {
    for (const [table, column, kind] of [
      ['benefits', 'legacy_benefit_id', 'benefit'],
      ['promos', 'legacy_promo_id', 'promo'],
    ] as const) {
      const rows = db.raw.prepare(`SELECT id FROM ${table}`).all() as { id: string }[]
      expect(rows.length).toBeGreaterThan(0)
      for (const { id } of rows) {
        const def = db.raw
          .prepare(`SELECT kind, visibility, status, created_by FROM opportunity_definitions WHERE ${column} = ?`)
          .get(id) as { kind: string; visibility: string; status: string; created_by: string | null }
        expect(def).toBeTruthy()
        expect(def.kind).toBe(kind)
        expect(def.visibility).toBe('shared')
        expect(def.created_by).toBeNull() // 不伪造 migration actor
        const version = db.raw
          .prepare(`SELECT verification, rules_json FROM opportunity_rule_versions WHERE definition_id = (SELECT id FROM opportunity_definitions WHERE ${column} = ?)`)
          .get(id) as { verification: string; rules_json: string }
        expect(version.verification).toBe('unverified')
        expect(() => JSON.parse(version.rules_json)).not.toThrow()
      }
    }
  })

  it('promo 用自身 start_date 作可证明生效日；benefit 未知则用迁移日', () => {
    const promoVersion = db.raw
      .prepare(
        `SELECT effective_from FROM opportunity_rule_versions
         WHERE definition_id = (SELECT id FROM opportunity_definitions WHERE legacy_promo_id = ?)`,
      )
      .get(f.promos.live) as { effective_from: string }
    expect(promoVersion.effective_from).toBe('2026-10-01')

    const migrationDate = db.raw.prepare(`SELECT date('now') AS d`).get() as { d: string }
    const benefitVersion = db.raw
      .prepare(
        `SELECT effective_from FROM opportunity_rule_versions
         WHERE definition_id = (SELECT id FROM opportunity_definitions WHERE legacy_benefit_id = ?)`,
      )
      .get(f.benefits.cmbLifeMovie) as { effective_from: string }
    expect(benefitVersion.effective_from).toBe(migrationDate.d)
  })

  it('重复执行不增加任何行', () => {
    const countDefs = () =>
      (db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_definitions').get() as { n: number }).n
    const before = countDefs()
    wrapLegacyCatalog(db)
    wrapLegacyCatalog(db)
    expect(countDefs()).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Unassigned legacy usages
// ---------------------------------------------------------------------------

async function seedBenefitUsageRow(id: string, note: string) {
  db.raw
    .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at, note) VALUES (?,?,?,?)')
    .run(id, f.benefits.cmbLifeMovie, '2026-10-05', note)
}

describe('getUnassignedLegacyUsages', () => {
  it('管理员看到未归属行但绝不返回备注；成员统一拒绝', async () => {
    await seedBenefitUsageRow('bu-1', '私人备注内容')
    const page = await getUnassignedLegacyUsages(actorAdminA, {})
    const row = page.items.find((i) => i.source_id === 'bu-1')
    expect(row).toBeTruthy()
    expect(row!.note).toBeNull()
    expect(row!.source_table).toBe('benefit_usages')
    await expect(getUnassignedLegacyUsages(actorMemberA, {})).rejects.toBeInstanceOf(OpportunityError)
  })

  it('promo 行按持卡人 scope 过滤，越界行不可见', async () => {
    db.raw
      .prepare('INSERT INTO promo_usages (id, promo_id, card_id, used_at, note) VALUES (?,?,?,?,?)')
      .run('pu-self', f.promos.live, f.cards.selfMain, '2026-10-10', '我的记录')
    db.raw
      .prepare('INSERT INTO promo_usages (id, promo_id, card_id, used_at, note) VALUES (?,?,?,?,?)')
      .run('pu-adminb', f.promos.live, f.cards.adminBUsd, '2026-10-11', 'B 的记录')
    const mine = await getUnassignedLegacyUsages(actorAdminA, {})
    expect(mine.items.map((i) => i.source_id)).toEqual(['pu-self'])
    expect(mine.items[0].note).toBe('我的记录') // 卡可证明归属，scope 内可见
    const theirs = await getUnassignedLegacyUsages(actorAdminB, {})
    expect(theirs.items.map((i) => i.source_id)).toEqual(['pu-adminb'])
  })

  it('已归属的行不再出现', async () => {
    await seedBenefitUsageRow('bu-mapped', 'x')
    await seedBenefitUsageRow('bu-open', 'y')
    const { accountId } = await setupAccountOnDefinition()
    await assignLegacyUsage(
      actorAdminA,
      {
        source_table: 'benefit_usages', source_id: 'bu-mapped', account_id: accountId,
        card_id: f.cards.selfMain, included_in_opening: false, reason: '纸质对账单',
        request_key: rk('mapped'),
      },
      { now: NOW },
    )
    const page = await getUnassignedLegacyUsages(actorAdminA, {})
    expect(page.items.map((i) => i.source_id)).toEqual(['bu-open'])
  })
})

// ---------------------------------------------------------------------------
// assignLegacyUsage
// ---------------------------------------------------------------------------

const movieRules = (): RuleSnapshotV1 => ({
  schema_version: 1,
  title: '观影优惠',
  description: null,
  category: 'other',
  time_zone: 'Asia/Shanghai',
  bank_id: null,
  card_product_ids: [f.products.cmbClassic],
  valid_from: null,
  valid_until_before: null,
  open_ended: true,
  weekdays: null,
  cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
  allocation: 'recurring',
  count_limit: 4,
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
})

let seq = 0
const rk = (tag: string) => `legacy-rk-${tag}-${String(++seq).padStart(4, '0')}`

/** Fresh definition + account on c-self-main with the current cycle. */
async function setupAccountOnDefinition(rules: RuleSnapshotV1 = movieRules()) {
  const n = ++seq
  const defId = `odef-legacy-${n}`
  const versionId = `orv-legacy-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(rules)),
  ])
  const created = await createOpportunityAccount(
    actorAdminA,
    {
      definition_id: defId,
      holder_id: f.holders.self,
      card_ids: [f.cards.selfMain],
      scope_kind: 'card',
      request_key: rk('account'),
    },
    { now: NOW },
  )
  if (!created.cycle) throw new Error('setupAccount: no cycle')
  return { defId, accountId: created.account.id, cycleId: created.cycle.id }
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(OpportunityError)
    expect((err as OpportunityError).code).toBe(code)
    return true
  })
}

describe('assignLegacyUsage', () => {
  it('普通归属：写 usage + link，used+1，事件与投影一致', async () => {
    const { accountId, cycleId } = await setupAccountOnDefinition()
    await seedBenefitUsageRow('bu-assign-1', '备注')
    const result = await assignLegacyUsage(
      actorAdminA,
      {
        source_table: 'benefit_usages',
        source_id: 'bu-assign-1',
        account_id: accountId,
        card_id: f.cards.selfMain,
        included_in_opening: false,
        reason: '银行 APP 截图核对',
        request_key: rk('assign'),
      },
      { now: NOW },
    )
    expect(result.reclassified).toBe(false)
    const cycle = db.raw
      .prepare('SELECT used_count, opening_used_count FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as { used_count: number; opening_used_count: number }
    expect(cycle.used_count).toBe(1)
    expect(cycle.opening_used_count).toBe(0)
    const link = db.raw
      .prepare('SELECT included_in_opening FROM opportunity_legacy_links WHERE source_id = ?')
      .get('bu-assign-1') as { included_in_opening: number }
    expect(link.included_in_opening).toBe(0)
    const recon = await reconcileOpportunityCycle(actorAdminA, cycleId)
    expect(recon.ok).toBe(true)
  })

  it('先核对 3 次后归属其中 1 次：总耗用仍为 3（opening−1/used+1）', async () => {
    const { accountId, cycleId } = await setupAccountOnDefinition()
    const cycleBefore = db.raw
      .prepare('SELECT revision FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as { revision: number }
    await confirmOpeningBalance(
      actorAdminA,
      {
        cycle_id: cycleId,
        opening_used_count: 3,
        opening_used_minor: 0,
        as_of_on: '2026-10-15',
        reason: '银行 APP 总耗用 3 次',
        expected_revision: cycleBefore.revision,
        request_key: rk('opening'),
      },
      { now: NOW },
    )
    await seedBenefitUsageRow('bu-assign-2', 'x')
    const result = await assignLegacyUsage(
      actorAdminA,
      {
        source_table: 'benefit_usages',
        source_id: 'bu-assign-2',
        account_id: accountId,
        card_id: f.cards.selfMain,
        included_in_opening: true,
        reason: '该次已包含在核对总额中',
        request_key: rk('reclass'),
      },
      { now: NOW },
    )
    expect(result.reclassified).toBe(true)
    const cycle = db.raw
      .prepare('SELECT used_count, opening_used_count FROM opportunity_cycles WHERE id = ?')
      .get(cycleId) as { used_count: number; opening_used_count: number }
    expect(cycle.used_count).toBe(1)
    expect(cycle.opening_used_count).toBe(2)
    expect(cycle.used_count + cycle.opening_used_count).toBe(3)
    const link = db.raw
      .prepare('SELECT included_in_opening, offset_opening_count FROM opportunity_legacy_links WHERE source_id = ?')
      .get('bu-assign-2') as { included_in_opening: number; offset_opening_count: number }
    expect(link.included_in_opening).toBe(1)
    expect(link.offset_opening_count).toBe(1)
  })

  it('期初不足/未核对/重复归属/越权/重放各有明确错误', async () => {
    const worldA = await setupAccountOnDefinition()
    const worldB = await setupAccountOnDefinition()
    await seedBenefitUsageRow('bu-a1', 'x')
    await seedBenefitUsageRow('bu-a2', 'x')
    await seedBenefitUsageRow('bu-a3', 'x')

    // 未核对 → NEEDS_CONFIRMATION
    await rejects(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages', source_id: 'bu-a1', account_id: worldA.accountId,
        card_id: f.cards.selfMain, included_in_opening: true, reason: 'r',
        request_key: rk('unverified'),
      }, { now: NOW }),
      'NEEDS_CONFIRMATION')

    // 核对 1 次后 included 归属 2 次 → 第二次期初不足
    const rev = db.raw.prepare('SELECT revision FROM opportunity_cycles WHERE id = ?').get(worldA.cycleId) as { revision: number }
    await confirmOpeningBalance(actorAdminA, {
      cycle_id: worldA.cycleId, opening_used_count: 1, opening_used_minor: 0,
      as_of_on: '2026-10-15', reason: 'r', expected_revision: rev.revision, request_key: rk('open1'),
    }, { now: NOW })
    await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages', source_id: 'bu-a1', account_id: worldA.accountId,
      card_id: f.cards.selfMain, included_in_opening: true, reason: 'r', request_key: rk('inc1'),
    }, { now: NOW })
    await rejects(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages', source_id: 'bu-a2', account_id: worldA.accountId,
        card_id: f.cards.selfMain, included_in_opening: true, reason: 'r', request_key: rk('inc2'),
      }, { now: NOW }),
      'QUOTA_EXCEEDED')

    // 重复归属同一源 → INVALID_TRANSITION
    await rejects(
      assignLegacyUsage(actorAdminA, {
        source_table: 'benefit_usages', source_id: 'bu-a1', account_id: worldA.accountId,
        card_id: f.cards.selfMain, included_in_opening: false, reason: 'r', request_key: rk('dup'),
      }, { now: NOW }),
      'INVALID_TRANSITION')

    // 越权账户（admin B 的世界）→ FORBIDDEN_OR_NOT_FOUND
    await rejects(
      assignLegacyUsage(actorAdminB, {
        source_table: 'benefit_usages', source_id: 'bu-a3', account_id: worldA.accountId,
        card_id: f.cards.selfMain, included_in_opening: false, reason: 'r', request_key: rk('xadmin'),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND')

    // 同 key 重放返回已提交结果
    const replayKey = rk('replay')
    const first = await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages', source_id: 'bu-a3', account_id: worldB.accountId,
      card_id: f.cards.selfMain, included_in_opening: false, reason: 'r', request_key: replayKey,
    }, { now: NOW })
    const replayed = await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages', source_id: 'bu-a3', account_id: worldB.accountId,
      card_id: f.cards.selfMain, included_in_opening: false, reason: 'r', request_key: replayKey,
    }, { now: NOW })
    expect(replayed.usage_id).toBe(first.usage_id)
  })
})

// ---------------------------------------------------------------------------
// Compat adapters
// ---------------------------------------------------------------------------

describe('recordBenefitUsage compat adapter', () => {
  it('零账户 → NEEDS_CONFIRMATION；多账户 → AMBIGUOUS_ACCOUNT', async () => {
    await rejects(
      recordBenefitUsage(actorAdminA, { benefit_id: f.benefits.cmbClassicLounge, used_at: '2026-10-15' }),
      'NEEDS_CONFIRMATION')

    // 两个 holder 各建一个账户 → 多解（cmbClassicLounge 适用 cmbClassic）
    const defId = (db.raw
      .prepare('SELECT id FROM opportunity_definitions WHERE legacy_benefit_id = ?')
      .get(f.benefits.cmbClassicLounge) as { id: string }).id
    await createOpportunityAccount(actorAdminA, {
      definition_id: defId, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk('acc1'),
    }, { now: NOW })
    await createOpportunityAccount(actorAdminA, {
      definition_id: defId, holder_id: f.holders.family,
      card_ids: [f.cards.familyClassic], scope_kind: 'card', request_key: rk('acc2'),
    }, { now: NOW })
    await rejects(
      recordBenefitUsage(actorAdminA, { benefit_id: f.benefits.cmbClassicLounge, used_at: '2026-10-15' }),
      'AMBIGUOUS_ACCOUNT')
  })
})

describe('delete → archive adapters', () => {
  it('deleteBenefit/deletePromo 保留旧行并归档包装定义，重复调用幂等', async () => {
    await deleteBenefit(f.benefits.cmbLifeMovie)
    await deletePromo(f.promos.live)
    await deleteBenefit(f.benefits.cmbLifeMovie)

    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM benefits WHERE id = ?').get(f.benefits.cmbLifeMovie) as { n: number }).n).toBe(1)
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM promos WHERE id = ?').get(f.promos.live) as { n: number }).n).toBe(1)
    const defB = db.raw
      .prepare('SELECT status, revision FROM opportunity_definitions WHERE legacy_benefit_id = ?')
      .get(f.benefits.cmbLifeMovie) as { status: string; revision: number }
    expect(defB.status).toBe('archived')
    expect(defB.revision).toBe(2) // 只加一次
    const defP = db.raw
      .prepare('SELECT status FROM opportunity_definitions WHERE legacy_promo_id = ?')
      .get(f.promos.live) as { status: string }
    expect(defP.status).toBe('archived')
  })
})

describe('mergeHolders protection', () => {
  it('源持卡人名下有权账本账户时返回业务冲突且不合并', async () => {
    await setupAccountOnDefinition()
    await expect(
      mergeHolders(f.holders.family, [f.holders.self]),
    ).rejects.toThrow(/权益台账账户/)
  })
})

describe('getAllMyBenefits compat additions', () => {
  it('accounts 字段按 scope 过滤；已归属旧行不双算', async () => {
    // 未复核的 0015 包装规则 effective_from=迁移日：早于该日的旧行按规范不可
    // 回填（不编造过去资格），因此本例用迁移日当天及之后的日期。
    const today = (db.raw.prepare(`SELECT date('now') AS d`).get() as { d: string }).d
    db.raw
      .prepare('INSERT INTO benefit_usages (id, benefit_id, used_at, note) VALUES (?,?,?,?)')
      .run('bu-count', f.benefits.cmbLifeMovie, today, 'x')

    const defId = (db.raw
      .prepare('SELECT id FROM opportunity_definitions WHERE legacy_benefit_id = ?')
      .get(f.benefits.cmbLifeMovie) as { id: string }).id
    const created = await createOpportunityAccount(actorAdminA, {
      definition_id: defId, holder_id: f.holders.self,
      card_ids: [f.cards.selfSecond], scope_kind: 'card', request_key: rk('count-acc'),
    }, { now: NOW })
    if (!created.cycle) throw new Error('no cycle')

    // 旧行未归属 → usage_count 计 1
    let mine = await getAllMyBenefits(f.users.adminA, today)
    const movie = mine.find((b) => b.id === f.benefits.cmbLifeMovie)!
    expect(movie.usage_count).toBe(1)
    expect(movie.accounts.map((a) => a.id)).toEqual([created.account.id])

    // 归属后（included=false）：旧行移出计数，新流水计 1 —— 总数不变
    await assignLegacyUsage(actorAdminA, {
      source_table: 'benefit_usages', source_id: 'bu-count', account_id: created.account.id,
      card_id: f.cards.selfSecond, included_in_opening: false, reason: '核对', request_key: rk('count-assign'),
    }, { now: NOW })
    mine = await getAllMyBenefits(f.users.adminA, today)
    expect(mine.find((b) => b.id === f.benefits.cmbLifeMovie)!.usage_count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Backfill script
// ---------------------------------------------------------------------------

describe('scripts/opportunities-backfill.mjs', () => {
  let scriptDb: DatabaseSync

  beforeEach(() => {
    scriptDb = new DatabaseSync(':memory:')
    scriptDb.exec('PRAGMA foreign_keys = ON')
    applyLocalMigrations(scriptDb)
    // Same fixture world, written through raw statements (script sees SQL only)
    scriptDb
      .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)`)
      .run(f.users.adminA, 'a@example.test', 'x', 'A', 'admin')
    scriptDb.prepare(`INSERT INTO banks (id, name, country) VALUES (?,?,?)`).run(f.banks.cmb, '招商银行', 'CN')
    scriptDb
      .prepare(`INSERT INTO card_products (id, bank_id, bank_name, card_name, currency) VALUES (?,?,?,?,?)`)
      .run(f.products.cmbClassic, f.banks.cmb, '招商银行', '经典白金卡', 'CNY')
    scriptDb
      .prepare(`INSERT INTO card_products (id, bank_id, bank_name, card_name, currency) VALUES (?,?,?,?,?)`)
      .run(f.products.cmbLife, f.banks.cmb, '招商银行', '生活卡', 'CNY')
    scriptDb
      .prepare(`INSERT INTO card_holders (id, created_by, managed_by, name) VALUES (?,?,?,?)`)
      .run(f.holders.self, f.users.adminA, f.users.adminA, '我')
    scriptDb
      .prepare(`INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type) VALUES (?,?,?,?,?,?,?,?)`)
      .run(f.cards.selfMain, f.holders.self, f.products.cmbClassic, '0001', 50000, 5, 'active', 'credit')
    scriptDb
      .prepare(`INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,1)`)
      .run(f.promos.live, f.products.cmbClassic, f.banks.cmb, '招商银行', '经典白金餐饮 5 折', '2026-10-01', '2026-12-31')
    scriptDb
      .prepare(`INSERT INTO benefits (id, card_product_id, name, quota, period) VALUES (?,?,?,?,?)`)
      .run(f.benefits.cmbLifeMovie, f.products.cmbLife, '观影优惠', 2, 'monthly')
    scriptDb
      .prepare(`INSERT INTO benefit_usages (id, benefit_id, used_at) VALUES ('bu-x',?,'2026-10-05')`)
      .run(f.benefits.cmbLifeMovie)
    scriptWrap(scriptDb)
  })

  afterEach(() => {
    scriptDb.close()
  })

  it('dry-run 分类：可映射/无卡/窗口外/产品不匹配，且不写任何数据', () => {
    scriptDb
      .prepare(`INSERT INTO promo_usages (id, promo_id, card_id, used_at) VALUES (?,?,?,?)`)
      .run('pu-ok', f.promos.live, f.cards.selfMain, '2026-10-10')
    scriptDb
      .prepare(`INSERT INTO promo_usages (id, promo_id, card_id, used_at) VALUES (?,?,?,?)`)
      .run('pu-nocard', f.promos.live, null, '2026-10-10')
    scriptDb
      .prepare(`INSERT INTO promo_usages (id, promo_id, card_id, used_at) VALUES (?,?,?,?)`)
      .run('pu-outside', f.promos.live, f.cards.selfMain, '2026-09-15')
    const { rows, summary } = classifyPromoUsages(scriptDb)
    const statusOf = (id: string) =>
      (rows as Array<{ source_id: string; status: string }>).find((r) => r.source_id === id)?.status
    expect(statusOf('pu-ok')).toBe('would_map')
    expect(statusOf('pu-nocard')).toBe('needs_review')
    expect(statusOf('pu-outside')).toBe('needs_review')
    expect(summary.would_map).toBe(1)
    expect(summary.needs_review).toBe(2)
    expect((summary.by_reason as Record<string, number>).no_card).toBe(1)
    expect((summary.by_reason as Record<string, number>).outside_window).toBe(1)
    expect(summary.benefit_usages_never_auto_mapped).toBe(1)
    expect(
      (scriptDb.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get() as { n: number }).n,
    ).toBe(0)
  })

  it('--apply 建账户/周期/流水/链接，事件可对账；重复执行零新增', () => {
    scriptDb
      .prepare(`INSERT INTO promo_usages (id, promo_id, card_id, used_at) VALUES (?,?,?,?)`)
      .run('pu-apply', f.promos.live, f.cards.selfMain, '2026-10-10')
    const result = applyPromoBackfill(scriptDb, { now: NOW })
    expect(result.mapped).toBe(1)
    expect(result.failed).toEqual([])

    const cycle = scriptDb
      .prepare('SELECT id, used_count FROM opportunity_cycles')
      .get() as { id: string; used_count: number }
    expect(cycle.used_count).toBe(1)
    const account = scriptDb
      .prepare('SELECT holder_id, scope_kind, scope_key FROM opportunity_accounts')
      .get() as { holder_id: string; scope_kind: string; scope_key: string }
    expect(account.holder_id).toBe(f.holders.self)
    expect(account.scope_key).toBe(`card:${f.cards.selfMain}`)
    expect(
      (scriptDb.prepare('SELECT COUNT(*) AS n FROM opportunity_legacy_links').get() as { n: number }).n,
    ).toBe(1)
    // events replay == cycle projection
    const replayed = scriptDb
      .prepare('SELECT COALESCE(SUM(delta_used_count),0) AS n FROM opportunity_events')
      .get() as { n: number }
    expect(replayed.n).toBe(cycle.used_count)

    const rerun = applyPromoBackfill(scriptDb, { now: NOW })
    expect(rerun.mapped).toBe(0)
    expect(
      (scriptDb.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get() as { n: number }).n,
    ).toBe(1)
  })

  it('命令键防重放：外部删除链接后重跑不产生第二份流水', () => {
    scriptDb
      .prepare(`INSERT INTO promo_usages (id, promo_id, card_id, used_at) VALUES (?,?,?,?)`)
      .run('pu-fail', f.promos.live, f.cards.selfMain, '2026-10-10')
    const first = applyPromoBackfill(scriptDb, { now: NOW })
    expect(first.mapped).toBe(1)
    // 外部干预删除链接：分类重新看到该行，但命令表的同 key 唯一约束使第二次
    // 写入失败上报，而不是悄悄产生第二份使用记录
    scriptDb.prepare(`DELETE FROM opportunity_legacy_links WHERE source_id = 'pu-fail'`).run()
    const second = applyPromoBackfill(scriptDb, { now: NOW })
    expect(second.mapped).toBe(0)
    expect(second.failed).toHaveLength(1)
    expect((second.failed as Array<{ source_id: string }>)[0].source_id).toBe('pu-fail')
    expect(
      (scriptDb.prepare('SELECT COUNT(*) AS n FROM opportunity_usages').get() as { n: number }).n,
    ).toBe(1)
    expect(
      (scriptDb.prepare('SELECT COUNT(*) AS n FROM opportunity_write_checks').get() as { n: number }).n,
    ).toBe(0)
  })
})
