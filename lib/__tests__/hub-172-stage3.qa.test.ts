import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { dispatchRpc } from '../api/rpc-dispatch'
import { clearFxCache } from '../fx'
import type { SessionUser } from '../session'
import * as frontend from '../direction3/rpc'
import * as webFinance from '../direction3/pure'
import * as apiFinance from '../api/direction3.shared'
import * as finance from '../finance'
import type { BillItem } from '../direction3/types'

const admin: SessionUser = { id: 'qa-admin', email: 'admin@example.test', name: null, role: 'admin', created_at: '' }
const member: SessionUser = { id: 'qa-member', email: 'member@example.test', name: null, role: 'member', created_at: '' }
const monthly = { mode: 'monthly', period: '2026-11', scope: 'family' } as const
const plan = {
  card_id: 'card-a', title: 'QA plan', plan_type: 'purchase', currency: 'USD',
  principal_amount: 1000, total_periods: 3, paid_periods: 0, fee_mode: 'interest_free',
  start_month: '2026-11', due_day: 30, due_month_offset: 0, billing_mode: 'independent',
  fee_charge_mode: 'per_period',
} as const
const repayment = {
  bill: { bill_month: '2026-10', bill_amount: 2000, due_date: '2026-10-24', statement_date: '2026-10-15', min_payment: 0 },
  items: [
    { amount: 1000, currency: 'CNY', item_type: 'purchase', transaction_date: '2026-10-05' },
    { amount: 1000, currency: 'CNY', item_type: 'purchase', transaction_date: '2026-10-15' },
  ] as BillItem[],
  payments: [{ amount: 1000, paid_at: '2026-10-20' }],
  billCurrency: 'CNY',
  estimateDate: '2026-10-25',
}

