// lib/__tests__/opportunity-reminders.test.ts — Task 14 (first slice): 0014
// schema constraints and the reminders pure functions (tech spec §10):
//   config       — defaults, deep merge, validation of every field
//   identity     — event_key/delivery_key/tag stability; business_date_hash
//                  ignores notes and usage, tracks deadlines and versions
//   thresholds   — expiry day nodes dedupe/normalize; reset/claim/service nodes
//   instants     — wall clock → UTC with DST gap (postpone) and fold (earliest),
//                  Beijing-midnight vs New-York-previous-day
//   quiet hours  — cross-midnight postponement in both directions
//   state        — read/dismiss/snooze/restore transitions, snooze past
//                  deadline refused, read-step cap of 16

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import {
  DEFAULT_OPPORTUNITY_REMINDER_CONFIG,
  mergeOpportunityReminderConfig,
  reminderEventKey,
  reminderDeliveryKey,
  reminderTag,
  expiryThresholds,
  claimWindowNodes,
  localWallTimeToInstant,
  resolveDeliveryInstant,
  applyReminderStateAction,
  reminderStateFromRow,
  MAX_READ_STEPS,
  type ReminderStateSnapshot,
} from '../opportunities/reminders'
import { OpportunityError } from '../opportunities/errors'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'

beforeEach(() => {
  db = createOpportunityDb()
  return seedOpportunityFixtures(db)
})

// ---------------------------------------------------------------------------
// Schema (0014)
// ---------------------------------------------------------------------------

