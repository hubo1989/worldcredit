import { describe, expect, it } from 'vitest'
import type { BillDashboardItem } from '../api/bills.server'
import type { PayableWithStatus } from '../api/payables.server'
import {
  billCurrency,
  computeMetrics,
  countCardsByHolder,
  formatMoney,
  getDueTodayBills,
  getDueTodayPayables,
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

/** 最小固定支出夹具。 */
function payable(p: {
  id?: string
  days_until_due: number
  amount: number
  paid_amount?: number
  currency?: string
  status?: 'unpaid' | 'paid' | 'overdue'
}): PayableWithStatus {
  return {
    id: p.id ?? 'pay-1',
    name: '房租',
    category: 'rent',
    amount: p.amount,
    paid_amount: p.paid_amount ?? 0,
    currency: p.currency ?? 'CNY',
    days_until_due: p.days_until_due,
    status: p.status ?? 'unpaid',
  } as unknown as PayableWithStatus
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

describe('getDueTodayBills（今天需还款列表）', () => {
  it('只保留当天到期、未结清、且仍有剩余待还的账单', () => {
    const due = bill({ days_until_due: 0, remaining_amount: 100 })
    expect(getDueTodayBills([
      due,
      // 已结清：仍标 days_until_due === 0，但 CTA 会被 markBillAsPaid 拒绝
      bill({ days_until_due: 0, remaining_amount: 0, computed_status: 'paid' }),
      // 未结清但剩余为 0：同样不该出现
      bill({ days_until_due: 0, remaining_amount: 0 }),
      // 明天到期 / 已逾期：不属于「今天」
      bill({ days_until_due: 1, remaining_amount: 10 }),
      bill({ days_until_due: -1, remaining_amount: 10 }),
    ])).toEqual([due])
  })
})

describe('当日待还总金额（账单 + 固定支出）', () => {
  it('getDueTodayPayables 只保留当天到期且仍有剩余待付的固定支出', () => {
    const partialToday = payable({ id: 'p-partial', days_until_due: 0, amount: 3000, paid_amount: 1200 })
    const settledPaid = payable({ id: 'p-paid', days_until_due: 0, amount: 1000, paid_amount: 1000, status: 'paid' })
    const centZero = payable({ id: 'p-cent', days_until_due: 0, amount: 100, paid_amount: 99.995, status: 'unpaid' })
    const tomorrow = payable({ id: 'p-tmr', days_until_due: 1, amount: 500 })
    const overdue = payable({ id: 'p-ov', days_until_due: -2, amount: 500, status: 'overdue' })

    expect(
      getDueTodayPayables([partialToday, settledPaid, centZero, tomorrow, overdue])
    ).toEqual([partialToday])
  })

  it('computeMetrics 汇总当日到期账单与固定支出并按汇率折算，缺汇率排除进 unconvertedCurrencies', () => {
    const m = computeMetrics(
      [
        bill({ days_until_due: 0, remaining_amount: 1000, currency: 'CNY' }),
        bill({ days_until_due: 3, remaining_amount: 500, currency: 'CNY' }),
      ],
      7,
      'CNY',
      RATES,
      [
        payable({ id: 'p-usd', days_until_due: 0, amount: 150, paid_amount: 50, currency: 'USD' }),
        payable({ id: 'p-hkd', days_until_due: 0, amount: 200, currency: 'HKD' }),
        payable({ id: 'p-paid', days_until_due: 0, amount: 900, paid_amount: 900, status: 'paid' }),
        payable({ id: 'p-next', days_until_due: 2, amount: 400, currency: 'CNY' }),
      ]
    )

    // USD 100 * 7.2 + CNY 1000 = 1720；HKD 缺汇率不得 1:1 混加
    expect(m.dueTodayAmount).toBe(1720)
    expect(m.dueTodayBills).toHaveLength(1)
    expect(m.dueTodayPayables.map(p => p.id)).toEqual(['p-usd', 'p-hkd'])
    expect(m.dueTodayCount).toBe(3)
    expect(m.unconvertedCurrencies).toContain('HKD')
    expect(m.fx.dueToday.unconverted_currencies).toEqual(['HKD'])
    // totalPending 仅统计账单未还，不被固定支出污染
    expect(m.totalPending).toBe(1500)
  })
})

