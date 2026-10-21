import { describe, it, expect } from 'vitest'
import { missingStatementDays } from '../utils'

/**
 * 「已过账单日但未收到新账单」提醒的判定回归（2026-10-20 规则）。
 *
 * 口径：最新账单月的下一期出账日已过 graceDays（默认 3，容忍账单邮件晚到）
 * 而那一期还没进系统 → 返回已过天数；否则 null。从未收过账单不提醒（无基线）。
 */

describe('missingStatementDays', () => {
  const day = (s: string) => new Date(s)

  it('下一期出账日还没到不提醒（民生 0872：最新 2026-09，账单日 22，今天 10-20）', () => {
    expect(missingStatementDays(22, '2026-09', day('2026-10-20'))).toBeNull()
  })

  it('本期账单已到（latestBillMonth = 最新一期）不提醒', () => {
    // 最新 2026-10（10-22 出账已收），今天 10-25：下一期 11-22 远未到
    expect(missingStatementDays(22, '2026-10', day('2026-10-25'))).toBeNull()
  })

  it('刚过出账日但在宽限期内（≤3 天）不提醒', () => {
    // 最新 2026-09，账单日 16 → 下一期 10-16，今天 10-19：过了 3 天仍在宽限内
    expect(missingStatementDays(16, '2026-09', day('2026-10-19'))).toBeNull()
  })

  it('过了出账日且超出宽限期：返回已过天数（邮储 0726：账单日 9，今天 10-20）', () => {
    // 最新 2026-09，下一期出账 10-09，今天 10-20 → 已过 11 天
    expect(missingStatementDays(9, '2026-09', day('2026-10-20'))).toBe(11)
  })

  it('连续几期没收到时按第一期缺的算（基准是 latestBillMonth+1，不是本月）', () => {
    // 最新停在 2026-08，账单日 27 → 9-27 那期已缺，今天 11-04 → 已过 38 天
    expect(missingStatementDays(27, '2026-08', day('2026-11-04'))).toBe(38)
  })

  it('账单日 31 落在短月按月末算（下一期是 2 月 → 2-28）', () => {
    // 最新 2026-01，账单日 31 → 下一期出账 2026-02-28，今天 03-05 → 已过 5 天
    expect(missingStatementDays(31, '2026-01', day('2026-03-05'))).toBe(5)
  })

  it('从未收过账单的卡不提醒（无基线）', () => {
    expect(missingStatementDays(22, null, day('2026-10-20'))).toBeNull()
    expect(missingStatementDays(22, '', day('2026-10-20'))).toBeNull()
    expect(missingStatementDays(22, 'garbage', day('2026-10-20'))).toBeNull()
  })
})
