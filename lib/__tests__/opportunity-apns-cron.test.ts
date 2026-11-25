import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apnsCronSender, scanOpportunityNotifications, type PushSender } from '../../worker/opportunity-cron'
import { setDb } from '../db/client'
import { FIXTURE_IDS, LEDGER_IDS, seedOpportunityFixtures, seedOpportunityLedgerWorld } from './helpers/opportunity-fixtures'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'

const { sendApns } = vi.hoisted(() => ({ sendApns: vi.fn() }))
vi.mock('../apns-client', async importOriginal => ({
  ...await importOriginal<typeof import('../apns-client')>(),
  sendApnsNotification: sendApns,
}))

let db: SqliteD1
const { users, holders } = FIXTURE_IDS
const { accounts, cycles } = LEDGER_IDS
const DAY = '2026-10-31'
const clock = (hour = '01:00') => `${DAY}T${hour}:00Z`
const web = vi.fn<PushSender>()

const rules = {
  schema_version: 1, title: '机场权益', description: null, category: 'other', time_zone: 'Asia/Shanghai',
  bank_id: null, card_product_ids: [], valid_from: null, valid_until_before: null, open_ended: true,
  weekdays: null, cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
  allocation: 'recurring', count_limit: 6, amount_limit_minor: null, currency: null, unit_label: '次',
  eligibility_text: null, requires_personal_confirmation: false, claim_window: null, booking_window: null,
  workflow_time_basis: 'fixed', booking_consumes: 'reserve_then_use', cancellation_rule: 'confirm_with_issuer',
  entry: { website_url: null, app_name: null, app_path: null },
}

function prefs(config: object) {
  return db.prepare('INSERT OR REPLACE INTO user_preferences(id, user_id, reminder_config) VALUES (?, ?, ?)')
    .bind('pref-apns', users.adminA, JSON.stringify(config)).run()
}

function addDevice(id: string, platform = 'ios') {
  return db.prepare('INSERT INTO device_tokens(id, user_id, platform, token) VALUES (?, ?, ?, ?)')
    .bind(id, users.adminA, platform, `token-${id}`).run()
}

function addWeb(id: string) {
  return db.prepare('INSERT INTO push_subscriptions(id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)')
    .bind(id, users.adminA, `https://push.example.test/${id}`, 'p', 'a').run()
}

function scan(now = clock(), withApns = true) {
  const binding = db as unknown as D1Database
  return scanOpportunityNotifications({
    db: binding, now: new Date(now), sender: web,
    apnsSender: withApns ? apnsCronSender({
      DB: binding, APNS_KEY_P8: 'test-key', APNS_KEY_ID: 'test-id', APNS_TEAM_ID: 'test-team',
    }) : undefined,
  })
}

function deliveries() {
  return db.raw.prepare(
    'SELECT subscription_id, channel, status, attempt_count FROM opportunity_notification_deliveries ORDER BY subscription_id',
  ).all()
}

