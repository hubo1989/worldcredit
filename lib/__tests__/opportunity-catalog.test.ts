// lib/__tests__/opportunity-catalog.test.ts — reviewed catalog writes (plan
// Task 13): candidates never touch the DB, official_verified demands a source,
// shared-catalog writes are admin-only, new versions close the previous open
// one atomically (with the future-cycle guard), and archiving keeps history.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, wrapLegacyCatalog, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  previewOpportunityCandidates,
  publishOpportunityVersion,
  archiveOpportunityDefinition,
} from '../opportunities/catalog.server'
import { createOpportunityAccount, materializeCycleForDate } from '../opportunities/accounts.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorMemberA: OpportunityActor = { user_id: f.users.memberA, role: 'member' }

let seq = 0
const rk = (tag: string) => `catalog-rk-${tag}-${String(++seq).padStart(4, '0')}`

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '贵宾厅（复核版）',
    description: null,
    category: 'travel',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
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
    ...over,
  }
}

function countDefs(): number {
  return (db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_definitions').get() as { n: number }).n
}

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

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(OpportunityError)
    expect((err as OpportunityError).code).toBe(code)
    return true
  })
}

describe('previewOpportunityCandidates', () => {
  it('成员拒绝；无 AI 配置时报错且不写任何目录行', async () => {
    await rejects(
      previewOpportunityCandidates(actorMemberA, { bank_name: '招商银行', card_name: '经典白金卡' }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
    const before = countDefs()
    // No AI key configured in the fixture world → collection fails loudly.
    await expect(
      previewOpportunityCandidates(actorAdminA, { bank_name: '招商银行', card_name: '经典白金卡' }),
    ).rejects.toThrow(/AI|Key|配置/)
    expect(countDefs()).toBe(before) // 候选绝不落库
  })
})

describe('publishOpportunityVersion', () => {
  it('official_verified 必须带 http(s) 来源；user_confirmed 无来源可发布', async () => {
    await rejects(
      publishOpportunityVersion(actorAdminA, {
        rules: rules(), effective_from: '2026-11-01',
        verification: 'official_verified', request_key: rk('nosrc'),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
    const published = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-11-01',
      verification: 'user_confirmed', source_excerpt: '持卡人手册拍照核对',
      request_key: rk('ok'),
    }, { now: NOW })
    expect(published.version).toBe(1)
    const row = db.raw
      .prepare('SELECT verification, source_url, checked_by FROM opportunity_rule_versions WHERE id = ?')
      .get(published.version_id) as { verification: string; source_url: string | null; checked_by: string }
    expect(row.verification).toBe('user_confirmed')
    expect(row.source_url).toBeNull()
    expect(row.checked_by).toBe(f.users.adminA)
  })

  it('共享目录成员不可发布；私人定义限本人范围', async () => {
    await rejects(
      publishOpportunityVersion(actorMemberA, {
        rules: rules(), effective_from: '2026-11-01',
        verification: 'user_confirmed', request_key: rk('member-shared'),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
    // member 只能为自己绑定的 holder 建私人定义
    const mine = await publishOpportunityVersion(actorMemberA, {
      kind: 'private_reward', visibility: 'private', private_holder_id: f.holders.memberSelf,
      rules: rules({ title: '我的私人券' }), effective_from: '2026-11-01',
      verification: 'user_confirmed', request_key: rk('member-private'),
    }, { now: NOW })
    expect(mine.definition_id).toBeTruthy()
    // 他人 holder 拒绝
    await rejects(
      publishOpportunityVersion(actorMemberA, {
        kind: 'private_reward', visibility: 'private', private_holder_id: f.holders.self,
        rules: rules({ title: '越权' }), effective_from: '2026-11-01',
        verification: 'user_confirmed', request_key: rk('member-xholder'),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
  })

  it('新版本同批关闭旧 open 版本；旧周期不受影响', async () => {
    const first = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01',
      verification: 'user_confirmed', request_key: rk('v1'),
    }, { now: NOW })
    const created = await createOpportunityAccount(actorAdminA, {
      definition_id: first.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk('acc'),
    }, { now: NOW })
    expect(created.cycle).toBeTruthy()

    const second = await publishOpportunityVersion(actorAdminA, {
      definition_id: first.definition_id,
      rules: rules({ title: '贵宾厅 v2', count_limit: 8 }),
      effective_from: '2026-11-01',
      verification: 'official_verified', source_url: 'https://bank.example/benefits',
      request_key: rk('v2'),
    }, { now: NOW })
    expect(second.version).toBe(2)
    expect(second.closed_previous_version_id).toBe(first.version_id)
    const closed = db.raw
      .prepare('SELECT effective_until_before FROM opportunity_rule_versions WHERE id = ?')
      .get(first.version_id) as { effective_until_before: string }
    expect(closed.effective_until_before).toBe('2026-11-01')
    // 已生成周期保持原版本快照
    const cycleVersion = db.raw
      .prepare('SELECT version_id FROM opportunity_cycles WHERE id = ?')
      .get(created.cycle!.id) as { version_id: string }
    expect(cycleVersion.version_id).toBe(first.version_id)
  })

  it('已生成的未来周期与关闭区间冲突时整批失败', async () => {
    const first = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01',
      verification: 'user_confirmed', request_key: rk('g1'),
    }, { now: NOW })
    const created = await createOpportunityAccount(actorAdminA, {
      definition_id: first.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk('gacc'),
    }, { now: NOW })
    // 物化 12 月周期（未来），随后试图把 v1 关闭在 12-01 之前 → 冲突
    const dec = await materializeCycleForDate(actorAdminA, created.account.id, '2026-12-10', rk('dec'), { now: NOW })
    expect(dec).toBeTruthy()
    await rejects(
      publishOpportunityVersion(actorAdminA, {
        definition_id: first.definition_id,
        rules: rules({ title: 'v2 冲突' }), effective_from: '2026-11-01',
        verification: 'user_confirmed', request_key: rk('g2'),
      }, { now: NOW }),
      'CONFLICT',
    )
    // 冲突后 v1 仍 open，v2 不存在（整批回滚）
    const v1 = db.raw
      .prepare('SELECT effective_until_before FROM opportunity_rule_versions WHERE id = ?')
      .get(first.version_id) as { effective_until_before: string | null }
    expect(v1.effective_until_before).toBeNull()
    const versions = db.raw
      .prepare('SELECT COUNT(*) AS n FROM opportunity_rule_versions WHERE definition_id = ?')
      .get(first.definition_id) as { n: number }
    expect(versions.n).toBe(1)
  })
})

describe('archiveOpportunityDefinition', () => {
  it('revision CAS 生效，归档保留全部历史行，重复归档冲突', async () => {
    const published = await publishOpportunityVersion(actorAdminA, {
      rules: rules(), effective_from: '2026-01-01',
      verification: 'user_confirmed', request_key: rk('a1'),
    }, { now: NOW })
    await createOpportunityAccount(actorAdminA, {
      definition_id: published.definition_id, holder_id: f.holders.self,
      card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk('aacc'),
    }, { now: NOW })

    const result = await archiveOpportunityDefinition(actorAdminA, {
      definition_id: published.definition_id, reason: '银行下线该权益', expected_revision: 1,
    })
    expect(result.revision).toBe(2)

    const def = db.raw
      .prepare('SELECT status, termination_reason FROM opportunity_definitions WHERE id = ?')
      .get(published.definition_id) as { status: string; termination_reason: string }
    expect(def.status).toBe('archived')
    expect(def.termination_reason).toContain('下线')
    // 历史行全部保留
    expect(
      (db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_rule_versions WHERE definition_id = ?').get(published.definition_id) as { n: number }).n,
    ).toBe(1)
    expect(
      (db.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_accounts WHERE definition_id = ?').get(published.definition_id) as { n: number }).n,
    ).toBe(1)

    await rejects(
      archiveOpportunityDefinition(actorAdminA, {
        definition_id: published.definition_id, reason: '再次归档', expected_revision: 1,
      }),
      'REVISION_CONFLICT',
    )
  })
})
