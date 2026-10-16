// lib/__tests__/opportunity-task-reminders.test.ts — P2 calendar/reminder
// linkage (plan Task 22): task deadlines always appear, reward windows only
// after manual satisfaction, booking service events exist only while the
// booking is recorded (cancelling removes the reminder), and personal states
// authorize through the task/fulfillment holder — not through accounts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createOpportunityAccount } from '../opportunities/accounts.server'
import { saveOpportunityTask, updateManualTaskProgress, getOpportunityTasks } from '../opportunities/tasks.server'
import { recordOpportunityBooking, cancelOpportunityBooking } from '../opportunities/fulfillments.server'
import {
  getOpportunityCalendar,
  getOpportunityReminders,
  updateOpportunityReminderState,
} from '../opportunities/notifications.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor } from '../opportunities/types'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'
const actorAdminA: OpportunityActor = { user_id: f.users.adminA, role: 'admin' }
const actorAdminB: OpportunityActor = { user_id: f.users.adminB, role: 'admin' }

let seq = 0
const rk = () => `task22-rk-run-${String(++seq).padStart(4, '0')}`

async function seedTask() {
  const saved = await saveOpportunityTask(actorAdminA, {
    holder_id: f.holders.self,
    task_type: 'monthly_spend',
    title: '联动任务',
    card_ids: [f.cards.selfMain],
    rules: {
      schema_version: 1,
      currency: 'CNY',
      groups: [{ id: 'g1', metrics: [{ id: 'amt', kind: 'amount', target_minor: 100_000 }] }],
      eligible_spend_notes: null,
    },
    reward: { kind: 'quota', title: '礼券', reward_key: 'gift', count: 1, amount_minor: null, currency: 'CNY' },
    window: { from_day: 10, until_day: 15 },
    request_key: rk(),
  }, { now: NOW })
  const views = await getOpportunityTasks(actorAdminA, {}, { now: NOW })
  const view = views.find((v) => v.task_id === saved.task_id)!
  return { taskId: saved.task_id, taskCycleId: view.cycle!.id }
}

async function seedBookingWorld() {
  const n = ++seq
  const defId = `odef-t22-${n}`
  await db.batch([
    db.prepare(
      `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
       VALUES (?, 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`,
    ).bind(defId, f.users.adminA),
    db.prepare(
      `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
       VALUES (?, ?, 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`,
    ).bind(`orv-t22-${n}`, defId, JSON.stringify({
      schema_version: 1, title: '联动权益', description: null, category: 'other', time_zone: 'Asia/Shanghai',
      bank_id: null, card_product_ids: [f.products.cmbClassic], valid_from: null, valid_until_before: null,
      open_ended: true, weekdays: null,
      cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
      allocation: 'recurring', count_limit: 4, amount_limit_minor: null, currency: null, unit_label: '次',
      eligibility_text: null, requires_personal_confirmation: false, claim_window: null, booking_window: null,
      workflow_time_basis: 'fixed', booking_consumes: 'reserve_then_use', cancellation_rule: 'confirm_with_issuer',
      entry: { website_url: null, app_name: null, app_path: null },
    })),
  ])
  const created = await createOpportunityAccount(actorAdminA, {
    definition_id: defId, holder_id: f.holders.self,
    card_ids: [f.cards.selfMain], scope_kind: 'card', request_key: rk(),
  }, { now: NOW })
  if (!created.cycle) throw new Error('no cycle')
  return { account: created.account, cycle: created.cycle }
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

describe('P2 日历联动', () => {
  it('任务截止始终出现；奖励窗口只在手动达标后出现', async () => {
    const task = await seedTask()
    const before = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-12-31' })
    expect(before.events.map((e) => e.kind)).toContain('task_deadline')
    expect(before.events.map((e) => e.kind)).not.toContain('reward_window')

    await updateManualTaskProgress(actorAdminA, {
      task_cycle_id: task.taskCycleId,
      progress: { as_of_on: '2026-10-15', metric_values: { amt: 100_000 }, note: null },
      reason: '达标', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    const after = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-12-31' })
    const window = after.events.find((e) => e.kind === 'reward_window')
    expect(window).toBeTruthy()
    expect(window!.local_date_on).toBe('2026-11-10')
  })

  it('预约服务提醒只在 recorded 状态存在；取消后消失', async () => {
    const world = await seedBookingWorld()
    const booking = await recordOpportunityBooking(actorAdminA, {
      account_id: world.account.id, cycle_id: world.cycle.id, card_id: f.cards.selfMain,
      service_at: '2026-10-20T19:00:00+08:00', service_time_zone: 'Asia/Shanghai',
      quantity: 1, amount_minor: 0, request_key: rk(),
    }, { now: NOW })
    const withBooking = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-19', to_before: '2026-10-21' })
    expect(withBooking.events.map((e) => e.kind)).toContain('booking_service')

    await cancelOpportunityBooking(actorAdminA, {
      fulfillment_id: booking.fulfillment_id, settlement: 'returned',
      reason: '改期', expected_revision: 1, request_key: rk(),
    }, { now: NOW })
    const afterCancel = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-19', to_before: '2026-10-21' })
    expect(afterCancel.events.map((e) => e.kind)).not.toContain('booking_service')
  })

  it('P2 事件状态机按任务/履约持卡人鉴权（B 无法操作 A 的事件）', async () => {
    const task = await seedTask()
    const cal = await getOpportunityCalendar(actorAdminA, { from_on: '2026-10-01', to_before: '2026-12-31' })
    const deadline = cal.events.find((e) => e.kind === 'task_deadline')!
    await updateOpportunityReminderState(actorAdminA, {
      event_key: deadline.event_key, action: 'dismiss',
    }, { now: NOW })
    await expect(
      updateOpportunityReminderState(actorAdminB, { event_key: deadline.event_key, action: 'restore' }, { now: NOW }),
    ).rejects.toBeInstanceOf(OpportunityError)
    void task
  })

  it('提醒列表包含 P2 事件且满足窗口内出现', async () => {
    await seedTask()
    const reminders = await getOpportunityReminders(actorAdminA, {})
    const kinds = reminders.items.map((i) => i.event.kind)
    // 任务截止 11-01 在 30 天窗口内
    expect(kinds).toContain('task_deadline')
  })
})
