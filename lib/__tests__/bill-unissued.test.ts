import { describe, it, expect } from 'vitest'
import { isBillUnissued, diffInCalendarDays } from '../utils'

describe('isBillUnissued 日历日时区与出账判定', () => {
  it('出账日当天（含凌晨 00:00-08:00）判定为已出账，绝不误判为未出账', () => {
    // 假设出账日是 2026-11-05
    const bill = { statement_date: '2026-11-05' }

    // 当天凌晨 02:30（在 UTC 下对应 2026-11-04 18:30）
    const earlyMorningToday = new Date('2026-11-05T02:30:00+08:00')
    expect(diffInCalendarDays(bill.statement_date, earlyMorningToday)).toBe(0)
    expect(isBillUnissued(bill, earlyMorningToday)).toBe(false)

    // 当天中午 12:00
    const noonToday = new Date('2026-11-05T12:00:00+08:00')
    expect(isBillUnissued(bill, noonToday)).toBe(false)
  })

  it('未来日期判定为未出账', () => {
    const bill = { statement_date: '2026-11-06' }
    const today = new Date('2026-11-05T10:00:00+08:00')
    expect(diffInCalendarDays(bill.statement_date, today)).toBe(1)
    expect(isBillUnissued(bill, today)).toBe(true)
  })

  it('过去日期判定为已出账', () => {
    const bill = { statement_date: '2026-11-04' }
    const today = new Date('2026-11-05T10:00:00+08:00')
    expect(diffInCalendarDays(bill.statement_date, today)).toBe(-1)
    expect(isBillUnissued(bill, today)).toBe(false)
  })

  it('statement_date_override 优先于 statement_date', () => {
    const today = new Date('2026-11-05T10:00:00+08:00')
    // 原始出账日是过去（2026-11-01），但 override 改到了未来（2026-11-10）
    const bill = {
      statement_date: '2026-11-01',
      statement_date_override: '2026-11-10',
    }
    expect(isBillUnissued(bill, today)).toBe(true)

    // 反之：原始出账日在未来，但 override 改到过去
    const bill2 = {
      statement_date: '2026-11-20',
      statement_date_override: '2026-11-01',
    }
    expect(isBillUnissued(bill2, today)).toBe(false)
  })

  it('兜底支持 statement_end', () => {
    const today = new Date('2026-11-05T10:00:00+08:00')
    const billFuture = { statement_end: '2026-11-08' }
    expect(isBillUnissued(billFuture, today)).toBe(true)

    const billPast = { statement_end: '2026-11-02' }
    expect(isBillUnissued(billPast, today)).toBe(false)
  })

  it('无出账日期字段时安全返回 false', () => {
    expect(isBillUnissued({})).toBe(false)
  })
})
