// lib/__tests__/opportunity-task-rules.test.ts — manual task conditions and
// reward windows (plan Task 17): 3×3 bounds, amount/count/check metrics,
// negative/currency validation, OR-groups with per-metric gaps, month-end
// clamped reward windows, schema round-trip through the 0016 DDL.

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import {
  validateTaskConditions,
  validateCardIdSet,
  evaluateTask,
  rewardWindow,
  type TaskConditionsV1,
} from '../opportunities/tasks'
import { OpportunityError } from '../opportunities/errors'

let db: SqliteD1

beforeEach(() => {
  db = createOpportunityDb()
  return seedOpportunityFixtures(db)
})

function conditions(over: Partial<TaskConditionsV1> = {}): TaskConditionsV1 {
  return {
    schema_version: 1,
    currency: 'CNY',
    groups: [
      {
        id: 'g1',
        metrics: [
          { id: 'amt', kind: 'amount', target_minor: 300_000 },
          { id: 'cnt', kind: 'count', target_count: 5, per_txn_min_minor: 38_800 },
          { id: 'chk', kind: 'check', label: '已绑定微信支付' },
        ],
      },
    ],
    eligible_spend_notes: null,
    ...over,
  }
}

function rejects(fn: () => unknown, message: string) {
  expect(() => fn()).toThrow(OpportunityError)
  void message
}

describe('validateTaskConditions', () => {
  it('合法 3 组 × 3 指标通过；第 4 组或每组第 4 个指标拒绝', () => {
    const metric = (i: number) => ({ id: `m${i}`, kind: 'count' as const, target_count: 1, per_txn_min_minor: null })
    expect(() =>
      validateTaskConditions(conditions({ groups: [1, 2, 3].map((g) => ({ id: `g${g}`, metrics: [metric(g * 10), metric(g * 10 + 1), metric(g * 10 + 2)] })) })),
    ).not.toThrow()
    rejects(
      () => validateTaskConditions(conditions({ groups: [1, 2, 3, 4].map((g) => ({ id: `g${g}`, metrics: [metric(g)] })) })),
      '4 groups',
    )
    rejects(
      () => validateTaskConditions(conditions({ groups: [{ id: 'g', metrics: [1, 2, 3, 4].map((i) => metric(i)) }] })),
      '4 metrics',
    )
  })

  it('负数目标/非法币种/重复指标 id 拒绝；0 值合法', () => {
    rejects(() => validateTaskConditions(conditions({ currency: '人民币' })), 'currency')
    rejects(
      () =>
        validateTaskConditions(
          conditions({ groups: [{ id: 'g', metrics: [{ id: 'a', kind: 'amount', target_minor: -1 }] }] }),
        ),
      'negative',
    )
    expect(() =>
      validateTaskConditions(conditions({ groups: [{ id: 'g', metrics: [{ id: 'a', kind: 'amount', target_minor: 0 }] }] })),
    ).not.toThrow()
    rejects(
      () =>
        validateTaskConditions(
          conditions({
            groups: [
              { id: 'g1', metrics: [{ id: 'dup', kind: 'check', label: 'x' }] },
              { id: 'g2', metrics: [{ id: 'dup', kind: 'check', label: 'y' }] },
            ],
          }),
        ),
      'duplicate id',
    )
  })

  it('卡集合 ≤20 且去重', () => {
    expect(validateCardIdSet(['a', 'b', 'a'])).toEqual(['a', 'b'])
    rejects(() => validateCardIdSet(Array.from({ length: 21 }, (_, i) => `c${i}`)), '21 cards')
    rejects(() => validateCardIdSet([]), 'empty')
  })
})

