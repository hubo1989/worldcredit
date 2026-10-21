// lib/__tests__/opportunity-tasks.test.ts — task persistence (plan Task 18):
// creation with real holder-card SQL validation, duplicate keys, absolute
// progress replacement (downgrades audited, not blocked), revision conflicts,
// next-cycle zeroing, template edits never rewriting live cycle snapshots,
// deadline-past-yet-unsatisfied states, and holder scope isolation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import {
  saveOpportunityTask,
  updateManualTaskProgress,
  getOpportunityTasks,
} from '../opportunities/tasks.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, TaskConditionsV1, ManualProgress } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

let seq = 0
const rk = () => `tasks-rk-run-${String(++seq).padStart(4, '0')}`

function conditions(): TaskConditionsV1 {
  return {
    schema_version: 1,
    currency: 'CNY',
    groups: [
      {
        id: 'g1',
        metrics: [
          { id: 'amt', kind: 'amount', target_minor: 100_000 },
          { id: 'cnt', kind: 'count', target_count: 3, per_txn_min_minor: null },
        ],
      },
    ],
    eligible_spend_notes: null,
  }
}

async function createTask(cardIds: string[] = [f.cards.selfMain], holderId: string = f.holders.self) {
  return saveOpportunityTask(
    actorAdminA,
    {
      holder_id: holderId,
      task_type: 'monthly_spend',
      title: '月消费达标',
      card_ids: cardIds,
      rules: conditions(),
      reward: { kind: 'quota', title: '消费礼券', reward_key: 'spend-gift', count: 1, amount_minor: null, currency: 'CNY' },
      window: { from_day: 5, until_day: 10 },
      request_key: rk(),
    },
    { now: NOW },
  )
}

function progress(asOf: string, values: Record<string, number | boolean>, note: string | null = null): ManualProgress {
  return { as_of_on: asOf, metric_values: values, note }
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

describe('saveOpportunityTask', () => {
  it('创建任务：卡归属 SQL 验证，越权 holder 拒绝', async () => {
    const created = await createTask()
    expect(created.task_id).toBeTruthy()
    expect(created.updated).toBe(false)

    // 别人 holder 的卡 → 拒绝
    await rejects(
      createTask([f.cards.adminBUsd]),
      'VALIDATION_FAILED',
    )
    // 越权 holder
    await rejects(
      saveOpportunityTask(
        actorAdminA,
        {
          holder_id: f.holders.adminB, task_type: 'custom', title: 'x',
          card_ids: [f.cards.adminBUsd], rules: conditions(),
          reward: { kind: 'non_quota', title: 'x', reward_key: 'k', description: null },
          window: { from_day: 1, until_day: null }, request_key: rk(),
        },
        { now: NOW },
      ),
      'FORBIDDEN_OR_NOT_FOUND',
    )
  })

  it('同 key 重放返回已提交结果；模板编辑不覆写当前周期快照', async () => {
    const key = rk()
    const first = await saveOpportunityTask(
      actorAdminA,
      {
        holder_id: f.holders.self, task_type: 'monthly_spend', title: '月消费达标',
        card_ids: [f.cards.selfMain], rules: conditions(),
        reward: { kind: 'quota', title: '消费礼券', reward_key: 'spend-gift', count: 1, amount_minor: null, currency: 'CNY' },
        window: { from_day: 5, until_day: 10 }, request_key: key,
      },
      { now: NOW },
    )
    const replay = await saveOpportunityTask(
      actorAdminA,
      {
        holder_id: f.holders.self, task_type: 'monthly_spend', title: '月消费达标',
        card_ids: [f.cards.selfMain], rules: conditions(),
        reward: { kind: 'quota', title: '消费礼券', reward_key: 'spend-gift', count: 1, amount_minor: null, currency: 'CNY' },
        window: { from_day: 5, until_day: 10 }, request_key: key,
      },
      { now: NOW },
    )
    expect(replay.task_id).toBe(first.task_id)

    // 物化当前周期后编辑模板：周期快照保持原规则
    const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    expect(views).toHaveLength(1)
    const cycleId = views[0].cycle!.id
    await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: cycleId,
        progress: progress('2026-10-15', { amt: 50_000, cnt: 1 }),
        reason: '首次录入',
        expected_revision: 1,
        request_key: rk(),
      },
      { now: NOW },
    )
    const harder = conditions()
    harder.groups[0].metrics = [{ id: 'amt', kind: 'amount', target_minor: 999_999 }]
    await saveOpportunityTask(
      actorAdminA,
      {
        task_id: first.task_id, holder_id: f.holders.self, task_type: 'monthly_spend',
        title: '月消费达标（新模板）', card_ids: [f.cards.selfMain], rules: harder,
        reward: { kind: 'quota', title: '消费礼券', reward_key: 'spend-gift', count: 1, amount_minor: null, currency: 'CNY' },
        window: { from_day: 5, until_day: 10 }, request_key: rk(), expected_revision: first.revision,
      },
      { now: NOW },
    )
    const snapshot = db.raw
      .prepare('SELECT rules_snapshot_json FROM opportunity_task_cycles WHERE id = ?')
      .get(cycleId) as { rules_snapshot_json: string }
    expect(JSON.parse(snapshot.rules_snapshot_json).groups[0].metrics[0].target_minor).toBe(100_000)
    expect(
      (db.raw.prepare('SELECT rules_json FROM opportunity_tasks WHERE id = ?').get(first.task_id) as { rules_json: string }),
    ).toBeTruthy()
  })

  it('模板编辑 revision 冲突', async () => {
    const created = await createTask()
    await rejects(
      saveOpportunityTask(
        actorAdminA,
        {
          task_id: created.task_id, holder_id: f.holders.self, task_type: 'monthly_spend',
          title: 'x', card_ids: [f.cards.selfMain], rules: conditions(),
          reward: { kind: 'non_quota', title: 'x', reward_key: 'k', description: null },
          window: { from_day: 1, until_day: null }, request_key: rk(), expected_revision: 99,
        },
        { now: NOW },
      ),
      'REVISION_CONFLICT',
    )
  })
})