describe('HUB-172 Stage 3 integration', () => {
  let db: SqliteD1
  let ratesAvailable: boolean

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T09:00:00+08:00'))
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)
    ratesAvailable = true
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input.startsWith('/api/rpc/')) {
        const [, , , module, method] = input.split('/')
        const { args } = JSON.parse(String(init?.body)) as { args: unknown[] }
        const result = await dispatchRpc(module, method, args, admin)
        return Response.json(result, { status: result.status })
      }
      return Response.json({ base: 'USD', timestamp: 1794700800, rates: { USD: 1, CNY: 7, HKD: 7.8 } }, {
        status: ratesAvailable ? 200 : 503,
      })
    })
    await clearFxCache()
    db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('qa-admin', 'admin@example.test', 'hash'), ('qa-member', 'member@example.test', 'hash');
      INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
        ('holder-a', 'qa-admin', 'qa-admin', 'Admin holder', 'qa-admin'),
        ('holder-b', 'qa-admin', 'qa-member', 'Member holder', 'qa-member');
      INSERT INTO banks (id, name) VALUES ('qa-bank', 'QA bank');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
        VALUES ('usd', 'qa-bank', 'QA bank', 'USD card', 'USD', 'after_billing', 20),
               ('cny', 'qa-bank', 'QA bank', 'CNY card', 'CNY', 'after_billing', 20);
      INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day)
        VALUES ('card-a', 'holder-a', 'usd', '1234', 5), ('card-b', 'holder-b', 'cny', '5678', 5);
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, statement_date)
        VALUES ('bill-a', 'card-a', '2026-11', 500, '2026-11-25', '2026-11-05'),
               ('bill-b', 'card-b', '2026-11', 1000, '2026-11-25', '2026-11-05');
    `)
  })

  afterEach(async () => {
    await clearFxCache()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    db.close()
  })

  it('保留原币分项，并在 USD 汇率缺失时排除折算金额', async () => {
    db.exec(`
      INSERT INTO bill_items (id, bill_id, description, amount, currency, category, item_type)
        VALUES ('item-a', 'bill-a', 'Shopping', 100, 'USD', 'shopping', 'purchase'),
               ('item-b', 'bill-b', 'Dining', 1000, 'CNY', 'dining', 'purchase');
    `)
    const filters = { from_month: '2026-11', to_month: '2026-11', display_currency: 'CNY' }
    const converted = await frontend.getCategoryBreakdownExtended(filters)
    expect(converted.items.find(item => item.category === 'shopping')?.amount).toBe(700)
    ratesAvailable = false
    await clearFxCache()
    const degraded = await frontend.getCategoryBreakdownExtended(filters)
    expect(degraded.fx_unconverted_currencies).toEqual(['USD'])
    expect(degraded.items.find(item => item.category === 'shopping')).toMatchObject({
      amount: 0, by_currency: { USD: 100 },
    })
    expect(degraded.items.find(item => item.category === 'dining')?.percentage).toBe(100)
  })

  it('分类钻取给 Web 返回可用于更新明细的 ID', async () => {
    db.exec(`
      INSERT INTO bill_items (id, bill_id, description, amount, currency, category, item_type)
        VALUES ('item-a', 'bill-a', 'Shopping', 100, 'USD', 'shopping', 'purchase');
    `)
    const items = await frontend.getCategoryDrilldownItems({ category: 'shopping' })
    expect(items).toMatchObject([{ item_id: 'item-a', bill_id: 'bill-a' }])
  })

  it('保留分类统计的明细账单覆盖率', async () => {
    db.exec(`
      INSERT INTO bill_items (id, bill_id, description, amount, currency, category, item_type)
        VALUES ('item-a', 'bill-a', 'Shopping', 100, 'USD', 'shopping', 'purchase');
    `)
    expect(await frontend.getCategoryBreakdownExtended({})).toMatchObject({ covered_bills: 1, total_bills: 2 })
  })

  it('锁定的 3,625 CNY 历史成本不依赖实时汇率', async () => {
    await frontend.createPaymentWithFx({
      bill_id: 'bill-a', amount: 500, paid_at: '2026-11-14',
      settled_currency: 'CNY', settled_amount: 3625, locked_fx_rate: 7.25,
    })
    for (const available of [true, false]) {
      ratesAvailable = available
      await clearFxCache()
      const result = await dispatchRpc('exports', 'getStatementReport', [{ ...monthly, display_currency: 'CNY' }], admin)
      expect(result).toMatchObject({ status: 200, data: { converted_totals: { paid: 3625 } } })
    }
  })

  it('允许正好相差 0.05 的还款汇率锁定', async () => {
    const lock = { settled_currency: 'CNY', settled_amount: 3499.95, locked_fx_rate: 7 }
    expect(finance.validateAndNormalizeFxLock(lock, 500, 'USD')).toEqual(lock)
    await expect(frontend.createPaymentWithFx({
      bill_id: 'bill-a', amount: 500, paid_at: '2026-11-14', ...lock,
    })).resolves.toBeDefined()
  })

  it('三种摊销模式均按分守恒且各期本金非负', () => {
    for (const feeMode of ['interest_free', 'equal_principal_fee', 'equal_installment_apr'] as const) {
      const input = { ...plan, fee_mode: feeMode, apr: 0.12, fee_rate_per_period: 0.005 }
      for (const calculate of [finance.generateInstallmentSchedule, apiFinance.generateInstallmentSchedule, webFinance.generateInstallmentSchedule]) {
        const schedule = calculate(input)
        expect(schedule.reduce((total, period) => total + Math.round(period.principal * 100), 0)).toBe(100000)
        expect(schedule.every(period => period.principal >= 0)).toBe(true)
      }
    }
  })

  it('小额长分期也不会产生负本金或负期供', () => {
    const input = { ...plan, principal_amount: 0.3, total_periods: 60 }
    const minimum = (calculate: (value: typeof input) => { principal: number }[]) =>
      Math.min(...calculate(input).map(period => period.principal))
    expect(minimum(finance.generateInstallmentSchedule)).toBe(0)
    expect({ rpc: minimum(apiFinance.generateInstallmentSchedule), web: minimum(webFinance.generateInstallmentSchedule) })
      .toEqual({ rpc: 0, web: 0 })
  })

  it('通过 Web 创建分期后保留已还期数', async () => {
    const created = await frontend.createInstallmentPlan({ ...plan, paid_periods: 1 })
    expect(created.paid_periods).toBe(1)
  })

  it('通过 Web 修改分期后保留已还期数和跨月规则', async () => {
    const created = await frontend.createInstallmentPlan(plan)
    await frontend.updateInstallmentPlan(created.id, { title: 'Edited plan', paid_periods: 1, due_month_offset: 1 })
    expect((await frontend.getInstallmentPlans({ card_id: plan.card_id }))[0])
      .toMatchObject({ title: 'Edited plan', paid_periods: 1, due_month_offset: 1 })
  })

  it('按左闭右开天数计算两档利息并识别未设置最低还款额', () => {
    for (const estimate of [finance.estimateBillRepaymentHealth, webFinance.estimateBillRepaymentHealth]) {
      expect(estimate(repayment)).toMatchObject({
        tier: 'A_items', estimated_interest: 12.5, min_payment_status: 'unset',
      })
      expect(estimate({ ...repayment, items: [] })).toMatchObject({
        tier: 'B_statement_fallback', estimated_interest: 7.5,
      })
      expect(estimate({ ...repayment, payments: [{ amount: 2000, paid_at: '2026-10-20' }] }).estimated_interest)
        .toBe(0)
    }
  })

  it('Web 与共享利息计算都按上海自然日冲抵 UTC 还款时间', () => {
    const input = { ...repayment, payments: [{ amount: 1000, paid_at: '2026-10-19T16:00:00Z' }] }
    expect(finance.estimateBillRepaymentHealth(input).estimated_interest).toBe(12.5)
    expect(webFinance.estimateBillRepaymentHealth(input).estimated_interest).toBe(12.5)
  })

  it('现金流返回 Web 可渲染的来源与流水标识', async () => {
    const forecast = await frontend.getCashflowForecast({ horizon_days: 30, display_currency: 'CNY' })
    expect(forecast.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'bill', ref_id: 'bill-a', title: expect.any(String) }),
    ]))
  })

  it('在正式迁移上按 30/60/90 天展开三源，并排除逾期和缺汇率金额', async () => {
    db.exec(`
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, statement_date)
        VALUES ('past', 'card-a', '2026-10', 99, '2026-11-10', '2026-10-20');
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day)
        VALUES ('rent', 'qa-admin', 'Rent', 'rent', 300, 'CNY', 20);
    `)
    await frontend.createInstallmentPlan({ ...plan, currency: 'HKD' })
    ratesAvailable = false
    await clearFxCache()
    for (const [horizon_days, rent, installments] of [[30, 300, 333.33], [60, 600, 666.66], [90, 900, 1000]] as const) {
      const result = await dispatchRpc('analytics', 'getCashflowForecast', [{ horizon_days }], admin)
      expect(result).toMatchObject({
        status: 200,
        data: {
          reserves_by_currency: {
            USD: { bill: 500, total: 500 },
            CNY: { bill: 1000, payable: rent, total: 1000 + rent },
            HKD: { installment: installments, total: installments },
          },
          overdue_alert: { count: 1, by_currency: { USD: 99 } },
          converted_summary: { total: 1000 + rent, unconverted_currencies: ['HKD', 'USD'] },
        },
      })
    }
  })

  it('合并账户副卡的本月分期不会重复计入首页总欠款', async () => {
    db.exec(`
      INSERT INTO credit_accounts (id, holder_id, bank_name, currency, statement_mode)
        VALUES ('merged', 'holder-a', 'QA bank', 'USD', 'merged');
      UPDATE credit_cards SET account_id = 'merged' WHERE id = 'card-a';
      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day)
        VALUES ('card-extra', 'holder-a', 'merged', 'usd', '9012', 5);
      UPDATE bills SET account_id = 'merged' WHERE id = 'bill-a';
    `)
    const created = await frontend.createInstallmentPlan({
      ...plan, card_id: 'card-extra', billing_mode: 'included_in_statement',
    })
    const forecast = await dispatchRpc('analytics', 'getCashflowForecast', [{ horizon_days: 30, display_currency: 'USD' }], admin)
    expect(forecast).toMatchObject({ status: 200 })
    expect((forecast.data as apiFinance.CashflowForecastResult).timeline.some(event => event.ref_id === created.id)).toBe(false)
    const result = webFinance.computeThreePartDebtBreakdown({
      bills: [{
        card_id: 'card-a', account_id: 'merged', bill_month: '2026-11', status: 'unpaid',
        remaining_amount: 500, card: { card_product: { currency: 'USD' } },
      }],
      cards: [
        { id: 'card-a', account_id: 'merged' },
        { id: 'card-extra', account_id: 'merged' },
      ],
      installmentPlans: [created], payables: [], targetCurrency: 'USD', rates: null,
    })
    expect(result).toMatchObject({ installmentOwed: 666.67, totalDebt: 1166.67 })
  })

  it('现金流按固定支出起算月展开并排除起算前账期', async () => {
    db.exec(`
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, cycle_type, cycle_months, anchor_period)
        VALUES ('anchor', 'qa-admin', 'Anchored', 'other', 100, 'CNY', 20, 'every_n_months', 2, '2026-12');
    `)
    const core = finance.buildCashflowForecast({
      bills: [], installments: [], horizonDays: 90, baseDate: '2026-11-15',
      payables: [{
        id: 'anchor', name: 'Anchored', amount: 100, currency: 'CNY', due_day: 20, is_active: 1,
        cycle_type: 'every_n_months', cycle_months: 2, anchor_period: '2026-12',
      }],
    })
    const expected = ['2026-12-20']
    expect(core.timeline.map(event => event.due_date)).toEqual(expected)
    const result = await dispatchRpc('analytics', 'getCashflowForecast', [{ horizon_days: 90 }], admin)
    const forecast = result.data as apiFinance.CashflowForecastResult
    expect(forecast.timeline.filter(event => event.source === 'payable').map(event => event.due_date)).toEqual(expected)
  })

  it('允许从 Web 导出指定月份的交易明细 CSV', async () => {
    await expect(frontend.exportFamilyCsvRows({
      table: 'bill_items', scope: 'family', mode: 'monthly', period: '2026-11',
    })).resolves.toMatchObject({ filename: expect.stringContaining('bill_items') })
  })

  it('使用真实 RPC 返回对象生成 Web 月报 CSV 和打印页所需的字段', async () => {
    const report = await frontend.getStatementReport(monthly)
    expect({
      totals_by_currency: typeof report.totals_by_currency,
      holders: Array.isArray(report.holders),
      bills: Array.isArray(report.bills),
    }).toEqual({ totals_by_currency: 'object', holders: true, bills: true })
    expect(webFinance.statementReportToCsv(report)).toContain('USD')
  })

  it('成员只能读取自己名下的预测和报表，整户请求返回 403', async () => {
    const forecast = await dispatchRpc('analytics', 'getCashflowForecast', [{ horizon_days: 30 }], member)
    expect(forecast).toMatchObject({ status: 200, data: { timeline: [expect.objectContaining({ ref_id: 'bill-b' })] } })
    const family = await dispatchRpc('exports', 'getStatementReport', [monthly], member)
    expect(family.status).toBe(403)
    const own = await dispatchRpc('exports', 'getStatementReport', [{ ...monthly, scope: 'holder', holder_id: 'holder-b' }], member)
    expect(own).toMatchObject({ status: 200, data: { bills: [expect.objectContaining({ holder_id: 'holder-b' })] } })
  })
})