describe('evaluateTask', () => {
  it('满足任选一组即手动达标（OR），组内全部满足（AND）', () => {
    const rules = conditions({
      groups: [
        { id: 'g1', metrics: [{ id: 'amt', kind: 'amount', target_minor: 300_000 }] },
        { id: 'g2', metrics: [{ id: 'cnt', kind: 'count', target_count: 5, per_txn_min_minor: null }] },
      ],
    })
    const result = evaluateTask(rules, {
      as_of_on: '2026-10-15',
      metric_values: { amt: 300_000, cnt: 3 },
      note: null,
    })
    expect(result.satisfied).toBe(true)
    expect(result.groups[0].satisfied).toBe(true)
    expect(result.groups[1].satisfied).toBe(false)
    expect(result.groups[1].gaps.cnt).toBe(2)
  })

  it('缺口 = max(0, target − progress)；确认项只认 boolean true', () => {
    const result = evaluateTask(conditions(), {
      as_of_on: '2026-10-15',
      metric_values: { amt: 100_000, cnt: 5, chk: true },
      note: null,
    })
    expect(result.groups[0].gaps.amt).toBe(200_000)
    expect(result.groups[0].gaps.cnt).toBe(0)
    expect(result.satisfied).toBe(false)

    const unchecked = evaluateTask(conditions(), {
      as_of_on: '2026-10-15',
      metric_values: { amt: 300_000, cnt: 5, chk: false },
      note: null,
    })
    expect(unchecked.satisfied).toBe(false)
  })

  it('非法进度（负数/非数值/非法日期）拒绝；不从金额反推笔数', () => {
    rejects(
      () => evaluateTask(conditions(), { as_of_on: '2026-10-15', metric_values: { amt: -1 }, note: null }),
      'negative progress',
    )
    rejects(
      () => evaluateTask(conditions(), { as_of_on: '2026-13-01', metric_values: {}, note: null }),
      'bad date',
    )
    // 金额达标但笔数不足 → 不满足（互不推断）
    const r = evaluateTask(conditions(), {
      as_of_on: '2026-10-15',
      metric_values: { amt: 999_999, cnt: 2, chk: true },
      note: null,
    })
    expect(r.satisfied).toBe(false)
  })
})

describe('rewardWindow', () => {
  it('周期结束次月 X—Y 日，含开始不含结束', () => {
    expect(rewardWindow('2026-11-01', 5, 10)).toEqual({
      expected_from_on: '2026-11-05',
      expected_until_before: '2026-11-11',
    })
  })

  it('月末收拢：31 落在 30 天月与 2 月；无上界返回 null', () => {
    expect(rewardWindow('2026-11-01', 31, 31)).toEqual({
      expected_from_on: '2026-11-30',
      expected_until_before: '2026-12-01',
    })
    expect(rewardWindow('2027-03-01', 28, 31)).toEqual({
      expected_from_on: '2027-03-28',
      expected_until_before: '2027-04-01',
    })
    expect(rewardWindow('2026-11-01', 15, null)).toEqual({
      expected_from_on: '2026-11-15',
      expected_until_before: null,
    })
  })

  it('X > Y 或非法日拒绝', () => {
    expect(() => rewardWindow('2026-11-01', 10, 5)).toThrow(OpportunityError)
    expect(() => rewardWindow('2026-11-01', 0, 5)).toThrow(OpportunityError)
  })
})

describe('0016 schema', () => {
  it('任务与周期表约束生效（holder FK、唯一周期、CHECK）', () => {
    const ins = db.raw.prepare(
      `INSERT INTO opportunity_tasks (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    ins.run('task-1', FIXTURE_IDS.holders.self, 'monthly_spend', '消费任务', '[]', '{}', '{}', FIXTURE_IDS.users.adminA, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')
    // task_type 枚举
    expect(() =>
      ins.run('task-2', FIXTURE_IDS.holders.self, 'bogus', 'x', '[]', '{}', '{}', FIXTURE_IDS.users.adminA, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
    ).toThrow(/CHECK/)
    // holder FK
    expect(() =>
      ins.run('task-3', 'no-such-holder', 'custom', 'x', '[]', '{}', '{}', FIXTURE_IDS.users.adminA, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
    ).toThrow(/FOREIGN KEY/)

    const insCycle = db.raw.prepare(
      `INSERT INTO opportunity_task_cycles (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json, period_start_on, period_end_before, deadline_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    insCycle.run('tc-1', 'task-1', '2026-10', '{}', '{}', '2026-10-01', '2026-11-01', '2026-11-05T15:59:59Z', '2026-10-01T00:00:00Z')
    // UNIQUE(task_id, cycle_key)
    expect(() =>
      insCycle.run('tc-2', 'task-1', '2026-10', '{}', '{}', '2026-10-01', '2026-11-01', '2026-11-05T15:59:59Z', '2026-10-01T00:00:00Z'),
    ).toThrow(/UNIQUE/)
    // period_end_before > period_start_on
    expect(() =>
      insCycle.run('tc-3', 'task-1', '2026-11', '{}', '{}', '2026-11-01', '2026-11-01', '2026-12-05T15:59:59Z', '2026-10-01T00:00:00Z'),
    ).toThrow(/CHECK/)
  })
})
