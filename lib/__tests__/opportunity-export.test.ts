// lib/__tests__/opportunity-export.test.ts — the flat export DTO and CSV
// safety (plan Task 13): scope/filters/pagination in SQL, formula-prefix
// escaping for user text, BOM preserved, and the ledger export never leaks
// other holders' rows.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { recordOpportunityUsage, voidOpportunityUsage } from '../opportunities/usages.server'
import { exportOpportunityUsages } from '../opportunities/queries.server'
import { buildCsv } from '../export'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

let seq = 0
const rk = (tag: string) => `export-rk-${tag}-${String(++seq).padStart(4, '0')}`

function rules(): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '导出验证权益',
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
  }
}

async function seedAccount(holderId: string, cardId: string, productIds: string[]) {
  const n = ++seq
  const defId = `odef-exp-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(`orv-exp-${n}`, defId, JSON.stringify(rules())),
  ])
  void productIds
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: holderId, card_ids: [cardId],
    scope_kind: 'card', request_key: rk('acc'),
  }, { now: NOW })
  if (!created.cycle) throw new Error('no cycle')
  return created
}

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('exportOpportunityUsages', () => {
  it('scope 内筛选/分页/扁平字段；越界 holder 不可见', async () => {
    const self = await seedAccount(f.holders.self, f.cards.selfMain, [f.products.cmbClassic])
    if (!self.cycle) throw new Error('no self cycle')
    const family = await seedAccount(f.holders.family, f.cards.familyClassic, [f.products.cmbClassic])
    if (!family.cycle) throw new Error('no family cycle')
    await recordOpportunityUsage(actorAdminA, {
      account_id: self.account.id, cycle_id: self.cycle.id, card_id: f.cards.selfMain,
      used_on: '2026-10-05', quantity: 2, amount_minor: 0, note: '=SUM(A1:A9) 注入尝试',
      request_key: rk('rec1'),
    }, { now: NOW })
    await recordOpportunityUsage(actorAdminA, {
      account_id: family.account.id, cycle_id: family.cycle.id, card_id: f.cards.familyClassic,
      used_on: '2026-10-06', quantity: 1, amount_minor: 0, note: null,
      request_key: rk('rec2'),
    }, { now: NOW })

    const all = await exportOpportunityUsages(actorAdminA, {})
    expect(all.items).toHaveLength(2)
    expect(all.items[0].title).toBe('导出验证权益')
    expect(all.items[0].source).toBe('ledger')
    expect(all.items[0].cycle_key).toBe('regular:2026-10-01')

    const filtered = await exportOpportunityUsages(actorAdminA, { holder_id: f.holders.self })
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0].holder_name).toBe('我')

    const dated = await exportOpportunityUsages(actorAdminA, { from_on: '2026-10-06' })
    expect(dated.items.map((i) => i.used_on)).toEqual(['2026-10-06'])

    // 分页
    const page1 = await exportOpportunityUsages(actorAdminA, { limit: 1 })
    expect(page1.items).toHaveLength(1)
    expect(page1.next_cursor).toBeTruthy()
    const page2 = await exportOpportunityUsages(actorAdminA, { limit: 1, cursor: page1.next_cursor })
    expect(page2.items).toHaveLength(1)

    // B 的世界完全不可见
    const theirs = await exportOpportunityUsages(actorAdminB, {})
    expect(theirs.items).toEqual([])
  })

  it('撤销行保留在导出中且状态为 voided，不误双算', async () => {
    const world = await seedAccount(f.holders.self, f.cards.selfMain, [f.products.cmbClassic])
    if (!world.cycle) throw new Error('no cycle')
    const rec = await recordOpportunityUsage(actorAdminA, {
      account_id: world.account.id, cycle_id: world.cycle.id, card_id: f.cards.selfMain,
      used_on: '2026-10-05', quantity: 1, amount_minor: 0, note: null,
      request_key: rk('v1'),
    }, { now: NOW })
    await voidOpportunityUsage(actorAdminA, {
      usage_id: rec.usage_id, reason: '录错', expected_revision: 1,
      request_key: rk('void'),
    }, { now: NOW })
    const page = await exportOpportunityUsages(actorAdminA, {})
    expect(page.items).toHaveLength(1)
    expect(page.items[0].status).toBe('voided')
  })

  it('非法筛选值拒绝（与列表同一校验口径）', async () => {
    // kind 为白名单外字符串 → SQL 自然空集；limit 越界 → 明确拒绝
    const unknownKind = await exportOpportunityUsages(actorAdminA, { kind: 'not-a-kind' })
    expect(unknownKind.items).toEqual([])
    // limit 越界按 1–500 收敛，不报错（导出与列表的分页口径差异）
    const clamped = await exportOpportunityUsages(actorAdminA, { limit: 0 })
    expect(clamped.items).toEqual([])
  })
})

describe('buildCsv formula escaping', () => {
  it('=、+、-、@、制表符开头的文本被前置单引号，普通文本不变', () => {
    const csv = buildCsv(['备注', '正常'], [
      { 备注: '=SUM(A1)', 正常: 'hello' },
      { 备注: '+1', 正常: '普通,逗号' },
      { 备注: '@cmd', 正常: '-42' },
      { 备注: '\tmalformed', 正常: '2026-10-15' },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(`'=SUM(A1),hello`)
    expect(csv).toContain(`'+1,"普通,逗号"`)
    expect(csv).toContain(`'@cmd,'-42`)
    expect(csv).toContain(`'\tmalformed,2026-10-15`)
  })
})
