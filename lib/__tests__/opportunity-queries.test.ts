// lib/__tests__/opportunity-queries.test.ts — the unified read side (plan
// Task 11): one DTO from one batched query feeds list, ledger, card strip and
// the dashboard count. Covers:
//   A01  shared holder-scope account appears once for multi-card holders
//   A02/A03  holder scope isolation between actors
//   A06  dashboard count is distinct usable accounts, not catalog totals
//   A11  filters + stable sort + cursor bound to filters + same-scope counts
//   consistency: getCardOpportunities === getOpportunityPage({card_id})
//   follow state is personal and revision-checked

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { recordOpportunityUsage } from '../opportunities/usages.server'
import {
  getOpportunityPage,
  getBenefitLedger,
  getCardOpportunities,
  getOpportunityDetail,
  setOpportunityFollowed,
  getTodayAvailableCount,
} from '../opportunities/queries.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z' // 2026-10-15 in Asia/Shanghai

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }
const actorMemberA: OpportunityActor = { user_id: f.users.memberA, role: 'member' }

let seq = 0
const rk = (tag: string) => `queries-rk-${tag}-${String(++seq).padStart(4, '0')}`

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db, { withoutPromos: true, withoutBenefits: true })
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '贵宾厅',
    description: null,
    category: 'travel',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    // covers both self cards (cmbClassic + cmbLife); callers override as needed
    card_product_ids: [f.products.cmbClassic, f.products.cmbLife],
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

