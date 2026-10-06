import { describe, expect, it } from 'vitest'
import type { BillDashboardItem } from '../api/bills.server'
import {
  billCurrency,
  computeMetrics,
  countCardsByHolder,
  formatMoney,
} from '../dashboard-metrics'

/** 最小账单夹具：只带 computeMetrics 读取的字段（characterization 钉行为用）。 */
function bill(p: { days_until_due: number; remaining_amount: number; currency?: string; computed_status?: string }): BillDashboardItem {
  return {
    computed_status: p.computed_status ?? 'unpaid',
    remaining_amount: p.remaining_amount,
    days_until_due: p.days_until_due,
    card: { card_product: { currency: p.currency ?? 'CNY' } },
  } as unknown as BillDashboardItem
}

const RATES = { base: 'USD', rates: { USD: 1, CNY: 7.2 }, timestamp: 0, fetched_at: 0 }

describe('computeMetrics（现状 characterization）', () => {
  it('paid 账单被排除在所有合计之外', () => {
    const m = computeMetrics(
      [bill({ days_until_due: -3, remaining_amount: 999, computed_status: 'paid' })],
      7, 'CNY', null,
    )
    expect(m.totalPending).toBe(0)
    expect(m.overdueAmount).toBe(0)
    expect(m.futureAmount).toBe(0)
    expect(m.unpaidCount).toBe(0)
  })

  it('同币种求和与三段分类', () => {
    const m = computeMetrics(
      [
        bill({ days_until_due: -2, remaining_amount: 100 }),
        bill({ days_until_due: 3, remaining_amount: 200 }),
        bill({ days_until_due: 8, remaining_amount: 50 }),
      ],
      7, 'CNY', null,
    )
    // 汇率 null 时同币种恒等计入，不受影响
    expect(m.totalPending).toBe(350)
    expect(m.overdueAmount).toBe(100)
    expect(m.futureAmount).toBe(200)
    expect(m.ratesAvailable).toBe(false)
    expect(m.unconvertedCurrencies).toEqual([])
    expect(m.mixed).toBe(false)
  })

  it('逾期/未来边界：days_until_due < 0 为逾期，[0, N] 为未来', () => {
    const m = computeMetrics(
      [
        bill({ days_until_due: -1, remaining_amount: 10 }),
        bill({ days_until_due: 0, remaining_amount: 20 }),
        bill({ days_until_due: 7, remaining_amount: 40 }),
        bill({ days_until_due: 8, remaining_amount: 80 }),
      ],
      7, 'CNY', RATES,
    )
    expect(m.overdueAmount).toBe(10)
    expect(m.futureAmount).toBe(60)
    expect(m.totalPending).toBe(150)
  })

  it('跨币种 + 汇率可用：折算计入 total', () => {
    const m = computeMetrics(
      [
        bill({ days_until_due: 1, remaining_amount: 100, currency: 'CNY' }),
        bill({ days_until_due: 1, remaining_amount: 50, currency: 'USD' }),
      ],
      7, 'CNY', RATES,
    )
    // 50 USD = 50 / 1 * 7.2 = 360 CNY
    expect(m.totalPending).toBe(460)
    expect(m.ratesAvailable).toBe(true)
    expect(m.mixed).toBe(true)
    expect(m.unconvertedCurrencies).toEqual([])
  })

  it('跨币种 + 汇率缺失：该币种排除在 total 外并登记 unconverted', () => {
    const m = computeMetrics(
      [
        bill({ days_until_due: 1, remaining_amount: 100, currency: 'CNY' }),
        bill({ days_until_due: 1, remaining_amount: 50, currency: 'USD' }),
      ],
      7, 'CNY', null,
    )
    // 只有 CNY 自身恒等计入
    expect(m.totalPending).toBe(100)
    expect(m.unconvertedCurrencies).toEqual(['USD'])
  })
})

describe('formatMoney / billCurrency / countCardsByHolder（现状 characterization）', () => {
  it('formatMoney：币种符号 + 千分位，0 兜底', () => {
    expect(formatMoney(1234.5, 'CNY')).toBe('¥1,234.5')
    expect(formatMoney(1234567.89, 'CNY')).toBe('¥1,234,567.89')
    expect(formatMoney(0, 'CNY')).toBe('¥0')
  })

  it('billCurrency：卡产品币种优先，缺卡回落 fallback', () => {
    expect(billCurrency(bill({ days_until_due: 1, remaining_amount: 1, currency: 'USD' }), 'CNY')).toBe('USD')
    const noCard = { days_until_due: 1, remaining_amount: 1 } as unknown as BillDashboardItem
    expect(billCurrency(noCard, 'CNY')).toBe('CNY')
  })

  it('countCardsByHolder：按持卡人计数，跳过空 id', () => {
    expect(countCardsByHolder([
      { holder_id: 'h1' }, { holder_id: 'h1' }, { holder_id: 'h2' }, { holder_id: '' },
    ])).toEqual({ h1: 2, h2: 1 })
  })
})
