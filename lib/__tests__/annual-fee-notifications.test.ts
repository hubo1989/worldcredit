import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleScheduled } from '../../worker/cron'
import { describeAnnualFeeWaiverGap, resolveAnnualFeeCycleState } from '../annual-fee-cycle'
import { buildAnnualFeeDecisionCandidates } from '../annual-fee-notifications.server'
import { setDb } from '../db/client'
import { formatMoneySingle } from '../notifications.shared'
import { buildDailyNotificationCandidates, ensureDailyNotificationsForUser } from '../notifications-engine.server'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'

const { sendPush, sendApns, fetchRates } = vi.hoisted(() => ({
  sendPush: vi.fn(), sendApns: vi.fn(), fetchRates: vi.fn(),
}))
vi.mock('web-push', () => ({
  default: { sendNotification: sendPush, setVapidDetails: vi.fn() },
}))
vi.mock('../apns.server', () => ({ sendApnsToUser: sendApns }))
vi.mock('../fx', async importOriginal => ({
  ...await importOriginal<typeof import('../fx')>(),
  fetchRates,
}))

const today = '2026-11-25'
const dueDate = '2026-12-25'
const dueKey = `annual_fee_decision:main:${dueDate}:30`

describe('年费周年日与免除进度', () => {
  it('使用原始核卡日推算周年日，闰年还原且周期起点不漂移', () => {
    const card = { issued_on: '2024-02-29' }
    const product = { annual_fee: 3600, annual_fee_cycle_type: 'anniversary_issued' } as const
    for (const [asOf, due, start] of [
      ['2025-02-01', '2025-02-28', '2024-02-29'],
      ['2026-02-28', '2026-02-28', '2025-02-28'],
      ['2028-02-15', '2028-02-29', '2027-02-28'],
    ]) {
      expect(resolveAnnualFeeCycleState(card, product, asOf)).toMatchObject({ nextDueDate: due, cycleStartOn: start })
    }
  })

  it('显式日期覆盖周年，过期保留且可按原始锚点结转', () => {
    const card = { issued_on: '2024-02-29', next_annual_fee_date: '2027-02-28', annual_fee_override: 900 }
    expect(resolveAnnualFeeCycleState(card, { annual_fee: 1000, annual_fee_cycle_type: 'anniversary_issued' }, '2028-01-01')).toMatchObject({
      nextDueDate: '2027-02-28', rolloverNextDueDate: '2028-02-29', nominalFee: 900,
    })
    expect(resolveAnnualFeeCycleState({
      issued_on: '2024-02-29', activated_on: '2024-03-15', annual_fee_cycle_type: 'anniversary_activated',
    }, { annual_fee: 200 }, '2026-02-15')?.nextDueDate).toBe('2026-03-15')
  })

  it('缺少日期或周期没有所需锚点时保持未知', () => {
    const card = { created_at: '2025-12-25', annual_fee_override: 3600 }
    expect(resolveAnnualFeeCycleState(card, { annual_fee_cycle_type: 'anniversary_issued' }, today)).toBeNull()
    expect(resolveAnnualFeeCycleState({
      ...card, issued_on: '2025-12-25', next_annual_fee_date: '2026-02-31',
    }, { annual_fee_cycle_type: 'calendar_year' }, today)).toBeNull()
  })

  it('金额或笔数达一即可，使用规则币种并忽略旧周期进度', () => {
    const rule = JSON.stringify({
      schema_version: 1, waiver_type: 'spend_amount_or_count',
      target_amount: 10000, target_currency: 'HKD', target_count: 6,
    })
    const cycle = { nextDueDate: dueDate, cycleStartOn: '2025-12-25' }
    const progress = { schema_version: 1, amount: 4500, count: 6, as_of_on: today, cycle_due_date: dueDate }
    expect(describeAnnualFeeWaiverGap(rule, JSON.stringify(progress), cycle, 'CNY', today)).toBe('已达到免年费条件，待确认')
    expect(describeAnnualFeeWaiverGap(rule, JSON.stringify({ ...progress, count: 2 }), cycle, 'CNY', today)).toBe(`距免年费还差 ${formatMoneySingle(5500, 'HKD')} 或 4 笔`)
    expect(describeAnnualFeeWaiverGap(rule, JSON.stringify({ ...progress, cycle_due_date: '2025-12-25' }), cycle, 'CNY', today)).toBe('免年费进度待更新')
  })
})