describe('0014 reminder schema', () => {
  it('同一 event_key 不同用户各自成行，(user,event) 重复被拒', () => {
    const ins = db.raw.prepare(
      `INSERT INTO opportunity_reminder_states (user_id, event_key, updated_at)
       VALUES (?, ?, ?)`,
    )
    ins.run(f.users.adminA, 'op:expiry:oacc:2026-10:abc', NOW)
    ins.run(f.users.memberA, 'op:expiry:oacc:2026-10:abc', NOW)
    expect(() => ins.run(f.users.adminA, 'op:expiry:oacc:2026-10:abc', NOW)).toThrow(/UNIQUE/)
    const rows = db.raw
      .prepare('SELECT user_id FROM opportunity_reminder_states ORDER BY user_id')
      .all() as { user_id: string }[]
    expect(rows.map((r) => r.user_id)).toEqual([f.users.adminA, f.users.memberA])
  })

  it('notification job 的 status 枚举与 attempt_count 0–4 生效', () => {
    const base = {
      id: 'onj-1',
      user_id: f.users.adminA,
      holder_id: f.holders.self,
      event_key: 'op:expiry:oacc:2026-10:abc',
      delivery_key: 'op:expiry:oacc:2026-10:abc:d1',
      object_kind: 'account',
      object_id: 'oacc',
      business_version: 'v1',
      scheduled_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    }
    db.raw
      .prepare(
        `INSERT INTO opportunity_notification_jobs
           (id,user_id,holder_id,event_key,delivery_key,object_kind,object_id,business_version,scheduled_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        base.id, base.user_id, base.holder_id, base.event_key, base.delivery_key,
        base.object_kind, base.object_id, base.business_version, base.scheduled_at,
        base.created_at, base.updated_at,
      )
    // user+delivery_key 唯一
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO opportunity_notification_jobs
             (id,user_id,holder_id,event_key,delivery_key,object_kind,object_id,business_version,scheduled_at,created_at,updated_at)
           VALUES ('onj-2',?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          f.users.adminA, f.holders.self, 'op:expiry:oacc:2026-10:abc', base.delivery_key,
          'account', 'oacc', 'v1', NOW, NOW, NOW,
        ),
    ).toThrow(/UNIQUE/)
    // status 枚举
    expect(() =>
      db.raw.prepare(`UPDATE opportunity_notification_jobs SET status='bogus' WHERE id='onj-1'`).run(),
    ).toThrow(/CHECK/)
    // attempt_count 上界 4
    expect(() =>
      db.raw.prepare(`UPDATE opportunity_notification_jobs SET attempt_count=5 WHERE id='onj-1'`).run(),
    ).toThrow(/CHECK/)
  })

  it('deliveries 按 (job, subscription) 唯一且状态枚举受限', () => {
    db.raw
      .prepare(
        `INSERT INTO opportunity_notification_jobs
           (id,user_id,holder_id,event_key,delivery_key,object_kind,object_id,business_version,scheduled_at,created_at,updated_at)
         VALUES ('onj-0',?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(f.users.adminA, f.holders.self, 'op:expiry:oacc:2026-10:abc', 'op:expiry:oacc:2026-10:abc:d1', 'account', 'oacc', 'v1', NOW, NOW, NOW)
    const ins = db.raw.prepare(
      `INSERT INTO opportunity_notification_deliveries (id, job_id, subscription_id, status)
       VALUES (?,?,?,?)`,
    )
    ins.run('ond-1', 'onj-0', 'sub-1', 'pending')
    expect(() => ins.run('ond-2', 'onj-0', 'sub-1', 'accepted')).toThrow(/UNIQUE/)
    expect(() =>
      db.raw.prepare(`UPDATE opportunity_notification_deliveries SET status='sent' WHERE id='ond-1'`).run(),
    ).toThrow(/CHECK/)
  })

  it('read_steps_json 必须是合法 JSON', () => {
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO opportunity_reminder_states (user_id, event_key, read_steps_json, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(f.users.adminA, 'op:x:o:1:a', 'not-json', NOW),
    ).toThrow(/CHECK/)
  })
})

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('OpportunityReminderConfig', () => {
  it('defaults 完整且通过自身校验', () => {
    expect(() => mergeOpportunityReminderConfig(null)).not.toThrow()
    expect(mergeOpportunityReminderConfig(undefined)).toEqual(DEFAULT_OPPORTUNITY_REMINDER_CONFIG)
  })

  it('深合并只覆盖给出字段，数组整体替换', () => {
    const merged = mergeOpportunityReminderConfig({
      web_push_enabled: false,
      expiry_days_before: [10, 2],
    })
    expect(merged.web_push_enabled).toBe(false)
    expect(merged.expiry_days_before).toEqual([10, 2])
    expect(merged.time_zone).toBe(DEFAULT_OPPORTUNITY_REMINDER_CONFIG.time_zone)
    expect(merged.claim_days_before).toEqual(DEFAULT_OPPORTUNITY_REMINDER_CONFIG.claim_days_before)
  })

  it('非法时区、时间、天数数组被拒', () => {
    expect(() => mergeOpportunityReminderConfig({ time_zone: 'Mars/Olympus' })).toThrow(
      OpportunityError,
    )
    expect(() => mergeOpportunityReminderConfig({ local_time: '25:00' })).toThrow(OpportunityError)
    expect(() => mergeOpportunityReminderConfig({ expiry_days_before: [-1] })).toThrow(
      OpportunityError,
    )
    expect(() => mergeOpportunityReminderConfig({ expiry_days_before: [3, 3, 1] })).not.toThrow()
  })

  it('归一化去重并按剩余天数降序', () => {
    expect(mergeOpportunityReminderConfig({ expiry_days_before: [1, 3, 3, 7] }).expiry_days_before).toEqual([7, 3, 1])
  })
})

// ---------------------------------------------------------------------------
// Identity: event_key / delivery_key / tag / business_date_hash
// ---------------------------------------------------------------------------

describe('reminder identity', () => {
  it('同输入同 key；deadline 变化换 key；备注与用量不入 hash', async () => {
    const base = {
      type: 'expiry',
      object_id: 'oacc-1',
      cycle_or_grant_key: 'regular:2026-10-01',
      deadline_before: '2026-11-01',
      version: 'orv-1',
    }
    const a = await reminderEventKey(base)
    const noisy = { ...base, note: '改成什么都行', used_count: 99 } as typeof base &
      Record<string, unknown>
    expect(a).toBe(await reminderEventKey(noisy))
    expect(a).not.toBe(await reminderEventKey({ ...base, deadline_before: '2026-12-01' }))
    expect(a).not.toBe(await reminderEventKey({ ...base, version: 'orv-2' }))
    expect(a.startsWith('op:expiry:oacc-1:regular:2026-10-01:')).toBe(true)
  })

  it('delivery_key 与 tag 按规范拼接', async () => {
    const event = await reminderEventKey({
      type: 'reset',
      object_id: 'oacc-2',
      cycle_or_grant_key: 'regular:2026-11-01',
      deadline_before: '2026-12-01',
      version: 'orv-2',
    })
    expect(reminderDeliveryKey(event, 'd3')).toBe(`${event}:d3`)
    expect(reminderDeliveryKey(event, 'snooze:2026-10-20T01:00:00Z')).toBe(
      `${event}:snooze:2026-10-20T01:00:00Z`,
    )
    expect(reminderTag(`${event}:d3`)).toBe(`wc-op:${event}:d3`)
  })
})

// ---------------------------------------------------------------------------
// Threshold nodes
// ---------------------------------------------------------------------------

describe('threshold nodes', () => {
  it('截止前 N 天节点按配置生成', () => {
    const nodes = expiryThresholds('2026-10-31', [7, 3, 1, 0])
    expect(nodes).toEqual([
      { step: 'd7', days_before: 7, local_date_on: '2026-10-24' },
      { step: 'd3', days_before: 3, local_date_on: '2026-10-28' },
      { step: 'd1', days_before: 1, local_date_on: '2026-10-30' },
      { step: 'd0', days_before: 0, local_date_on: '2026-10-31' },
    ])
  })

  it('claim 窗口节点区分 open 与截止', () => {
    const nodes = claimWindowNodes(
      { starts_at: '2026-10-20T16:00:00Z', ends_at: '2026-10-25T15:59:59Z' },
      [3, 0],
    )
    expect(nodes.open).toEqual({ step: 'open', days_before: 0, local_date_on: '2026-10-20' })
    expect(nodes.deadlines.map((n) => n.step)).toEqual(['d3', 'd0'])
    expect(nodes.deadlines[1].local_date_on).toBe('2026-10-25')
  })
})

// ---------------------------------------------------------------------------
// Wall-clock instants, DST, quiet hours
// ---------------------------------------------------------------------------

describe('localWallTimeToInstant', () => {
  it('北京午夜是纽约前一天', () => {
    const { utc, resolution } = localWallTimeToInstant('2026-10-16', '00:10', 'Asia/Shanghai')
    expect(utc).toBe('2026-10-15T16:10:00Z')
    expect(resolution).toBe('exact')
    // 对照：纽约墙钟同一天同一时刻相差 12/13 小时
    const ny = localWallTimeToInstant('2026-10-16', '00:10', 'America/New_York')
    expect(ny.utc).toBe('2026-10-16T04:10:00Z')
  })

  it('DST gap（春季跳时）顺延到第一个有效时刻', () => {
    // America/New_York 2026-03-08 02:00→03:00，02:30 不存在
    const r = localWallTimeToInstant('2026-03-08', '02:30', 'America/New_York')
    expect(r.resolution).toBe('gap_postponed')
    expect(r.utc).toBe('2026-03-08T07:00:00Z') // 03:00 当地
  })

  it('DST fold（秋季重复小时）取较早 UTC instant', () => {
    // America/New_York 2026-11-01 01:30 出现两次：05:30Z(EDT) 与 06:30Z(EST)
    const r = localWallTimeToInstant('2026-11-01', '01:30', 'America/New_York')
    expect(r.resolution).toBe('fold_earliest')
    expect(r.utc).toBe('2026-11-01T05:30:00Z')
  })

  it('非整半小时的 gap 仍顺延到跳变点', () => {
    const r = localWallTimeToInstant('2026-03-08', '02:59', 'America/New_York')
    expect(r.resolution).toBe('gap_postponed')
    expect(r.utc).toBe('2026-03-08T07:00:00Z')
  })

  it('非法输入被拒绝', () => {
    expect(() => localWallTimeToInstant('2026-02-30', '08:00', 'Asia/Shanghai')).toThrow(
      OpportunityError,
    )
    expect(() => localWallTimeToInstant('2026-10-16', '8:0', 'Asia/Shanghai')).toThrow(
      OpportunityError,
    )
    expect(() => localWallTimeToInstant('2026-10-16', '08:00', 'Mars/Olympus')).toThrow(
      OpportunityError,
    )
  })
})

describe('resolveDeliveryInstant（quiet hours）', () => {
  const tz = 'Asia/Shanghai'
  const quiet = { quiet_hours_start: '22:00', quiet_hours_end: '08:00' }

  it('深夜时刻顺延到次日 quiet end，凌晨顺延到当日 quiet end', () => {
    const lateNight = resolveDeliveryInstant('2026-10-16', '23:30', tz, quiet)
    expect(lateNight.utc).toBe('2026-10-17T00:00:00Z') // 10-17 08:00 北京
    expect(lateNight.postponed_by_quiet_hours).toBe(true)

    const earlyMorning = resolveDeliveryInstant('2026-10-16', '03:00', tz, quiet)
    expect(earlyMorning.utc).toBe('2026-10-16T00:00:00Z') // 10-16 08:00 北京
    expect(earlyMorning.postponed_by_quiet_hours).toBe(true)
  })

  it('白天时刻不受 quiet hours 影响', () => {
    const noon = resolveDeliveryInstant('2026-10-16', '12:00', tz, quiet)
    expect(noon.utc).toBe('2026-10-16T04:00:00Z')
    expect(noon.postponed_by_quiet_hours).toBe(false)
  })

  it('不跨午夜区间（12:00–13:00）只拦住该时段', () => {
    const q = { quiet_hours_start: '12:00', quiet_hours_end: '13:00' }
    expect(resolveDeliveryInstant('2026-10-16', '12:30', tz, q).postponed_by_quiet_hours).toBe(true)
    expect(resolveDeliveryInstant('2026-10-16', '13:30', tz, q).postponed_by_quiet_hours).toBe(false)
    expect(resolveDeliveryInstant('2026-10-16', '11:30', tz, q).postponed_by_quiet_hours).toBe(false)
  })

  it('quiet end 落在 DST gap 时继续顺延', () => {
    // 纽约 2026-03-08 08:00 存在；改用 02:30 作为 quiet end 验证顺延
    const q = { quiet_hours_start: '01:00', quiet_hours_end: '02:30' }
    const r = resolveDeliveryInstant('2026-03-08', '01:30', 'America/New_York', q)
    // 01:30 在 quiet 区间内，end=02:30 不存在 → 顺延到 03:00 = 07:00Z
    expect(r.utc).toBe('2026-03-08T07:00:00Z')
    expect(r.postponed_by_quiet_hours).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Reminder state transitions
// ---------------------------------------------------------------------------

describe('reminder state transitions', () => {
  const base: ReminderStateSnapshot = {
    read_steps: [],
    dismissed_at: null,
    snooze_until: null,
    revision: 3,
  }

  it('read 累计去重并封顶 16 个 step', () => {
    let s = applyReminderStateAction(base, 'read', { step: 'd3', now: NOW })
    expect(s.read_steps).toEqual(['d3'])
    s = applyReminderStateAction(s, 'read', { step: 'd3', now: NOW })
    expect(s.read_steps).toEqual(['d3'])
    let filled = { ...base, read_steps: Array.from({ length: MAX_READ_STEPS }, (_, i) => `s${i}`) }
    expect(() =>
      applyReminderStateAction(filled, 'read', { step: 'new', now: NOW }),
    ).toThrow(OpportunityError)
    expect(() =>
      applyReminderStateAction(filled, 'read', { step: `s0`, now: NOW }),
    ).not.toThrow() // 已读 step 重复读取不新增
  })

  it('dismiss 屏蔽整个事件，restore 恢复并清空 snooze', () => {
    const dismissed = applyReminderStateAction(base, 'dismiss', { now: NOW })
    expect(dismissed.dismissed_at).toBe(NOW)
    const restored = applyReminderStateAction(dismissed, 'restore', { now: NOW })
    expect(restored.dismissed_at).toBeNull()
    // 未 dismissed 时 restore 报错
    expect(() => applyReminderStateAction(base, 'restore', { now: NOW })).toThrow(OpportunityError)
  })

  it('snooze 越过截止被拒；正常 snooze 记录 until 并推进 revision', () => {
    expect(() =>
      applyReminderStateAction(base, 'snooze', {
        now: NOW,
        until_utc: '2026-11-02T00:00:00Z',
        deadline_utc: '2026-11-01T00:00:00Z',
      }),
    ).toThrow(OpportunityError)
    const s = applyReminderStateAction(base, 'snooze', {
      now: NOW,
      until_utc: '2026-10-20T00:00:00Z',
      deadline_utc: '2026-11-01T00:00:00Z',
    })
    expect(s.snooze_until).toBe('2026-10-20T00:00:00Z')
    expect(s.revision).toBe(base.revision + 1)
    // until 早于 now 也被拒
    expect(() =>
      applyReminderStateAction(base, 'snooze', {
        now: NOW,
        until_utc: '2026-10-01T00:00:00Z',
        deadline_utc: '2026-11-01T00:00:00Z',
      }),
    ).toThrow(OpportunityError)
  })

  it('row 与快照互转并校验', () => {
    const row = {
      read_steps_json: '["d7","d3"]',
      dismissed_at: null,
      snooze_until: null,
      revision: 2,
    }
    const snap = reminderStateFromRow(row)
    expect(snap.read_steps).toEqual(['d7', 'd3'])
    expect(() => reminderStateFromRow({ ...row, read_steps_json: '[1,2]' })).toThrow(
      OpportunityError,
    )
  })
})