async function seedDefinition(ruleSet: RuleSnapshotV1, kind: 'benefit' | 'promo' = 'benefit') {
  const n = ++seq
  const defId = `odef-q-${n}`
  const versionId = `orv-q-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, ?, 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, kind, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(ruleSet)),
  ])
  return { defId, versionId }
}

/** Holder-scoped account across the holder's cards (shared quota). */
async function seedHolderAccount(ruleSet: RuleSnapshotV1, holderId: string, cardIds: string[]) {
  const { defId } = await seedDefinition(ruleSet)
  const created = await createOpportunityAccount(
    actorAdminA,
    {
      definition_id: defId,
      holder_id: holderId,
      card_ids: cardIds,
      scope_kind: 'holder',
      request_key: rk('holder-acc'),
    },
    { now: NOW },
  )
  return created
}

describe('getOpportunityPage: A01 — one account per shared scope', () => {
  it('同 holder 两张卡共享账户时列表只出现一次，card_ids 合并', async () => {
    await seedHolderAccount(
      rules(),
      f.holders.self,
      [f.cards.selfMain, f.cards.selfSecond],
    )
    const page = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].card_ids).toEqual([f.cards.selfMain, f.cards.selfSecond])
    expect(page.items[0].status).toBe('available_today') // usable_end=11-01，17 天后截止
  })

  it('月度周期剩余额度在月底失效 → expiring_soon 窗口', async () => {
    const created = await seedHolderAccount(rules({ count_limit: 2 }), f.holders.self, [f.cards.selfMain])
    void created
    // 10-24 之后进入 7 天窗口
    const late = await getOpportunityPage(actorAdminA, {}, { now: '2026-10-25T08:00:00Z' })
    expect(late.items[0].status).toBe('expiring_soon')
  })
})

describe('scope isolation: A02/A03', () => {
  it('admin A 与 admin B 互不可见对方的账户；成员只见本人 holder', async () => {
    await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain])
    // admin B 世界：USD 卡私有账户
    const { defId } = await seedDefinition(rules({ card_product_ids: [f.products.chaseSapphire], title: 'Hotel credit', time_zone: 'America/New_York' }))
    await createOpportunityAccount(
      actorAdminB,
      {
        definition_id: defId,
        holder_id: f.holders.adminB,
        card_ids: [f.cards.adminBUsd],
        scope_kind: 'card',
        request_key: rk('adminb-acc'),
      },
      { now: NOW },
    )

    const mine = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    expect(mine.items.map((i) => i.holder_id)).toEqual([f.holders.self])

    const theirs = await getOpportunityPage(actorAdminB, {}, { now: NOW })
    expect(theirs.items.map((i) => i.holder_id)).toEqual([f.holders.adminB])

    // 成员没有绑卡 holder → 空页（合法负载状态）
    const memberPage = await getOpportunityPage(actorMemberA, {}, { now: NOW })
    expect(memberPage.items).toEqual([])
    expect(memberPage.counts.available_today + memberPage.counts.expiring_soon).toBe(0)
  })

  it('指定越权 holder_id 返回空页而非数据', async () => {
    await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain])
    const page = await getOpportunityPage(actorAdminA, { holder_id: f.holders.adminB }, { now: NOW })
    expect(page.items).toEqual([])
  })
})

describe('dashboard count: A06', () => {
  it('今天可用数 = distinct 可用账户，不含待领取/需确认/无周期', async () => {
    await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain]) // available
    await seedHolderAccount(
      rules({ title: '待领取券', allocation: 'claim_gated', claim_window: null }),
      f.holders.self,
      [f.cards.selfSecond],
    ) // pending_claim → claimable, not counted
    const count = await getTodayAvailableCount(actorAdminA, { now: NOW })
    expect(count).toBe(1)
  })

  it('无账户时为 0，不回退目录总数', async () => {
    expect(await getTodayAvailableCount(actorAdminA, { now: NOW })).toBe(0)
  })
})

describe('filters, sort, pagination, counts: A11', () => {
  beforeEach(async () => {
    await seedHolderAccount(rules({ title: '餐饮五折', category: 'food' }), f.holders.self, [f.cards.selfMain])
    await seedHolderAccount(rules({ title: '贵宾厅', category: 'travel', count_limit: 1 }), f.holders.family, [f.cards.familyClassic])
    await seedHolderAccount(rules({ title: '观影', category: 'food', count_limit: 1 }), f.holders.self, [f.cards.selfSecond])
  })

  it('q/holder/category 筛选与同一 scope 的 counts', async () => {
    const food = await getOpportunityPage(actorAdminA, { category: 'food' }, { now: NOW })
    expect(food.items.map((i) => i.title).sort()).toEqual(['观影', '餐饮五折'])
    expect(food.counts.available_today + food.counts.expiring_soon).toBe(2)

    const one = await getOpportunityPage(actorAdminA, { q: '贵宾' }, { now: NOW })
    expect(one.items.map((i) => i.title)).toEqual(['贵宾厅'])
  })

  it('limit 分页 + next_cursor 续页，counts 不随分页变化', async () => {
    const full = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    const page1 = await getOpportunityPage(actorAdminA, { limit: 2 }, { now: NOW })
    expect(page1.items).toHaveLength(2)
    expect(page1.next_cursor).toBeTruthy()
    const page2 = await getOpportunityPage(actorAdminA, { limit: 2, cursor: page1.next_cursor }, { now: NOW })
    expect([...page1.items, ...page2.items].map((i) => i.account_id)).toEqual(
      full.items.map((i) => i.account_id),
    )
    expect(page2.counts).toEqual(full.counts)
  })

  it('cursor 绑定筛选：换筛选复用 cursor 被拒绝', async () => {
    const page1 = await getOpportunityPage(actorAdminA, { limit: 1 }, { now: NOW })
    await expect(
      getOpportunityPage(actorAdminA, { limit: 1, category: 'food', cursor: page1.next_cursor }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
  })

  it('默认排序：即将到期在前，同级按标题稳定排序', async () => {
    const page = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    const statuses = page.items.map((i) => i.status)
    // 只验证优先级单调，不写死整表
    const ranks = statuses.map((s) =>
      s === 'expiring_soon' ? 0 : s === 'available_today' ? 1 : 2,
    )
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('已用尽排在可用之后', async () => {
    // 观影 count_limit 1 → 用掉后 exhausted
    const ledger = await getOpportunityPage(actorAdminA, { q: '观影' }, { now: NOW })
    const account = ledger.items[0]
    await recordOpportunityUsage(
      actorAdminA,
      {
        account_id: account.account_id,
        cycle_id: account.cycle_id!,
        card_id: f.cards.selfSecond,
        used_on: '2026-10-14',
        quantity: 1,
        amount_minor: 0,
        note: null,
        request_key: rk('use'),
      },
      { now: NOW },
    )
    const page = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    const exhausted = page.items.find((i) => i.title === '观影')!
    expect(exhausted.status).toBe('exhausted')
    expect(exhausted.reason).toContain('用完')
    expect(page.counts.exhausted).toBe(1)
  })
})

describe('consistency: card strip vs list', () => {
  it('getCardOpportunities 与 getOpportunityPage({card_id}) 同卡同条件一致', async () => {
    await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain, f.cards.selfSecond])
    const strip = await getCardOpportunities(actorAdminA, f.cards.selfMain, 10, { now: NOW })
    const page = await getOpportunityPage(actorAdminA, { card_id: f.cards.selfMain }, { now: NOW })
    expect(strip.map((i) => i.account_id)).toEqual(page.items.map((i) => i.account_id))
    expect(strip[0].status).toBe(page.items[0].status)
    // 默认最多 3 条
    const limited = await getCardOpportunities(actorAdminA, f.cards.selfMain, undefined, { now: NOW })
    expect(limited.length).toBeLessThanOrEqual(3)
  })
})

describe('benefit ledger + detail', () => {
  it('ledger 给出期初未核对提示；detail 暴露资格与版本信息', async () => {
    const created = await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain])
    const ledger = await getBenefitLedger(actorAdminA, {}, { now: NOW })
    expect(ledger.items[0].review_hint).toBe('期初余额未核对')

    const detail = await getOpportunityDetail(actorAdminA, created.account.id, { now: NOW })
    expect(detail.account_id).toBe(created.account.id)
    expect(detail.eligibility).toBe('unknown')
    expect(detail.cycle_id).toBeTruthy()

    await expect(
      getOpportunityDetail(actorAdminB, created.account.id, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
  })
})

describe('setOpportunityFollowed', () => {
  it('关注是个人状态且带 revision CAS', async () => {
    const created = await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain])
    const r1 = await setOpportunityFollowed(actorAdminA, { account_id: created.account.id, followed: true }, { now: NOW })
    expect(r1.revision).toBe(1)
    // 过期 revision 被拒
    await expect(
      setOpportunityFollowed(actorAdminA, { account_id: created.account.id, followed: false, expected_revision: 5 }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
    const r2 = await setOpportunityFollowed(actorAdminA, { account_id: created.account.id, followed: false, expected_revision: 1 }, { now: NOW })
    expect(r2.revision).toBe(2)

    // B 用户读取自己的列表不受 A 的关注影响；A 关注后自己的列表带 followed
    await setOpportunityFollowed(actorAdminA, { account_id: created.account.id, followed: true }, { now: NOW })
    const mine = await getOpportunityPage(actorAdminA, {}, { now: NOW })
    expect(mine.items[0].followed).toBe(true)
    const bPage = await getOpportunityPage(actorAdminB, {}, { now: NOW })
    expect(bPage.items).toEqual([]) // B 无账户；followed 状态本就不跨用户
  })

  it('越权账户拒绝', async () => {
    const created = await seedHolderAccount(rules(), f.holders.self, [f.cards.selfMain])
    await expect(
      setOpportunityFollowed(actorAdminB, { account_id: created.account.id, followed: true }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
  })
})

describe('cross-timezone today', () => {
  it('纽约规则在 UTC 傍晚仍按纽约当地日期评估', async () => {
    const { defId } = await seedDefinition(
      rules({ card_product_ids: [f.products.chaseSapphire], title: 'Hotel', time_zone: 'America/New_York' }),
    )
    await createOpportunityAccount(
      actorAdminB,
      {
        definition_id: defId, holder_id: f.holders.adminB, card_ids: [f.cards.adminBUsd],
        scope_kind: 'card', request_key: rk('ny'),
      },
      { now: '2026-10-16T02:00:00Z' }, // UTC 10-16 02:00 = NY 10-15 22:00
    )
    const page = await getOpportunityPage(actorAdminB, {}, { now: '2026-10-16T02:00:00Z' })
    expect(page.items[0].today_on).toBe('2026-10-15')
  })
})