beforeEach(async () => {
  db = createOpportunityDb()
  setDb(db as unknown as D1Database)
  web.mockReset().mockResolvedValue({ ok: true })
  sendApns.mockReset().mockResolvedValue({ success: true })
  await seedOpportunityFixtures(db)
  db.exec("UPDATE users SET email = 'hubo1989@gmail.com' WHERE email = 'admin-a@example.test'")
  await seedOpportunityLedgerWorld(db)
  // The old version still covers the seeded cycle's version-as-of date.
  db.exec("UPDATE opportunity_rule_versions SET effective_until_before = '2026-10-02' WHERE id = 'orv-shared'")
  await db.prepare(`
    INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
    VALUES ('verified', 'odef-shared', 2, '2026-10-02', ?, 'user_confirmed', '2026-10-01T00:00:00Z')
  `).bind(JSON.stringify(rules)).run()
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('opportunity cron APNs and Web Push', () => {
  it('delivers to an APNs-only user with the iOS deep link, and ignores Android tokens', async () => {
    await addDevice('iphone')
    await addDevice('android', 'android')
    expect((await scan()).sent).toBe(1)
    expect((await scan()).jobs_claimed).toBe(0)
    expect(web).not.toHaveBeenCalled()
    expect(sendApns).toHaveBeenCalledTimes(1)
    expect(sendApns).toHaveBeenCalledWith('token-iphone', expect.objectContaining({
      alert: { title: '今日截止：机场权益', body: expect.stringContaining('剩余 6 次') },
      sound: 'default',
      badge: 1,
      customData: {
        type: 'opportunity_expiry', url: `/benefits?account_id=${accounts.self}`,
        delivery_key: expect.stringMatching(/:d0$/), event_key: expect.stringMatching(/^op:expiry:/),
      },
    }), expect.objectContaining({ keyId: 'test-id' }))
    expect(deliveries()).toEqual([
      { subscription_id: 'apns:iphone', channel: 'apns', status: 'accepted', attempt_count: 1 },
    ])
  })

  it('retries just the failed devices, prunes gone endpoints, and counts prior accepted deliveries', async () => {
    await addWeb('web')
    await addWeb('web-gone')
    await addDevice('ios-retry')
    await addDevice('ios-gone')
    web.mockImplementation(async sub => ({ ok: sub.id === 'web', gone: sub.id === 'web-gone' }))
    sendApns.mockImplementation(async (token: string) => {
      if (token === 'token-ios-gone') return { success: false, invalidToken: true, statusCode: 410 }
      return { success: false, error: 'temporary APNs failure' }
    })
    expect((await scan()).partial).toBe(1)
    const firstPush = await db.prepare('SELECT push_sent_at FROM notification_history WHERE user_id = ?')
      .bind(users.adminA).first('push_sent_at')
    expect(firstPush).toEqual({ push_sent_at: clock() })
    expect(db.raw.prepare("SELECT id FROM device_tokens WHERE id = 'ios-gone'").get()).toBeUndefined()
    expect(db.raw.prepare("SELECT id FROM push_subscriptions WHERE id = 'web-gone'").get()).toBeUndefined()
    sendApns.mockResolvedValue({ success: true })
    expect((await scan(clock('01:15'))).sent).toBe(1)
    expect(web).toHaveBeenCalledTimes(2)
    expect(sendApns.mock.calls.map(([token]) => token).sort())
      .toEqual(['token-ios-gone', 'token-ios-retry', 'token-ios-retry'])
    expect(deliveries()).toEqual([
      { subscription_id: 'apns:ios-gone', channel: 'apns', status: 'gone', attempt_count: 1 },
      { subscription_id: 'apns:ios-retry', channel: 'apns', status: 'accepted', attempt_count: 2 },
      { subscription_id: 'web', channel: 'web_push', status: 'accepted', attempt_count: 1 },
      { subscription_id: 'web-gone', channel: 'web_push', status: 'gone', attempt_count: 1 },
    ])
    expect(await db.prepare('SELECT push_sent_at FROM notification_history WHERE user_id = ?')
      .bind(users.adminA).first('push_sent_at')).toEqual(firstPush)
  })

  it('stops partial jobs at four attempts while keeping the accepted APNs device', async () => {
    await addDevice('iphone')
    await addWeb('broken')
    web.mockResolvedValue({ ok: false })
    for (const time of ['01:00', '01:15', '01:30', '01:45', '02:00']) await scan(clock(time))
    expect(sendApns).toHaveBeenCalledTimes(1)
    expect(web).toHaveBeenCalledTimes(4)
    expect(db.raw.prepare('SELECT status, attempt_count FROM opportunity_notification_jobs').get())
      .toEqual({ status: 'partial', attempt_count: 4 })
  })

  it('records all-gone as skipped and preserves the inbox entry', async () => {
    await addDevice('gone')
    sendApns.mockResolvedValue({ success: false, statusCode: 410, invalidToken: true })
    await scan()
    expect(db.raw.prepare('SELECT status, last_error FROM opportunity_notification_jobs').get())
      .toEqual({ status: 'skipped', last_error: 'all_endpoints_gone' })
    expect(db.raw.prepare('SELECT status, push_sent_at FROM notification_history').get())
      .toEqual({ status: 'skipped', push_sent_at: null })
  })

  it('sends an advance node on its own date and rechecks remaining quota before the final node', async () => {
    await addDevice('iphone')
    expect((await scan('2026-10-30T01:00:00Z')).sent).toBe(1)
    expect(sendApns).toHaveBeenCalledWith('token-iphone', expect.objectContaining({
      alert: { title: '即将到期：机场权益', body: expect.stringContaining('1 天后（2026-10-31）') },
    }), expect.anything())
    // Queue the final node, then consume the balance before its time.
    await scan(clock('00:00'))
    await db.prepare('UPDATE opportunity_cycles SET used_count = count_limit WHERE id = ?').bind(cycles.self).run()
    expect((await scan()).cancelled).toBe(1)
    expect(sendApns).toHaveBeenCalledTimes(1)
  })

  it('repairs an unattempted advance node queued by the previous cron version', async () => {
    await addDevice('iphone')
    await scan('2026-10-30T00:00:00Z')
    db.exec(`UPDATE opportunity_notification_jobs
      SET scheduled_at = '2026-10-31T01:00:00Z', expires_at = '2026-11-01T23:59:59Z'`)
    const repaired = await scan('2026-10-30T01:00:00Z')
    expect(repaired).toMatchObject({ jobs_created: 0, sent: 1 })
  })

  it('cancels a quiet-hours deferral beyond the rule-zone expiry', async () => {
    await addDevice('iphone')
    await prefs({ quiet_hours_start: '22:00', quiet_hours_end: '08:00', opportunities: { local_time: '23:00' } })
    await scan(clock('12:00'))
    await scan('2026-11-01T00:00:00Z')
    expect(db.raw.prepare("SELECT status, expires_at FROM opportunity_notification_jobs WHERE delivery_key LIKE 'op:expiry%:d0'").get())
      .toEqual({ status: 'cancelled', expires_at: '2026-10-31T16:00:00Z' })
    expect(sendApns).not.toHaveBeenCalled()
  })

  it('sends reset notifications on the new cycle date', async () => {
    await addDevice('iphone')
    expect((await scan('2026-11-01T01:00:00Z')).sent).toBe(1)
    expect(sendApns).toHaveBeenCalledWith('token-iphone', expect.objectContaining({
      alert: { title: '额度已重置：机场权益', body: expect.stringContaining('剩余 6 次') },
      customData: expect.objectContaining({ type: 'opportunity_reset' }),
    }), expect.anything())
  })

  it('sends claim open and deadline nodes for a pending claim and cancels after activation', async () => {
    await addDevice('iphone')
    db.exec("UPDATE opportunity_rule_versions SET effective_until_before = '2026-10-28' WHERE id = 'verified'")
    await db.prepare(`
      INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
      VALUES ('claim-rules', 'odef-shared', 3, '2026-10-28', ?, 'user_confirmed', '2026-10-01T00:00:00Z')
    `).bind(JSON.stringify({
      ...rules, allocation: 'claim_gated',
      claim_window: { starts_at: '2026-10-28T16:00:00Z', ends_at: '2026-10-31T15:59:00Z' },
    })).run()
    await db.prepare("UPDATE opportunity_cycles SET activation_state = 'pending_claim' WHERE id = ?")
      .bind(cycles.self).run()
    await scan('2026-10-29T01:00:00Z')
    expect(sendApns).toHaveBeenCalledWith('token-iphone', expect.objectContaining({
      alert: expect.objectContaining({ title: '抢兑/领取开启：机场权益' }),
      customData: expect.objectContaining({ url: `/benefits?account_id=${accounts.self}&action=claim` }),
    }), expect.anything())
    await scan('2026-10-30T01:00:00Z')
    expect(sendApns).toHaveBeenCalledWith('token-iphone', expect.objectContaining({
      alert: expect.objectContaining({ title: '1天后截止领取：机场权益' }),
    }), expect.anything())
    await scan(clock('00:00'))
    await db.prepare("UPDATE opportunity_cycles SET activation_state = 'active' WHERE id = ?")
      .bind(cycles.self).run()
    expect((await scan()).cancelled).toBe(1)
    expect(sendApns.mock.calls.map(([, option]) => option.alert.title)).not.toContain('今日截止领取：机场权益')
  })

  it('sends task, reward and booking events with their own routing keys', async () => {
    await addDevice('iphone')
    const taskRules = JSON.stringify({
      schema_version: 1, currency: 'CNY', eligible_spend_notes: null,
      groups: [{ id: 'g', metrics: [{ id: 'spend', kind: 'amount', target_minor: 100 }] }],
    })
    await db.batch([
      db.prepare(`INSERT INTO opportunity_tasks
        (id, holder_id, title, task_type, card_ids_json, rules_json, reward_json, created_by, created_at, updated_at)
        VALUES ('task', ?, '消费任务', 'custom', '[]', ?, '{}', ?, ?, ?)`)
        .bind(holders.self, taskRules, users.adminA, clock(), clock()),
      db.prepare(`INSERT INTO opportunity_task_cycles
        (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json, period_start_on, period_end_before,
         deadline_at, expected_from_on, expected_until_before, progress_json, updated_at)
        VALUES ('pending', 'task', 'pending', ?, '{}', '2026-10-01', '2026-11-01',
                '2026-10-31T23:59:00+08:00', NULL, NULL, '{}', ?),
               ('reward', 'task', 'reward', ?, '{}', '2026-09-01', '2026-10-01',
                '2026-09-30T23:59:00+08:00', '2026-10-31', '2026-11-02', ?, ?)`)
        .bind(taskRules, clock(), taskRules, JSON.stringify({ metric_values: { spend: 100 } }), clock()),
      db.prepare(`INSERT INTO opportunity_fulfillments
        (id, holder_id, kind, account_id, cycle_id, card_id, source_key, status, recorded_on,
         service_at, service_time_zone, created_by, updated_by, created_at, updated_at)
        VALUES ('booking', ?, 'booking', ?, ?, ?, 'booking-test', 'recorded', '2026-10-23',
                '2026-10-31T18:00:00Z', 'Asia/Shanghai', ?, ?, ?, ?)`)
        .bind(holders.self, accounts.self, cycles.self, FIXTURE_IDS.cards.selfMain,
          users.adminA, users.adminA, clock(), clock()),
    ])
    await scan()
    const options = sendApns.mock.calls.map(([, option]) => option)
    expect(db.raw.prepare(
      "SELECT object_id, expires_at FROM opportunity_notification_jobs WHERE object_id IN ('pending', 'booking') ORDER BY object_id",
    ).all()).toEqual([
      { object_id: 'booking', expires_at: '2026-10-31T18:00:00Z' },
      { object_id: 'pending', expires_at: '2026-10-31T15:59:00Z' },
    ])
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ customData: expect.objectContaining({
        type: 'opportunity_task', url: '/benefits/tasks?task_cycle_id=pending',
      }) }),
      expect.objectContaining({ alert: expect.objectContaining({ title: '奖励预计到账窗口：消费任务' }),
        customData: expect.objectContaining({ url: '/benefits/tasks?task_cycle_id=reward' }) }),
      expect.objectContaining({
        alert: expect.objectContaining({ body: expect.stringContaining('2026-11-01 02:00') }),
        customData: expect.objectContaining({
          type: 'opportunity_booking', url: expect.stringMatching(/^\/benefits\/calendar\?event_key=op%3Abooking_service/),
        }),
      }),
    ]))
    expect(db.raw.prepare(`SELECT DISTINCT object_kind FROM opportunity_notification_jobs ORDER BY object_kind`).all())
      .toEqual([{ object_kind: 'account' }, { object_kind: 'fulfillment' }, { object_kind: 'task' }])
  })
})
