import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import type { SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import {
  buildDailyNotificationCandidates,
  ensureDailyNotificationsForUser,
} from '../notifications-engine.server'
import {
  computeCardGraceWindowOnDate,
  isInQuietHours,
  isNewLongestGracePeriodDay,
} from '../notifications.shared'
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications.server'

const { mockSendNotification, mockSetVapidDetails } = vi.hoisted(() => ({
  mockSendNotification: vi.fn(),
  mockSetVapidDetails: vi.fn(),
}))

vi.mock('web-push', () => ({
  default: {
    sendNotification: mockSendNotification,
    setVapidDetails: mockSetVapidDetails,
  },
}))

import { handleScheduled } from '../../worker/cron'
import { scanOpportunityNotifications } from '../../worker/opportunity-cron'

async function seedWorld(db: SqliteD1) {
  await db.batch([
    db
      .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
      .bind('user-a', 'a@test.local', 'hash-a', '用户A', 'admin'),
    db
      .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
      .bind('user-b', 'b@test.local', 'hash-b', '用户B', 'member'),
    db
      .prepare(`INSERT INTO card_holders (id, created_by, managed_by, name) VALUES (?, ?, ?, ?)`)
      .bind('holder-a', 'user-a', 'user-a', '持卡人甲'),
    db
      .prepare(`INSERT INTO card_holders (id, created_by, managed_by, name) VALUES (?, ?, ?, ?)`)
      .bind('holder-b', 'user-b', 'user-b', '持卡人乙'),
    db.prepare(`INSERT INTO banks (id, name) VALUES (?, ?)`).bind('bank-cmb', '招商银行'),
    db
      .prepare(
        `INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('prod-cny', 'bank-cmb', '招商银行', '经典白', 'CNY', 'after_billing', 20),
    db
      .prepare(
        `INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('prod-usd', 'bank-cmb', '招商银行', '全币白', 'USD', 'fixed', 25),
    db
      .prepare(
        `INSERT INTO user_preferences (id, user_id, reminder_config) VALUES (?, ?, ?)`
      )
      .bind(
        'pref-a',
        'user-a',
        JSON.stringify({
          remind_days_before: [3, 1, 0],
          quiet_hours_start: '22:00',
          quiet_hours_end: '08:00',
          enabled_channels: ['web_push'],
        })
      ),
  ])
}

describe('主动通知增强 + 通知中心 + 全部通知项开关', () => {
  let db: SqliteD1

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)
    mockSendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
    mockSetVapidDetails.mockReset()
    await seedWorld(db)
  })

  afterEach(() => {
    setDb(null)
    db.close()
  })

  describe('当日待还主动通知与独立开关', () => {
    it('汇总信用卡账单（含覆盖到期日与已还扣除）及固定支出，按币种拆分总额', async () => {
      await db.batch([
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
             VALUES (?, ?, ?, ?, ?, 'active', 'credit')`
          )
          .bind('card-1', 'holder-a', 'prod-cny', '8888', 20),
        db
          .prepare(
            `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, due_date_override, status)
             VALUES (?, ?, ?, ?, ?, ?, 'partial')`
          )
          .bind('bill-1', 'card-1', '2026-05', 1500, '2026-05-05', '2026-05-10'),
        db
          .prepare(
            `INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind('pmt-1', 'bill-1', 500, '2026-05-06', 'idem-pmt-1'),
        db
          .prepare(
            `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .bind('pay-usd', 'user-a', '海外主机', 'utility', 150, 'USD', 10, 'holder-a'),
        db
          .prepare(
            `INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind('rpay-1', 'pay-usd', '2026-05', 50, '2026-05-08'),
      ])

      const { candidates } = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-10'
      )
      const summary = candidates.find(c => c.notification_key === 'due_today_summary:2026-05-10')
      expect(summary).toBeTruthy()
      expect(summary!.category).toBe('bill_due_today')
      expect(summary!.title).toContain('¥1,000')
      expect(summary!.title).toContain('$100')
      expect(summary!.title).toContain('共 2 笔')
      expect(summary!.body).toContain('8888')
      expect(summary!.body).toContain('海外主机')

      const meta = JSON.parse(summary!.metadata_json!)
      expect(meta.totals_by_currency).toEqual({ CNY: 1000, USD: 100 })
      expect(meta.bills).toHaveLength(1)
      expect(meta.bills[0].remaining).toBe(1000)
      expect(meta.payables).toHaveLength(1)
      expect(meta.payables[0].remaining).toBe(100)

      // 仅关闭 bill_due_today，只保留固定支出进入当日汇总
      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(
          JSON.stringify({
            remind_days_before: [3, 1, 0],
            items: { bill_due_today: false, payable_due_today: true },
          }),
          'user-a'
        )
        .run()

      const payablesOnly = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-10'
      )
      const paySummary = payablesOnly.candidates.find(
        c => c.notification_key === 'due_today_summary:2026-05-10'
      )
      expect(paySummary).toBeTruthy()
      expect(paySummary!.category).toBe('payable_due_today')
      expect(paySummary!.title).toContain('$100')
      expect(paySummary!.title).toContain('共 1 笔')
      expect(paySummary!.body).not.toContain('8888')

      // 两项都关闭时不生成当日待还汇总
      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(
          JSON.stringify({
            remind_days_before: [3, 1, 0],
            items: { bill_due_today: false, payable_due_today: false },
          }),
          'user-a'
        )
        .run()
      const none = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-10'
      )
      expect(none.candidates.some(c => c.notification_key.startsWith('due_today_summary:'))).toBe(false)
    })

    it('grace_period_longest 按账单日次日触发、支持 2 月月末钳制、合并账户去重并排除贷款卡', async () => {
      expect(isNewLongestGracePeriodDay(10, '2026-05-10')).toBe(false)
      expect(isNewLongestGracePeriodDay(10, '2026-05-11')).toBe(true)
      expect(isNewLongestGracePeriodDay(31, '2026-02-28')).toBe(false)
      expect(isNewLongestGracePeriodDay(31, '2026-03-01')).toBe(true)

      const win = computeCardGraceWindowOnDate(
        { billing_day: 31, payment_due_type: 'after_billing', payment_due_value: 20 },
        '2026-03-01'
      )
      expect(win.nextBillingDate).toBe('2026-03-31')
      expect(win.nextDueDate).toBe('2026-04-20')
      expect(win.graceDays).toBe(50)

      await db.batch([
        db
          .prepare(
            `INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, billing_day, due_type, due_value, status)
             VALUES (?, ?, ?, ?, 'CNY', 'merged', 'shared', 10, 'after_billing', 20, 'active')`
          )
          .bind('acc-merged', 'holder-a', 'bank-cmb', '招商银行'),
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, account_id, card_number_last4, billing_day, status, card_type)
             VALUES (?, ?, ?, ?, ?, 10, 'active', 'credit')`
          )
          .bind('card-m1', 'holder-a', 'prod-cny', 'acc-merged', '1001'),
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, account_id, card_number_last4, billing_day, status, card_type)
             VALUES (?, ?, ?, ?, ?, 10, 'active', 'credit')`
          )
          .bind('card-m2', 'holder-a', 'prod-cny', 'acc-merged', '1002'),
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
             VALUES (?, ?, ?, ?, 28, 'active', 'credit')`
          )
          .bind('card-eom', 'holder-a', 'prod-usd', '3131'),
        db
          .prepare(
            `UPDATE credit_cards SET billing_day = 31 WHERE id = 'card-eom'`
          ),
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, status, card_type, loan_due_day)
             VALUES (?, ?, ?, 10, 'active', 'loan', 10)`
          )
          .bind('card-loan', 'holder-a', 'prod-cny'),
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, status, card_type)
             VALUES (?, ?, ?, 10, 'frozen', 'credit')`
          )
          .bind('card-frozen', 'holder-a', 'prod-cny'),
      ])

      // 2026-05-11：合并账户 2 张卡合并去重成 1 条，贷款卡与冻结卡不进入
      const may11 = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-11'
      )
      const mayGrace = may11.candidates.find(c => c.notification_key === 'grace_longest:2026-05-11')
      expect(mayGrace).toBeTruthy()
      const mayMeta = JSON.parse(mayGrace!.metadata_json!)
      expect(mayMeta.cards).toHaveLength(1)

      // 2026-03-01：billing_day=31 于 2/28 次日触发
      const mar1 = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-03-01'
      )
      const marGrace = mar1.candidates.find(c => c.notification_key === 'grace_longest:2026-03-01')
      expect(marGrace).toBeTruthy()
      const marMeta = JSON.parse(marGrace!.metadata_json!)
      expect(marMeta.cards).toHaveLength(1)
      expect(marMeta.cards[0].cardId).toBe('card-eom')

      // 关闭 grace_period_longest 开关
      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(JSON.stringify({ items: { grace_period_longest: false } }), 'user-a')
        .run()
      const disabled = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-11'
      )
      expect(disabled.candidates.some(c => c.category === 'grace_period_longest')).toBe(false)
    })

    it('支持提前提醒/逾期开关与跨午夜免打扰判断', async () => {
      await db.batch([
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
             VALUES (?, ?, ?, ?, 1, 'active', 'credit')`
          )
          .bind('card-adv', 'holder-a', 'prod-cny', '7777'),
        db
          .prepare(
            `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
             VALUES (?, ?, ?, ?, ?, 'unpaid')`
          )
          .bind('bill-adv', 'card-adv', '2026-05', 800, '2026-05-13'),
        db
          .prepare(
            `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
             VALUES (?, ?, ?, ?, ?, 'overdue')`
          )
          .bind('bill-ov', 'card-adv', '2026-04', 600, '2026-05-01'),
        db
          .prepare(
            `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .bind('pay-adv', 'user-a', '房租', 'rent', 4000, 'CNY', 13, 'holder-a'),
      ])

      const allOn = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-10'
      )
      expect(allOn.candidates.some(c => c.category === 'bill_due_advance')).toBe(true)
      expect(allOn.candidates.some(c => c.category === 'payable_due_advance')).toBe(true)
      expect(allOn.candidates.some(c => c.category === 'bill_overdue')).toBe(true)

      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(
          JSON.stringify({
            remind_days_before: [3],
            items: {
              bill_due_advance: false,
              payable_due_advance: false,
              bill_overdue: false,
            },
          }),
          'user-a'
        )
        .run()

      const gated = await buildDailyNotificationCandidates(
        db as unknown as D1Database,
        'user-a',
        '2026-05-10'
      )
      expect(gated.candidates.some(c => c.category === 'bill_due_advance')).toBe(false)
      expect(gated.candidates.some(c => c.category === 'payable_due_advance')).toBe(false)
      expect(gated.candidates.some(c => c.category === 'bill_overdue')).toBe(false)

      // 2026-05-10T15:30:00Z = Asia/Shanghai 23:30，应命中 22:00-08:00 免打扰
      expect(
        isInQuietHours(new Date('2026-05-10T15:30:00Z'), 'Asia/Shanghai', '22:00', '08:00')
      ).toBe(true)
      // 2026-05-10T02:00:00Z = Asia/Shanghai 10:00，不在免打扰时段
      expect(
        isInQuietHours(new Date('2026-05-10T02:00:00Z'), 'Asia/Shanghai', '22:00', '08:00')
      ).toBe(false)
    })
  })

  describe('通知中心 6 个 RPC、跨用户隔离与软删除防复活', () => {
    it('支持查询、未读筛选、单条/全部已读、单条/全部软删除及跨用户隔离', async () => {
      await db.batch([
        db
          .prepare(
            `INSERT INTO notification_history (id, user_id, notification_key, category, title, body, sent_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped')`
          )
          .bind('n-a1', 'user-a', 'k-a1', 'bill_due_today', '今日账单A1', '正文A1', '2026-05-10T01:00:00.000Z'),
        db
          .prepare(
            `INSERT INTO notification_history (id, user_id, notification_key, category, title, body, sent_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped')`
          )
          .bind('n-a2', 'user-a', 'k-a2', 'grace_period_longest', '最长免息A2', '正文A2', '2026-05-10T02:00:00.000Z'),
        db
          .prepare(
            `INSERT INTO notification_history (id, user_id, notification_key, category, title, body, sent_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped')`
          )
          .bind('n-b1', 'user-b', 'k-b1', 'system', '用户B通知', '正文B1', '2026-05-10T03:00:00.000Z'),
      ])

      const pageAll = await getNotifications('user-a', { syncToday: false })
      expect(pageAll.total_count).toBe(2)
      expect(pageAll.unread_count).toBe(2)
      expect(pageAll.items.map(i => i.id)).toEqual(['n-a2', 'n-a1'])

      // 跨用户隔离：user-b 看不到、读不了、删不了 user-a 的通知
      const pageB = await getNotifications('user-b', { syncToday: false })
      expect(pageB.items.map(i => i.id)).toEqual(['n-b1'])
      const illegalRead = await markNotificationRead('user-b', 'n-a1')
      expect(illegalRead.updated).toBe(false)
      const illegalDelete = await deleteNotification('user-b', 'n-a1')
      expect(illegalDelete.deleted).toBe(false)

      // 单条已读 + 未读筛选
      const readRes = await markNotificationRead('user-a', 'n-a1')
      expect(readRes.updated).toBe(true)
      expect(readRes.unread_count).toBe(1)

      const unreadOnly = await getNotifications('user-a', { filter: 'unread', syncToday: false })
      expect(unreadOnly.items.map(i => i.id)).toEqual(['n-a2'])

      // 全部已读
      const bulkRead = await markAllNotificationsRead('user-a')
      expect(bulkRead.updated_count).toBe(1)
      expect(bulkRead.unread_count).toBe(0)

      // 单条软删除 + 全部软删除
      const delOne = await deleteNotification('user-a', 'n-a1')
      expect(delOne.deleted).toBe(true)
      const remainingA = await getNotifications('user-a', { syncToday: false })
      expect(remainingA.items.map(i => i.id)).toEqual(['n-a2'])

      const delAll = await deleteAllNotifications('user-a')
      expect(delAll.deleted_count).toBe(1)
      expect(delAll.unread_count).toBe(0)

      // user-b 自己的通知不受影响
      expect(await getUnreadNotificationCount('user-b')).toBe(1)
    })

    it('当日待还通知删除后不会因再次打开通知中心而复活', async () => {
      await db.batch([
        db
          .prepare(
            `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .bind('pay-keep', 'user-a', '水电网费', 'utility', 200, 'CNY', 10, 'holder-a'),
      ])

      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
      const dueDayNum = Number(todayStr.split('-')[2])
      await db
        .prepare(`UPDATE recurring_payables SET due_day = ? WHERE id = 'pay-keep'`)
        .bind(dueDayNum)
        .run()

      await ensureDailyNotificationsForUser(db as unknown as D1Database, 'user-a', todayStr)
      const firstPage = await getNotifications('user-a', { syncToday: true })
      const summary = firstPage.items.find(i => i.notification_key === `due_today_summary:${todayStr}`)
      expect(summary).toBeTruthy()

      await deleteNotification('user-a', summary!.id)
      // 再次同步当日候选，已软删记录保持 deleted_at 非空，绝不复活
      await ensureDailyNotificationsForUser(db as unknown as D1Database, 'user-a', todayStr)
      const afterReSync = await getNotifications('user-a', { syncToday: true })
      expect(afterReSync.items.some(i => i.id === summary!.id)).toBe(false)
    })
  })

  describe('Cron 站内生成与 push_sent_at 单次推送语义', () => {
    it('无推送订阅时仍保留站内记录；有订阅时只推送一次并跳过已读/已删通知', async () => {
      await db
        .prepare(
          `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind('pay-cron', 'user-a', '房贷', 'loan', 5000, 'CNY', 15, 'holder-a')
        .run()

      // 2026-05-15T01:00:00Z = 2026-05-15 09:00 Asia/Shanghai（非免打扰）
      const scheduledAt = Date.parse('2026-05-15T01:00:00Z')

      // 1) 无任何 push_subscriptions 时依然写入站内 notification_history
      await handleScheduled(
        { scheduledTime: scheduledAt } as ScheduledEvent,
        { DB: db as unknown as D1Database },
        {} as ExecutionContext
      )
      const inboxRow = await db
        .prepare(
          `SELECT status, push_sent_at, title FROM notification_history WHERE user_id = 'user-a' AND notification_key = 'due_today_summary:2026-05-15'`
        )
        .first<{ status: string; push_sent_at: string | null; title: string }>()
      expect(inboxRow).toBeTruthy()
      expect(inboxRow!.status).toBe('skipped')
      expect(inboxRow!.push_sent_at).toBeNull()
      expect(mockSendNotification).not.toHaveBeenCalled()

      // 2) 添加一条 Web Push 订阅并传入 VAPID：补推一次并写入 push_sent_at
      await db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
           VALUES ('sub-1', 'user-a', 'https://push.example/1', 'p256', 'auth')`
        )
        .run()

      await handleScheduled(
        { scheduledTime: scheduledAt } as ScheduledEvent,
        {
          DB: db as unknown as D1Database,
          VAPID_PUBLIC_KEY: 'pub',
          VAPID_PRIVATE_KEY: 'priv',
          VAPID_SUBJECT: 'mailto:test@test.local',
        },
        {} as ExecutionContext
      )
      expect(mockSendNotification).toHaveBeenCalledTimes(1)
      const afterPush = await db
        .prepare(
          `SELECT status, push_sent_at FROM notification_history WHERE user_id = 'user-a' AND notification_key = 'due_today_summary:2026-05-15'`
        )
        .first<{ status: string; push_sent_at: string | null }>()
      expect(afterPush!.status).toBe('sent')
      expect(afterPush!.push_sent_at).toBeTruthy()

      // 3) 同日再次执行 Cron：push_sent_at 已有值，不再重复发送
      mockSendNotification.mockClear()
      await handleScheduled(
        { scheduledTime: scheduledAt } as ScheduledEvent,
        {
          DB: db as unknown as D1Database,
          VAPID_PUBLIC_KEY: 'pub',
          VAPID_PRIVATE_KEY: 'priv',
        },
        {} as ExecutionContext
      )
      expect(mockSendNotification).not.toHaveBeenCalled()
    })

    it('worker/opportunity-cron 遵守细分开关并将发送结果落入 notification_history', async () => {
      const ruleJson = JSON.stringify({
        schema_version: 1,
        title: '机场贵宾厅',
        description: null,
        category: 'travel',
        time_zone: 'Asia/Shanghai',
        bank_id: 'bank-cmb',
        card_product_ids: ['prod-cny'],
        valid_from: '2026-01-01',
        valid_until_before: null,
        open_ended: true,
        weekdays: null,
        cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
        allocation: 'recurring',
        count_limit: 2,
        amount_limit_minor: null,
        currency: null,
        unit_label: '次',
        eligibility_text: null,
        requires_personal_confirmation: false,
        claim_window: null,
        booking_window: null,
        workflow_time_basis: 'per_cycle',
        booking_consumes: 'reserve_then_use',
        cancellation_rule: 'confirm_with_issuer',
        entry: {},
      })

      await db.batch([
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, status, card_type)
             VALUES ('card-opp', 'holder-a', 'prod-cny', 10, 'active', 'credit')`
          ),
        db
          .prepare(
            `INSERT INTO opportunity_definitions (id, kind, visibility, status, created_by, created_at)
             VALUES ('def-exp', 'benefit', 'shared', 'active', 'user-a', '2026-01-01T00:00:00Z')`
          ),
        db
          .prepare(
            `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
             VALUES ('ver-exp', 'def-exp', 1, '2026-01-01', ?, 'official_verified', '2026-01-01T00:00:00Z')`
          )
          .bind(ruleJson),
        db
          .prepare(
            `INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, eligibility, status, created_by, created_at)
             VALUES ('oacc-exp', 'def-exp', 'holder-a', 'card', 'card-opp', 'confirmed', 'active', 'user-a', '2026-01-01T00:00:00Z')`
          ),
        db
          .prepare(
            `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
             VALUES ('oacc-exp', 'def-exp', 'holder-a', 'card-opp')`
          ),
        db
          .prepare(
            `INSERT INTO opportunity_cycles (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind, activation_state, period_start_on, period_end_before, usable_start_on, usable_end_before, time_zone, count_limit, created_at)
             VALUES ('cyc-exp', 'oacc-exp', 'ver-exp', '2026-05-01', '2026-05', 'regular', 'active', '2026-05-01', '2026-06-01', '2026-05-01', '2026-06-01', 'Asia/Shanghai', 2, '2026-05-01T00:00:00Z')`
          ),
        db
          .prepare(
            `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
             VALUES ('sub-opp', 'user-a', 'https://push.example/opp', 'p256', 'auth')`
          ),
      ])

      const sender = vi.fn().mockResolvedValue({ ok: true })
      const now = new Date('2026-05-31T01:00:00Z')

      // 关闭 opportunity_expiry 时跳过触发，不产生站内历史
      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(JSON.stringify({ items: { opportunity_expiry: false } }), 'user-a')
        .run()
      await scanOpportunityNotifications({
        db: db as unknown as D1Database,
        now,
        sender,
      })
      expect(sender).not.toHaveBeenCalled()

      // 打开 opportunity_expiry 后触发发送并写入 notification_history（opp:<delivery_key>）
      await db
        .prepare(`UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?`)
        .bind(JSON.stringify({ items: { opportunity_expiry: true } }), 'user-a')
        .run()
      const report = await scanOpportunityNotifications({
        db: db as unknown as D1Database,
        now,
        sender,
      })
      expect(report.sent).toBeGreaterThanOrEqual(1)
      expect(sender).toHaveBeenCalled()
      const hist = await db
        .prepare(
          `SELECT notification_key, category, push_sent_at FROM notification_history WHERE user_id = 'user-a' AND notification_key LIKE 'opp:%'`
        )
        .first<{ notification_key: string; category: string; push_sent_at: string | null }>()
      expect(hist).toBeTruthy()
      expect(hist!.category).toBe('opportunity_expiry')
      expect(hist!.push_sent_at).toBeTruthy()
    })
  })
})
