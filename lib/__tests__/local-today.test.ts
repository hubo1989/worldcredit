import { describe, it, expect } from 'vitest'
import { getLocalTodayString } from '../utils'

describe('getLocalTodayString timezone handling', () => {
  it('correctly maps late UTC evening to next day in Asia/Shanghai', () => {
    // 2026-10-20T23:30:00Z -> 2026-10-21 07:30:00 in Asia/Shanghai (UTC+8)
    const lateUtc = new Date('2026-10-20T23:30:00Z')

    // UTC string would be yesterday
    expect(lateUtc.toISOString().slice(0, 10)).toBe('2026-10-20')

    // Local today in Asia/Shanghai correctly resolves to the 21st
    expect(getLocalTodayString('Asia/Shanghai', lateUtc)).toBe('2026-10-21')
  })

  it('correctly maps early UTC morning to same day in Asia/Shanghai', () => {
    // 2026-10-21T01:15:00Z -> 2026-10-21 09:15:00 in Asia/Shanghai
    const morningUtc = new Date('2026-10-21T01:15:00Z')
    expect(getLocalTodayString('Asia/Shanghai', morningUtc)).toBe('2026-10-21')
  })

  it('handles other timezones like America/New_York', () => {
    // 2026-10-21T02:00:00Z -> 2026-10-20 22:00:00 in America/New_York (EDT, UTC-4)
    const utcDate = new Date('2026-10-21T02:00:00Z')
    expect(getLocalTodayString('America/New_York', utcDate)).toBe('2026-10-20')
  })
})