describe('updateManualTaskProgress', () => {
  it('绝对快照替换：进度可下调且留审计；revision 冲突拒绝；重放幂等', async () => {
    await createTask()
    let views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    const cycleId = views[0].cycle!.id

    const up = await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: cycleId,
        progress: progress('2026-10-15', { amt: 100_000, cnt: 3 }),
        reason: '补录全部消费',
        expected_revision: 1,
        request_key: rk(),
      },
      { now: NOW },
    )
    expect(up.satisfied).toBe(true)

    // 下调（退款）：允许并审计
    const down = await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: cycleId,
        progress: progress('2026-10-15', { amt: 40_000, cnt: 2 }),
        reason: '退款下调',
        expected_revision: 2,
        request_key: rk(),
      },
      { now: NOW },
    )
    expect(down.satisfied).toBe(false)
    const events = db.raw
      .prepare("SELECT before_json, after_json, reason FROM opportunity_events WHERE event_type = 'task.progress_replaced' ORDER BY rowid")
      .all() as Array<{ before_json: string; after_json: string; reason: string }>
    expect(events).toHaveLength(2)
    expect(JSON.parse(events[0].before_json).progress).toEqual({})
    expect(JSON.parse(events[1].after_json).progress.metric_values.amt).toBe(40_000)
    expect(events[1].reason).toBe('退款下调')

    // 过期 revision
    await rejects(
      updateManualTaskProgress(
        actorAdminA,
        {
          task_cycle_id: cycleId, progress: progress('2026-10-16', { amt: 1, cnt: 1 }),
          reason: '过期写入', expected_revision: 1, request_key: rk(),
        },
        { now: NOW },
      ),
      'REVISION_CONFLICT',
    )

    // 同 key 重放返回已提交结果（revision 不再前进）
    const replayKey = rk()
    const first = await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: cycleId, progress: progress('2026-10-16', { amt: 90_000, cnt: 3 }),
        reason: '重放测试', expected_revision: 3, request_key: replayKey,
      },
      { now: NOW },
    )
    const replay = await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: cycleId, progress: progress('2026-10-16', { amt: 90_000, cnt: 3 }),
        reason: '重放测试', expected_revision: 3, request_key: replayKey,
      },
      { now: NOW },
    )
    expect(replay.revision).toBe(first.revision)
    views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    expect(views[0].cycle!.revision).toBe(first.revision)
  })

  it('越权任务周期拒绝', async () => {
    await createTask()
    const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    const cycleId = views[0].cycle!.id
    await rejects(
      updateManualTaskProgress(
        actorAdminB,
        {
          task_cycle_id: cycleId, progress: progress('2026-10-15', { amt: 1, cnt: 1 }),
          reason: '越权', expected_revision: 1, request_key: rk(),
        },
        { now: NOW },
      ),
      'FORBIDDEN_OR_NOT_FOUND',
    )
  })

  it('下月新周期从零快照开始（进度不跨周期累计）', async () => {
    await createTask()
    const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    await updateManualTaskProgress(
      actorAdminA,
      {
        task_cycle_id: views[0].cycle!.id,
        progress: progress('2026-10-15', { amt: 100_000, cnt: 3 }),
        reason: '十月达标', expected_revision: 1, request_key: rk(),
      },
      { now: NOW },
    )
    const november = await getOpportunityTasks(actorAdminA, {}, { now: '2026-11-05T08:00:00Z' })
    expect(november[0].cycle!.cycle_key).toBe('monthly:2026-11-01')
    expect(november[0].cycle!.satisfied).toBe(false)
    expect(november[0].cycle!.as_of_on).toBeNull()
    // 发放窗口按 11 月周期推导（period_end 12-01 → 12-05..12-11）
    expect(november[0].cycle!.expected_from_on).toBe('2026-12-05')
    expect(november[0].cycle!.expected_until_before).toBe('2026-12-11')
  })
})

describe('getOpportunityTasks', () => {
  it('scope 隔离 + 卡筛选', async () => {
    await createTask([f.cards.selfMain, f.cards.selfSecond], f.holders.self)
    await createTask([f.cards.familyClassic], f.holders.family)

    const mine = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
    expect(mine).toHaveLength(2)
    const byCard = await getOpportunityTasks(actorAdminA, { card_id: f.cards.selfSecond }, { now: NOW })
    expect(byCard).toHaveLength(1)
    expect(byCard[0].card_ids).toContain(f.cards.selfSecond)

    const theirs = await getOpportunityTasks(actorAdminB, {}, { now: NOW })
    expect(theirs).toEqual([])
  })
})
