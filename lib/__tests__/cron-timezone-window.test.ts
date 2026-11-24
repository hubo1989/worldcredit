import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleScheduled, shouldSyncGmail } from '../../worker/cron'
import { resolveEffectivePushHour } from '../notifications-engine.server'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'

const { sendWeb, sendApns } = vi.hoisted(() => ({ sendWeb: vi.fn(), sendApns: vi.fn() }))
vi.mock('web-push', () => ({ default: { sendNotification: sendWeb, setVapidDetails: vi.fn() } }))
vi.mock('../apns.server', () => ({ sendApnsToUser: sendApns }))

let db: SqliteD1
const USER = 'reminder-user'

function setPreferences(timeZone: string, localTime?: string, quietStart = '22:00', quietEnd = '08:00') {
  return db.prepare('UPDATE user_preferences SET reminder_config = ? WHERE user_id = ?').bind(
    JSON.stringify({
      opportunities: { time_zone: timeZone, local_time: localTime },
      items: { bill_overdue: false, payable_due_advance: false },
      quiet_hours_start: quietStart,
      quiet_hours_end: quietEnd,
    }),
    USER,
  ).run()
}

function scan(at: string) {
  return handleScheduled(
    { cron: '0 * * * *', scheduledTime: Date.parse(at) } as ScheduledEvent,
    { DB: db as unknown as D1Database, VAPID_PUBLIC_KEY: 'test-pub', VAPID_PRIVATE_KEY: 'test-private' },
    {} as ExecutionContext,
  )
}

function history(day: string) {
  return db.prepare('SELECT status, push_sent_at FROM notification_history WHERE notification_key = ?')
    .bind(`due_today_summary:${day}`).first<{ status: string; push_sent_at: string | null }>()
}

beforeEach(() => {
  db = createOpportunityDb()
  sendWeb.mockReset().mockResolvedValue({})
  sendApns.mockReset()
  db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('reminder-user', 'reminder@example.test', 'hash');
    INSERT INTO user_preferences (id, user_id) VALUES ('preference', 'reminder-user');
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
      VALUES ('sub', 'reminder-user', 'https://push.example.test/web', 'key', 'auth');
    INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, is_active)
      VALUES ('march', 'reminder-user', 'March', 'utility', 100, 'CNY', 8, 1),
             ('daily', 'reminder-user', 'Today', 'utility', 100, 'CNY', 15, 1),
             ('november', 'reminder-user', 'November', 'utility', 100, 'CNY', 1, 1);
  `)
})

afterEach(() => {
  expect(sendApns).not.toHaveBeenCalled()
  db.close()
})

describe('hourly daily reminders', () => {
  it('uses the local civil date and sends once after a same-day time and zone change', async () => {
    await setPreferences('Asia/Tokyo', '09:30')
    await scan('2026-10-14T23:00:00Z')
    expect(await history('2026-10-15')).toBeNull()
    await scan('2026-10-15T00:00:00Z')
    expect(await history('2026-10-15')).toEqual({ status: 'sent', push_sent_at: '2026-10-15T00:00:00.000Z' })
    await setPreferences('America/New_York', '18:00')
    await scan('2026-10-15T22:00:00Z')
    expect(sendWeb).toHaveBeenCalledTimes(1)
  })

  it('defers an evening preference across midnight and waits for the end minute', async () => {
    await setPreferences('Asia/Shanghai', '23:00', '22:00', '08:30')
    await scan('2026-10-14T23:00:00Z')
    expect(await history('2026-10-15')).toBeNull()
    await scan('2026-10-15T00:00:00Z')
    expect(await history('2026-10-15')).toEqual({ status: 'skipped', push_sent_at: null })
    expect(sendWeb).not.toHaveBeenCalled()
    await scan('2026-10-15T01:00:00Z')
    await scan('2026-10-15T02:00:00Z')
    expect(sendWeb).toHaveBeenCalledTimes(1)
  })

  it('falls back to the legacy hour and Shanghai for invalid preferences', async () => {
    await setPreferences('Invalid/Zone', '99:00')
    db.exec(`INSERT INTO notification_preferences (user_id, notify_time) VALUES ('reminder-user', '10:30')`)
    await scan('2026-10-15T01:00:00Z')
    expect(sendWeb).not.toHaveBeenCalled()
    await scan('2026-10-15T02:00:00Z')
    expect(sendWeb).toHaveBeenCalledTimes(1)
    expect(await history('2026-10-15')).toMatchObject({ status: 'sent' })
  })

  it('catches up after a skipped spring hour and deduplicates the repeated fall hour', async () => {
    await setPreferences('America/New_York', '02:00', '00:00', '00:00')
    await scan('2026-03-08T06:00:00Z')
    expect(await history('2026-03-08')).toBeNull()
    await scan('2026-03-08T07:00:00Z')
    expect(await history('2026-03-08')).toMatchObject({ status: 'sent' })

    await setPreferences('America/New_York', '01:00', '00:00', '00:00')
    await scan('2026-11-01T05:00:00Z')
    await scan('2026-11-01T06:00:00Z')
    expect(await history('2026-11-01')).toEqual({ status: 'sent', push_sent_at: '2026-11-01T05:00:00.000Z' })
    expect(sendWeb).toHaveBeenCalledTimes(2)
  })

  it('claims atomically before sending and can retry a failed attempt', async () => {
    await setPreferences('Asia/Shanghai', '09:00')
    let finishSending = () => {}
    let markSending = () => {}
    const providerPending = new Promise<void>(resolve => { finishSending = resolve })
    const providerCalled = new Promise<void>(resolve => { markSending = resolve })
    sendWeb.mockImplementationOnce(async () => {
      markSending()
      await providerPending
      throw new Error('temporary failure')
    })
    const first = scan('2026-10-15T01:00:00Z')
    try {
      await providerCalled
      await scan('2026-10-15T01:00:00Z')
      expect(sendWeb).toHaveBeenCalledTimes(1)
    } finally {
      finishSending()
      await first
    }
    expect(await history('2026-10-15')).toEqual({ status: 'failed', push_sent_at: null })
    await scan('2026-10-15T02:00:00Z')
    expect(sendWeb).toHaveBeenCalledTimes(2)
    expect(await history('2026-10-15')).toMatchObject({ status: 'sent' })
  })

  it('uses the quiet end hour for both legs across midnight', () => {
    expect(resolveEffectivePushHour('23:00', '22:00', '08:30')).toBe(8)
    expect(resolveEffectivePushHour('07:59', '22:00', '08:30')).toBe(8)
    expect(resolveEffectivePushHour('13:00', '12:00', '14:00')).toBe(14)
    expect(resolveEffectivePushHour('00:00', '00:00', '00:00')).toBe(0)
  })

  it('schedules Gmail only at UTC 09 on the bill cron', () => {
    const times = Array.from({ length: 24 }, (_, h) => Date.UTC(2026, 9, 15, h))
    expect(times.filter(scheduledTime => shouldSyncGmail({ cron: '0 * * * *', scheduledTime }))).toEqual([times[9]])
    expect(shouldSyncGmail({ cron: '0 9 * * *', scheduledTime: times[9] })).toBe(true)
    expect(shouldSyncGmail({ cron: '*/15 * * * *', scheduledTime: times[9] })).toBe(false)
  })
})
