// lib/__tests__/opportunity-calendar.test.ts — calendar events and personal
// reminder state (plan Task 14 second half): static P1 events (expiry/reset/
// claim windows), 92-day range guard, scope isolation, unverified rules only
// as review items, dismiss/snooze/restore persistence with revision CAS, and
// snooze-past-deadline refusal at the service boundary.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import {
  getOpportunityCalendar,
  getOpportunityReminders,
  updateOpportunityReminderState,
} from '../opportunities/notifications.server'
import { buildCycleCalendarEvents } from '../opportunities/reminders'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor, RuleSnapshotV1 } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'

const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

let seq = 0
const rk = (tag: string) => `calendar-rk-${tag}-${String(++seq).padStart(4, '0')}`

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '日历验证权益',
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
    ...over,
  }
}

async function seedWorld(ruleSet: RuleSnapshotV1, verification: 'unverified' | 'user_confirmed' = 'user_confirmed') {
  const n = ++seq
  const defId = `odef-cal-${n}`
  const versionId = `orv-cal-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, ?, '2026-01-01T00:00:00Z')`,
    ).bind(versionId, defId, JSON.stringify(ruleSet), verification),
  ])
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk('acc'),
  }, { now: NOW })
  if (!created.cycle) throw new Error('no cycle')
  return { defId, versionId, ...created }
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

describe('buildCycleCalendarEvents（纯函数）', () => {
  it('到期=最后可用日，重置=下期首日；领取窗口生成开启与截止两个事件', async () => {
    const events = await buildCycleCalendarEvents({
      account_id: 'acc-1', cycle_id: 'cyc-1', title: '观影券', time_zone: 'Asia/Shanghai',
      usable_start_on: '2026-10-01', usable_end_before: '2026-11-01', next_reset_on: '2026-11-01',
      claim_window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-25T00:00:00Z' },
      version_id: 'ver-1', verification: 'user_confirmed',
    })
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e]))
    expect(byKind.cycle_expiry.local_date_on).toBe('2026-10-31') // 半开区间的最后可用日
    expect(byKind.cycle_reset.local_date_on).toBe('2026-11-01')
    expect(byKind.claim_window_open.local_date_on).toBe('2026-10-20')
    expect(byKind.claim_window_deadline.local_date_on).toBe('2026-10-25')
    // event_key 稳定：同输入两次构建一致
    const again = await buildCycleCalendarEvents({
      account_id: 'acc-1', cycle_id: 'cyc-1', title: '观影券（改名不影响键）', time_zone: 'Asia/Shanghai',
      usable_start_on: '2026-10-01', usable_end_before: '2026-11-01', next_reset_on: '2026-11-01',
      claim_window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-25T00:00:00Z' },
      version_id: 'ver-1', verification: 'user_confirmed',
    })
    expect(again.map((e) => e.event_key)).toEqual(events.map((e) => e.event_key))
  })

  it('one_time 无重置事件；无截止不生成到期事件', async () => {
    const events = await buildCycleCalendarEvents({
      account_id: 'acc-2', cycle_id: 'cyc-2', title: 'x', time_zone: 'Asia/Shanghai',
      usable_start_on: '2026-10-01', usable_end_before: null, next_reset_on: null,
      claim_window: null, version_id: 'ver-2', verification: 'official_verified',
    })
    expect(events).toEqual([])
  })
})

describe('getOpportunityCalendar', () => {
  it('92 天窗口校验 + 范围过滤 + scope 隔离', async () => {
    await seedWorld(rules())
    // 区间半开：含 10-31 到期、11-01 重置，不含 11-02
    const oct = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-11-02' })
    expect(oct.events.map((e) => e.kind).sort()).toEqual(['cycle_expiry', 'cycle_reset'])
    expect(oct.events.every((e) => e.local_date_on >= '2026-10-01' && e.local_date_on < '2026-11-02')).toBe(true)

    await expect(
      getOpportunityCalendar(actorAdminA, { from_on: '2026-01-01', to_before: '2026-12-31' }),
    ).rejects.toBeInstanceOf(OpportunityError) // >92 天

    // B 看不到 A 的事件
    const theirs = await getOpportunityCalendar(actorAdminB, { from_on: '2026-10-01', to_before: '2026-11-01' })
    expect(theirs.events).toEqual([])
  })

  it('未核实定义的事件带 needs_review 标记', async () => {
    await seedWorld(rules(), 'unverified')
    const cal = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-11-01' })
    expect(cal.events.length).toBeGreaterThan(0)
    expect(cal.events.every((e) => e.needs_review)).toBe(true)
  })
})

describe('getOpportunityReminders + 状态机', () => {
  it('未核实事件不进提醒；dismiss 后消失，restore 恢复；snooze 越过截止被拒', async () => {
    await seedWorld(rules())
    await seedWorld(rules({ title: '待复核' }), 'unverified')

    const reminders = await getOpportunityReminders(actorAdminA, {})
    expect(reminders.items.length).toBeGreaterThan(0)
    expect(reminders.items.every((i) => !i.event.needs_review)).toBe(true)

    // dismiss 第一个事件
    const target = reminders.items[0]
    await updateOpportunityReminderState(actorAdminA, {
      event_key: target.event.event_key, action: 'dismiss',
    }, { now: NOW })
    const afterDismiss = await getOpportunityReminders(actorAdminA, {})
    expect(afterDismiss.items.find((i) => i.event.event_key === target.event.event_key)).toBeUndefined()

    // restore 恢复
    await updateOpportunityReminderState(actorAdminA, {
      event_key: target.event.event_key, action: 'restore',
    }, { now: NOW })
    const afterRestore = await getOpportunityReminders(actorAdminA, {})
    expect(afterRestore.items.find((i) => i.event.event_key === target.event.event_key)).toBeTruthy()

    // snooze 越过截止（deadline = 截止日次日 00:00Z 近似）被拒
    await expect(
      updateOpportunityReminderState(actorAdminA, {
        event_key: target.event.event_key, action: 'snooze',
        until_at: '2026-12-01T00:00:00Z', deadline_utc: '2026-11-01T00:00:00Z',
      }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)

    // 正常 snooze 在窗口内生效且 revision 推进
    const r1 = await updateOpportunityReminderState(actorAdminA, {
      event_key: target.event.event_key, action: 'snooze',
      until_at: '2026-10-20T00:00:00Z', deadline_utc: '2026-11-01T00:00:00Z',
    }, { now: NOW })
    expect(r1.revision).toBeGreaterThan(target.state.revision)
    // 过期 revision 拒绝
    await expect(
      updateOpportunityReminderState(actorAdminA, {
        event_key: target.event.event_key, action: 'restore', expected_revision: target.state.revision,
      }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
  })

  it('越权事件（他人账户）拒绝', async () => {
    await seedWorld(rules())
    const cal = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-11-01' })
    await expect(
      updateOpportunityReminderState(actorAdminB, {
        event_key: cal.events[0].event_key, action: 'dismiss',
      }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
  })
})
