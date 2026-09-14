import { describe, it, expect } from 'vitest'
import { diffInCalendarDays, pickDueReference, dueDistanceLabel } from '../utils'

/**
 * 回归：账单卡片要显示「距今到期天数」。
 *
 * 两个曾踩过的坑：
 * 1. 用毫秒差取整会在跨日边界差一天（'2026-09-16' 按 UTC 解析，东八区落回
 *    当天 08:00），导致数字说「还剩 2 日」而徽章写「逾期」。
 * 2. 一张卡挂着早期漏还账单时，只取第一张会让日期和天数指向两张不同账单。
 */
describe('diffInCalendarDays', () => {
  const today = new Date(2026, 8, 14) // 2026-09-14 本地时间

  it('counts calendar days, not milliseconds-to-midnight', () => {
    expect(diffInCalendarDays('2026-09-16', today)).toBe(2)
    expect(diffInCalendarDays('2026-09-14', today)).toBe(0)
    expect(diffInCalendarDays('2026-09-01', today)).toBe(-13)
  })

  it('is exact at a month boundary', () => {
    expect(diffInCalendarDays('2026-10-01', new Date(2026, 8, 30))).toBe(1)
    expect(diffInCalendarDays('2026-09-30', new Date(2026, 9, 1))).toBe(-1)
  })

  it('treats the due day itself as zero, never as overdue', () => {
    // 到期日当天不算逾期：0 既不是负数也不是正数
    expect(diffInCalendarDays('2026-09-14', new Date(2026, 8, 14))).toBe(0)
  })

  it('accepts a Date as well as a date string', () => {
    expect(diffInCalendarDays(new Date(2026, 8, 20), today)).toBe(6)
  })
})

describe('dueDistanceLabel', () => {
  it('says 逾期 X 日 once the due date has passed', () => {
    expect(dueDistanceLabel(-1)).toBe('逾期 1 日')
    expect(dueDistanceLabel(-62)).toBe('逾期 62 日')
  })

  it('says 今天还款日 on the due date', () => {
    expect(dueDistanceLabel(0)).toBe('今天还款日')
  })

  it('says 距离还款日 X 日 before the due date', () => {
    expect(dueDistanceLabel(2)).toBe('距离还款日 2 日')
    expect(dueDistanceLabel(30)).toBe('距离还款日 30 日')
  })
})

describe('pickDueReference', () => {
  const today = new Date(2026, 8, 14)

  it('returns null for a card with no unpaid bill', () => {
    expect(pickDueReference([], today)).toBeNull()
  })

  it('picks the nearest due date when nothing is overdue', () => {
    const bills = [
      { due_date: '2026-10-20' },
      { due_date: '2026-09-25' },
      { due_date: '2026-11-01' },
    ]
    expect(pickDueReference(bills, today)?.bill.due_date).toBe('2026-09-25')
    expect(pickDueReference(bills, today)?.days).toBe(11)
  })

  it('picks the most overdue bill when one has lapsed', () => {
    const bills = [
      { due_date: '2026-09-25' }, // 还没到期
      { due_date: '2026-07-14' }, // 逾期最久
      { due_date: '2026-08-16' },
    ]
    const picked = pickDueReference(bills, today)
    expect(picked?.bill.due_date).toBe('2026-07-14')
    expect(picked?.days).toBe(-62)
    expect(dueDistanceLabel(picked!.days)).toBe('逾期 62 日')
  })

  it('keeps the label and the bill consistent when overdue and future bills coexist', () => {
    // 日期与天数必须指向同一张账单，否则用户不知道还哪笔
    const bills = [
      { due_date: '2027-01-01' },
      { due_date: '2026-08-16' },
    ]
    const picked = pickDueReference(bills, today)!
    expect(picked.bill.due_date).toBe('2026-08-16')
    expect(dueDistanceLabel(picked.days)).toBe('逾期 29 日')
  })
})
