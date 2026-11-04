import { describe, it, expect } from 'vitest'
import { payableNextCycleStatus } from '../utils'

/**
 * 固定支出还款后下期状态的判定回归（2026-10-21 规则）：
 *   - 距下期还款日 ≥30 天：待出账，出账日 = 还款日 − 30；
 *   - <30 天：待还款，还款日 = 设置的每月应付日。
 */

describe('payableNextCycleStatus', () => {
  const day = (s: string) => new Date(s)
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  it('距下期还款日 40 天：待出账，出账日 = 还款日 − 30', () => {
    // 本期账期 2026-10（已付清），下期还款日 2026-11-25；今天 10-16 → 距 40 天
    const r = payableNextCycleStatus(25, '2026-10', day('2026-10-16'))
    expect(r.phase).toBe('awaiting_statement')
    expect(r.days).toBe(40)
    expect(iso(r.date)).toBe('2026-10-26') // 11-25 − 30 天
  })

  it('距下期还款日恰好 30 天：仍是待出账（边界含等号）', () => {
    // 下期还款日 2026-11-20；今天 10-21 → 距 30 天
    const r = payableNextCycleStatus(20, '2026-10', day('2026-10-21'))
    expect(r.phase).toBe('awaiting_statement')
    expect(iso(r.date)).toBe('2026-10-21') // 出账日 = 今天
  })

  it('距下期还款日 29 天：待还款，还款日 = 设置的应付日', () => {
    // 下期还款日 2026-11-20；今天 10-22 → 距 29 天
    const r = payableNextCycleStatus(20, '2026-10', day('2026-10-22'))
    expect(r.phase).toBe('awaiting_payment')
    expect(iso(r.date)).toBe('2026-11-20')
  })

  it('还款日 31 日落在短月按月末收拢（下期 2 月 → 2-28）', () => {
    // 本期 2026-01，下期还款日 2026-02-28；今天 01-05 → 距 54 天，待出账
    const r = payableNextCycleStatus(31, '2026-01', day('2026-01-05'))
    expect(r.phase).toBe('awaiting_statement')
    expect(iso(r.date)).toBe('2026-01-29') // 2-28 − 30 天
  })

  it('今天就是出账日（距还款日整 30 天）给出账日今天', () => {
    const r = payableNextCycleStatus(20, '2026-10', day('2026-10-21'))
    expect(r.days).toBe(30)
    expect(iso(r.date)).toBe('2026-10-21')
  })

  it('每 X 月（如每 3 个月）：按间隔月数推导下期出账日与还款日', () => {
    const cycle = { cycle_type: 'every_n_months' as const, cycle_months: 3 }
    // 本期 2026-10 已付清，下期为 2027-01-15
    const waiting = payableNextCycleStatus(15, '2026-10', day('2026-11-01'), 30, cycle)
    expect(waiting.phase).toBe('awaiting_statement')
    expect(iso(waiting.date)).toBe('2026-12-16') // 2027-01-15 - 30 天

    const inWindow = payableNextCycleStatus(15, '2026-10', day('2026-12-20'), 30, cycle)
    expect(inWindow.phase).toBe('awaiting_payment')
    expect(iso(inWindow.date)).toBe('2027-01-15')
  })

  it('每年：按次年同月同日推导下期（含闰年 2 月 29 日平年收拢）', () => {
    const yearly = { cycle_type: 'yearly' as const, due_month: 6 }
    const waiting = payableNextCycleStatus(18, '2026-06', day('2026-07-01'), 30, yearly)
    expect(waiting.phase).toBe('awaiting_statement')
    expect(iso(waiting.date)).toBe('2027-05-19') // 2027-06-18 - 30 天

    const leapYearly = { cycle_type: 'yearly' as const, due_month: 2 }
    const inWindow = payableNextCycleStatus(29, '2028-02', day('2029-02-10'), 30, leapYearly)
    expect(inWindow.phase).toBe('awaiting_payment')
    expect(iso(inWindow.date)).toBe('2029-02-28')
  })
})