let db: SqliteD1
let d1: D1Database

describe('年费续卡决策通知', () => {
  beforeEach(() => {
    db = createOpportunityDb()
    d1 = db as unknown as D1Database
    setDb(d1)
    sendPush.mockReset().mockResolvedValue({ statusCode: 201 })
    sendApns.mockReset().mockResolvedValue({ total: 1, sent: 1, failed: 0 })
    fetchRates.mockReset().mockResolvedValue(null)
    db.exec(`
      INSERT INTO users (id, email, password_hash, role) VALUES
        ('admin', 'admin@example.test', 'x', 'admin'),
        ('member', 'member@example.test', 'x', 'member'),
        ('other', 'other@example.test', 'x', 'admin');
      INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
        ('family', 'admin', 'admin', 'Family', 'member'),
        ('only-admin', 'member', 'admin', 'Admin', NULL),
        ('different', 'other', 'other', 'Other', 'admin');
      INSERT INTO card_products (
        id, bank_name, card_name, annual_fee, annual_fee_cycle_type, annual_fee_waiver_rules_json
      ) VALUES ('p', '发卡行', '白金卡', 3600, 'anniversary_issued',
                '{"schema_version":1,"waiver_type":"spend_amount_or_count","target_amount":10000,"target_count":6}');
      INSERT INTO credit_cards (
        id, holder_id, card_product_id, billing_day, card_number_last4, next_annual_fee_date
      ) VALUES ('main', 'family', 'p', 1, '4321', '${dueDate}');
    `)
  })

  afterEach(() => {
    setDb(null)
    db.close()
  })

  it('生成 30、7、1、0 天候选，使用本地民用日期而不是 UTC 日期', async () => {
    const byLocalDate = await buildDailyNotificationCandidates(d1, 'member', undefined, { now: new Date(`${today}T17:00:00Z`) })
    expect(byLocalDate.candidates.filter(c => c.category === 'annual_fee_decision')).toEqual([])
    for (const [date, days] of [[today, 30], ['2026-12-18', 7], ['2026-12-24', 1], [dueDate, 0]] as const) {
      const candidates = await buildAnnualFeeDecisionCandidates(d1, 'member', date)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        notification_key: `annual_fee_decision:main:${dueDate}:${days}`,
        target_url: '/cards/main?section=roi',
        title: expect.stringContaining('4321'),
      })
    }
    await expect(buildAnnualFeeDecisionCandidates(d1, 'member', '2026-12-26')).resolves.toEqual([])
  })

  it('按角色隔离，并排除贷款、冻结、零费、已处理与没有锚点的卡', async () => {
    db.exec(`
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, next_annual_fee_date)
      VALUES ('admin-only', 'only-admin', 'p', 1, '${dueDate}'),
             ('other-only', 'different', 'p', 1, '${dueDate}');
      INSERT INTO credit_cards (
        id, holder_id, card_product_id, billing_day, next_annual_fee_date, created_at,
        status, card_type, annual_fee_override, annual_fee_status
      ) VALUES ('loan', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'active', 'loan', NULL, NULL),
               ('frozen', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'frozen', 'credit', NULL, NULL),
               ('free', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'active', 'credit', 0, NULL),
               ('paid', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'active', 'credit', NULL, 'paid'),
               ('waived', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'active', 'credit', NULL, 'waived'),
               ('na', 'family', 'p', 1, '${dueDate}', '2025-12-25', 'active', 'credit', NULL, 'not_applicable'),
               ('no-date', 'family', 'p', 1, NULL, '2025-12-25', 'active', 'credit', NULL, NULL),
               ('anniversary', 'family', 'p', 1, NULL, '2025-12-25', 'active', 'credit', NULL, NULL);
      UPDATE credit_cards SET issued_on = '2025-12-25' WHERE id = 'anniversary';
    `)
    const urls = async (user: string) => (await buildAnnualFeeDecisionCandidates(d1, user, today)).map(c => c.target_url)
    expect(await urls('member')).toEqual(['/cards/anniversary?section=roi', '/cards/main?section=roi'])
    expect(await urls('admin')).toEqual(['/cards/admin-only?section=roi', '/cards/anniversary?section=roi', '/cards/main?section=roi'])
    expect(await urls('other')).toEqual(['/cards/other-only?section=roi'])
    expect(await urls('missing-user')).toEqual([])
    db.exec("UPDATE credit_cards SET annual_fee_status = 'waived' WHERE id IN ('main','anniversary')")
    await expect(buildAnnualFeeDecisionCandidates(d1, 'member', '2026-12-18')).resolves.toEqual([])
  })

  it('使用本周期免年费进度与实际入账返现，排除上周期和未来记录', async () => {
    db.exec(`
      UPDATE credit_cards SET manual_reward_value = 1100, waiver_progress_json =
        '{"schema_version":1,"cycle_due_date":"${dueDate}","amount":2000,"count":4,"as_of_on":"${today}","source":"manual"}'
      WHERE id = 'main';
      INSERT INTO promos (id, bank_name, title) VALUES ('promo', '发卡行', 'Test');
      INSERT INTO promo_usages (id, promo_id, card_id, used_at, cashback_amount, cashback_currency) VALUES
        ('valid', 'promo', 'main', '2025-12-25T00:00:00Z', 3700, 'CNY'),
        ('old', 'promo', 'main', '2025-12-24', 3600, 'CNY'),
        ('future', 'promo', 'main', '2026-11-26', 3600, 'CNY');
    `)
    const [candidate] = await buildAnnualFeeDecisionCandidates(d1, 'member', today)
    expect(candidate.body).toContain('距免年费还差 ¥8,000 或 2 笔')
    expect(candidate.body).toContain('¥4,800（净收益 +¥1,200，ROI +33.3%）')
    expect(JSON.parse(candidate.metadata_json!)).toMatchObject({ annual_fee: 3600, roi_net_value: 1200, card_id: 'main' })
    expect(fetchRates).not.toHaveBeenCalled()

    db.exec("UPDATE promo_usages SET cashback_currency = 'USD' WHERE id = 'valid'")
    const [noRate] = await buildAnnualFeeDecisionCandidates(d1, 'member', today)
    expect(noRate.body).toContain('USD 暂无汇率')
    expect(JSON.parse(noRate.metadata_json!)).not.toHaveProperty('roi_net_value')
    expect(fetchRates).toHaveBeenCalledOnce()
  })

  it('使用个人估值和实记金额，排除 legacy 返现重复归因及已撤销权益', async () => {
    db.exec(`
      INSERT INTO opportunity_definitions
        (id, kind, visibility, created_by, created_at, estimated_unit_value_minor, estimated_value_currency)
      VALUES ('def', 'benefit', 'shared', 'admin', '${today}', 5000, 'CNY');
      INSERT INTO opportunity_rule_versions
        (id, definition_id, version, effective_from, rules_json, verification, published_at)
      VALUES ('ver', 'def', 1, '2025-12-25', '{}', 'user_confirmed', '${today}');
      INSERT INTO opportunity_accounts
        (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at,
         estimated_unit_value_minor, estimated_value_currency)
      VALUES ('acct', 'def', 'family', 'card', 'main', 'admin', '${today}', 20000, 'CNY');
      INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
      VALUES ('acct', 'def', 'family', 'main');
      INSERT INTO opportunity_cycles
        (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
         period_start_on, usable_start_on, time_zone, currency, created_at)
      VALUES ('cycle', 'acct', 'ver', '2025-12-25', 'key', 'regular', '2025-12-25',
              '2025-12-25', 'Asia/Shanghai', 'CNY', '${today}');
      INSERT INTO opportunity_usages
        (id, account_id, cycle_id, card_id, used_on, quantity, amount_minor, status,
         created_by, updated_by, created_at, updated_at)
      VALUES ('use-estimate', 'acct', 'cycle', 'main', '${today}', 2, 0, 'active', 'admin', 'admin', '${today}', '${today}'),
             ('use-exact', 'acct', 'cycle', 'main', '${today}', 1, 30000, 'active', 'admin', 'admin', '${today}', '${today}'),
             ('voided', 'acct', 'cycle', 'main', '${today}', 1, 10000, 'voided', 'admin', 'admin', '${today}', '${today}');
      INSERT INTO promos (id, bank_name, title) VALUES ('promo', '发卡行', 'Test');
      INSERT INTO promo_usages (id, promo_id, card_id, used_at, cashback_amount, cashback_currency)
      VALUES ('legacy', 'promo', 'main', '${today}', 300, 'CNY');
      INSERT INTO opportunity_legacy_links
        (source_table, source_id, target_usage_id, assigned_by, reason, assigned_at)
      VALUES ('promo_usages', 'legacy', 'use-exact', 'admin', 'test', '${today}');
    `)
    const [candidate] = await buildAnnualFeeDecisionCandidates(d1, 'member', today)
    expect(candidate.body).toContain('本周期已记录权益与返现 ¥700')
  })

  it('将已确认任务奖励归给唯一绑卡，排除撤销与未明确归因的奖励', async () => {
    db.exec(`
      INSERT INTO opportunity_tasks
        (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json, created_by, created_at, updated_at)
      VALUES ('task', 'family', 'annual_fee', '奖励', '["main"]', '{}', '{}', 'admin', '${today}', '${today}'),
             ('ambiguous', 'family', 'custom', '其他奖励', '["main","another"]', '{}', '{}', 'admin', '${today}', '${today}');
      INSERT INTO opportunity_task_cycles
        (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json,
         period_start_on, period_end_before, deadline_at, updated_at)
      VALUES ('cycle-ok', 'task', 'month', '{}', '{"reward":{"amount_minor":21000,"currency":"CNY"}}',
                '2026-11-01', '2026-12-01', '2026-12-01T00:00:00Z', '${today}'),
             ('cycle-amb', 'ambiguous', 'month', '{}', '{}',
                '2026-11-01', '2026-12-01', '2026-12-01T00:00:00Z', '${today}');
      INSERT INTO opportunity_fulfillments
        (id, holder_id, kind, task_cycle_id, reward_key, source_key, status, amount_minor, recorded_on,
         created_by, updated_by, created_at, updated_at)
      VALUES ('earned', 'family', 'task_result', 'cycle-ok', 'reward', 'source-1', 'recorded', 0,
                '${today}', 'admin', 'admin', '${today}', '${today}'),
             ('reversed', 'family', 'task_result', 'cycle-ok', 'reward', 'source-2', 'cancelled', 10000,
                '${today}', 'admin', 'admin', '${today}', '${today}'),
             ('unassigned', 'family', 'task_result', 'cycle-amb', 'reward', 'source-3', 'recorded', 20000,
                '${today}', 'admin', 'admin', '${today}', '${today}');
    `)
    const [candidate] = await buildAnnualFeeDecisionCandidates(d1, 'member', today)
    expect(candidate.body).toContain('本周期已记录权益与返现 ¥210')
  })

  it('尊重通知偏好，原有站内入口唯一写入并保留软删除', async () => {
    db.exec(`
      INSERT INTO user_preferences (id, user_id, reminder_config)
      VALUES ('p-member', 'member', '{"items":{"annual_fee_decision":false}}');
    `)
    const disabled = await buildDailyNotificationCandidates(d1, 'member', today)
    expect(disabled.candidates).toEqual([])
    db.exec("UPDATE user_preferences SET reminder_config = '{}' WHERE user_id = 'member'")
    expect(await ensureDailyNotificationsForUser(d1, 'member', today)).toBe(1)
    db.exec(`UPDATE notification_history SET deleted_at = '${today}' WHERE notification_key = '${dueKey}'`)
    expect(await ensureDailyNotificationsForUser(d1, 'member', today)).toBe(0)
    expect(db.raw.prepare('SELECT category, deleted_at FROM notification_history WHERE notification_key = ?').all(dueKey))
      .toEqual([{ category: 'annual_fee_decision', deleted_at: today }])
  })

  it('同一 Cron 时窗顺序执行两次，仅生成一条通知并各推送一次 Web Push 与 APNs', async () => {
    db.exec(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
      VALUES ('sub', 'member', 'https://push.example.test/1', 'key', 'auth');
      INSERT INTO device_tokens (id, user_id, platform, token)
      VALUES ('device', 'member', 'ios', '${'a'.repeat(64)}');
    `)
    const event = { scheduledTime: Date.parse(`${today}T01:00:00Z`) } as ScheduledEvent
    const env = {
      DB: d1, VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private',
      APNS_KEY_P8: 'test', APNS_KEY_ID: 'test', APNS_TEAM_ID: 'test',
    }
    await handleScheduled(event, env, {} as ExecutionContext)
    await handleScheduled(event, env, {} as ExecutionContext)
    expect(sendPush).toHaveBeenCalledOnce()
    expect(sendApns).toHaveBeenCalledOnce()
    expect(db.raw.prepare("SELECT push_sent_at FROM notification_history WHERE user_id = 'member' AND notification_key = ?").all(dueKey))
      .toEqual([{ push_sent_at: `${today}T01:00:00.000Z` }])
  })
})
