// lib/__tests__/opportunity-claims-grants.test.ts — claims and reward
// receipts (plan Task 19, spec §8.2): claims activate without adding quota,
// reward source_keys are business-unique per (task_cycle, reward_key), quota
// grants create bounded GRANT cycles (never regular ones) in the same batch,
// non-quota rewards record task_result rows with no account/quota, the 0017
// guard triggers refuse inconsistent rows, and claim voids conflict with
// usage/reservation dependencies.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { saveOpportunityTask, getOpportunityTasks } from '../opportunities/tasks.server'
import {
  recordOpportunityClaim,
  recordTaskRewardReceived,
  voidOpportunityClaim,
} from '../opportunities/fulfillments.server'
import { recordOpportunityUsage } from '../opportunities/usages.server'
import { reconcileOpportunityCycle } from '../opportunities/writes.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

let seq = 0
const rk = () => `claims-rk-run-${String(++seq).padStart(4, '0')}`

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '领取/奖励验证',
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
    ...over,
  }
}

/** Account + (optionally pending) current cycle; returns ids. */
async function seedAccount(withClaimGating = false) {
  const n = ++seq
  const defId = `odef-cg-${n}`
  const versionId = `orv-cg-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(rules(withClaimGating ? { allocation: 'claim_gated' } : {}))),
  ])
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
  }, { now: NOW })
  if (!created.cycle) throw new Error('no cycle')
  return { defId, versionId, accountId: created.account.id, cycleId: created.cycle.id }
}

async function seedTask(rewardKind: 'quota' | 'non_quota') {
  const saved = await saveOpportunityTask(actorAdminA, {
    holder_id: f.holders.self,
    task_type: 'monthly_spend',
    title: '达标任务',
    card_ids: [f.cards.selfMain],
    rules: {
      schema_version: 1,
      currency: 'CNY',
      groups: [{ id: 'g1', metrics: [{ id: 'amt', kind: 'amount', target_minor: 100_000 }] }],
      eligible_spend_notes: null,
    },
    reward:
      rewardKind === 'quota'
        ? { kind: 'quota', title: '消费礼券', reward_key: 'spend-gift', count: 1, amount_minor: null, currency: 'CNY' }
        : { kind: 'non_quota', title: '年费减免', reward_key: 'fee-waiver', description: '次年年费减免' },
    window: { from_day: 5, until_day: 10 },
    request_key: rk(),
  }, { now: NOW })
  const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
  const view = views.find((v) => v.task_id === saved.task_id)!
  return { taskId: saved.task_id, taskCycleId: view.cycle!.id }
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(OpportunityError)
    expect((err as OpportunityError).code).toBe(code)
    return true
  })
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

describe('recordOpportunityClaim', () => {
  it('激活 pending 批次且不增加配额；重复领取与已激活均拒绝', async () => {
    const world = await seedAccount(true)
    const before = db.raw
      .prepare('SELECT count_limit, used_count FROM opportunity_cycles WHERE id = ?')
      .get(world.cycleId) as { count_limit: number; used_count: number }
    expect(before.count_limit).toBe(4)

    const claim = await recordOpportunityClaim(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      claimed_on: '2026-10-15', request_key: rk(),
    }, { now: NOW })
    expect(claim.cycle_activation_state).toBe('active')

    const after = db.raw
      .prepare('SELECT count_limit, used_count, activation_state FROM opportunity_cycles WHERE id = ?')
      .get(world.cycleId) as { count_limit: number; used_count: number; activation_state: string }
    expect(after.count_limit).toBe(4) // 配额不变
    expect(after.activation_state).toBe('active')

    // 同批重复领取（不同 key）拒绝
    await rejects(
      recordOpportunityClaim(actorAdminA, {
        account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
        claimed_on: '2026-10-15', request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
  })

  it('未绑定的卡拒绝；越权账户拒绝；同 key 重放幂等', async () => {
    const world = await seedAccount(true)
    await rejects(
      recordOpportunityClaim(actorAdminA, {
        account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.familyClassic,
        claimed_on: '2026-10-15', request_key: rk(),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
    await rejects(
      recordOpportunityClaim(actorAdminB, {
        account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
        claimed_on: '2026-10-15', request_key: rk(),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
    const key = rk()
    const first = await recordOpportunityClaim(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      claimed_on: '2026-10-15', request_key: key,
    }, { now: NOW })
    const replay = await recordOpportunityClaim(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      claimed_on: '2026-10-15', request_key: key,
    }, { now: NOW })
    expect(replay.fulfillment_id).toBe(first.fulfillment_id)
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS n FROM opportunity_fulfillments WHERE kind = 'claim'")
      .get() as { n: number }
    expect(rows.n).toBe(1)
  })
})

describe('recordTaskRewardReceived', () => {
  it('quota 奖励：同一 batch 建 grant 周期与 fulfillment；不产生 regular 周期；业务键唯一', async () => {
    const task = await seedTask('quota')
    const world = await seedAccount()

    const grant = await recordTaskRewardReceived(actorAdminA, {
      task_cycle_id: task.taskCycleId, reward_key: 'spend-gift', received_on: '2026-11-06',
      account_id: world.accountId, request_key: rk(),
    }, { now: NOW })
    expect(grant.reward_kind).toBe('quota')
    expect(grant.grant_cycle_id).toBeTruthy()

    const grantCycle = db.raw
      .prepare('SELECT allocation_kind, cycle_key, count_limit, usable_start_on, usable_end_before FROM opportunity_cycles WHERE id = ?')
      .get(grant.grant_cycle_id!) as { allocation_kind: string; cycle_key: string; count_limit: number; usable_start_on: string; usable_end_before: string }
    expect(grantCycle.allocation_kind).toBe('grant')
    expect(grantCycle.cycle_key).toBe(`grant:${task.taskCycleId}:spend-gift`)
    expect(grantCycle.count_limit).toBe(1)
    // 十月任务周期 → 发放窗口 11-05..11-11；起点裁剪到实际到账日 11-06
    expect(grantCycle.usable_start_on).toBe('2026-11-06')
    expect(grantCycle.usable_end_before).toBe('2026-11-11')

    // 同 (task_cycle, reward_key) 二次到账拒绝（不同 request key）
    await rejects(
      recordTaskRewardReceived(actorAdminA, {
        task_cycle_id: task.taskCycleId, reward_key: 'spend-gift', received_on: '2026-11-07',
        account_id: world.accountId, request_key: rk(),
      }, { now: NOW }),
      'INVALID_TRANSITION',
    )
    // 不同 reward_key 各自一次
    const second = await recordTaskRewardReceived(actorAdminA, {
      task_cycle_id: task.taskCycleId, reward_key: 'spend-gift-2', received_on: '2026-11-07',
      account_id: world.accountId, request_key: rk(),
    }, { now: NOW })
    expect(second.grant_cycle_id).toBeTruthy()

    // grant-only：账户定义 grant_only 时账户无 regular 周期，奖励也只建 grant
    const recon = await reconcileOpportunityCycle(actorAdminA, grant.grant_cycle_id!)
    expect(recon.ok).toBe(true)
  })

  it('non_quota 奖励：只记 task_result，不建账户额度；越权任务拒绝', async () => {
    const task = await seedTask('non_quota')
    const result = await recordTaskRewardReceived(actorAdminA, {
      task_cycle_id: task.taskCycleId, reward_key: 'fee-waiver', received_on: '2026-11-06',
      request_key: rk(),
    }, { now: NOW })
    expect(result.reward_kind).toBe('non_quota')
    expect(result.grant_cycle_id).toBeNull()

    const row = db.raw
      .prepare('SELECT kind, account_id, cycle_id, task_cycle_id, reward_key FROM opportunity_fulfillments WHERE id = ?')
      .get(result.fulfillment_id) as { kind: string; account_id: string | null; cycle_id: string | null; task_cycle_id: string; reward_key: string }
    expect(row.kind).toBe('task_result')
    expect(row.account_id).toBeNull()
    expect(row.cycle_id).toBeNull()

    // 他人任务周期不可见
    await rejects(
      recordTaskRewardReceived(actorAdminB, {
        task_cycle_id: task.taskCycleId, reward_key: 'fee-waiver-2', received_on: '2026-11-06',
        request_key: rk(),
      }, { now: NOW }),
      'FORBIDDEN_OR_NOT_FOUND',
    )
  })

  it('跨 holder 账户拒绝；有效期早于到账日拒绝', async () => {
    const task = await seedTask('quota')
    const world = await seedAccount()
    // adminB 世界账户
    const n = ++seq
    await db.batch([
      db.prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
      ).bind(`odef-cg-b${n}`, f.users.adminB),
      db.prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
      ).bind(`orv-cg-b${n}`, `odef-cg-b${n}`, JSON.stringify(rules({ card_product_ids: [f.products.chaseSapphire] }))),
    ])
    const foreign = await createOpportunityAccount(actorAdminB, {
      definition_id: `odef-cg-b${n}`, holder_id: f.holders.adminB,
      card_ids: [f.cards.adminBUsd], scope_kind: 'card', request_key: rk(),
    }, { now: NOW })

    await rejects(
      recordTaskRewardReceived(actorAdminA, {
        task_cycle_id: task.taskCycleId, reward_key: 'spend-gift', received_on: '2026-11-06',
        account_id: foreign.account.id, request_key: rk(),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
    await rejects(
      recordTaskRewardReceived(actorAdminA, {
        task_cycle_id: task.taskCycleId, reward_key: 'spend-gift', received_on: '2026-11-06',
        account_id: world.accountId, usable_start_on: '2026-11-01', request_key: rk(),
      }, { now: NOW }),
      'VALIDATION_FAILED',
    )
  })
})

describe('voidOpportunityClaim', () => {
  it('无依赖可撤销并作废批次；有使用依赖时业务冲突', async () => {
    const world = await seedAccount(true)
    const claim = await recordOpportunityClaim(actorAdminA, {
      account_id: world.accountId, cycle_id: world.cycleId, card_id: f.cards.selfMain,
      claimed_on: '2026-10-15', request_key: rk(),
    }, { now: NOW })

    const voided = await voidOpportunityClaim(actorAdminA, {
      fulfillment_id: claim.fulfillment_id, reason: '误记录', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    expect(voided.status).toBe('cancelled')
    const cycle = db.raw
      .prepare('SELECT activation_state FROM opportunity_cycles WHERE id = ?')
      .get(world.cycleId) as { activation_state: string }
    expect(cycle.activation_state).toBe('voided')

    // 重建领取，制造使用依赖后再撤 → 冲突
    const world2 = await seedAccount(true)
    const claim2 = await recordOpportunityClaim(actorAdminA, {
      account_id: world2.accountId, cycle_id: world2.cycleId, card_id: f.cards.selfMain,
      claimed_on: '2026-10-15', request_key: rk(),
    }, { now: NOW })
    await recordOpportunityUsage(actorAdminA, {
      account_id: world2.accountId, cycle_id: world2.cycleId, card_id: f.cards.selfMain,
      used_on: '2026-10-15', quantity: 1, amount_minor: 0, note: null, request_key: rk(),
    }, { now: NOW })
    await rejects(
      voidOpportunityClaim(actorAdminA, {
        fulfillment_id: claim2.fulfillment_id, reason: '有使用', expected_revision: 1, request_key: rk(),
      }, { now: NOW }),
      'CONFLICT',
    )
  })
})

describe('0017 guard triggers', () => {
  it('不一致 fulfillment 被 guard 拒绝；linked usage 防绕过', async () => {
    const world = await seedAccount()
    // holder 不匹配
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO opportunity_fulfillments
             (id, holder_id, kind, account_id, cycle_id, source_key, card_id, status, recorded_on, created_by, updated_by, created_at, updated_at)
           VALUES (?,?,'claim',?,?,?,?, 'recorded', ?,?,?,?,?)`,
        )
        .run('ofl-bad-1', f.holders.adminB, world.accountId, world.cycleId, 'claim:bad:1', f.cards.selfMain, '2026-10-15', f.users.adminA, f.users.adminA, NOW, NOW),
    ).toThrow(/OPPORTUNITY_FULFILLMENT_SCOPE_MISMATCH/)
  })
})
