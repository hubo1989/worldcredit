// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'

const routerPush = vi.fn()
const routerBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u-admin', role: 'admin', name: 'Hubert', email: 'h@example.com' },
  }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => <div />,
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}))

vi.mock('@/lib/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/export')>()
  return {
    ...actual,
    downloadCsv: vi.fn(),
  }
})

import {
  computeActiveInstallmentsExposure as financeComputeActiveInstallmentsExposure,
  estimateBillRepaymentHealth as financeEstimateBillRepaymentHealth,
  generateInstallmentSchedule as financeGenerateInstallmentSchedule,
} from '@/lib/finance'
import {
  computeActiveInstallmentsExposure,
  computeThreePartDebtBreakdown,
  estimateBillRepaymentHealth,
  generateInstallmentSchedule,
  statementReportToCsv,
} from '@/lib/direction3/pure'
import {
  getCategoryBreakdownExtended,
  getCashflowForecast,
} from '@/lib/direction3/rpc'
import { CashflowForecastSection } from '@/components/mobile/CashflowForecastSection'
import { ExportDialog } from '@/components/mobile/ExportDialog'
import { CategoryBreakdownSection } from '@/components/mobile/CategoryBreakdownSection'
import StatementPrintPage from '@/app/(mobile)/analytics/statement/page'
import type { FamilyStatementReport } from '@/lib/direction3/types'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('HUB-171 QA rework regressions (P1-1 ~ P2-5)', () => {
  it('P1-1: 直接复用 HUB-169 分期函数且合并账户副卡不重复计入总负债 (1166.67 vs 1500)', () => {
    expect(generateInstallmentSchedule).toBe(financeGenerateInstallmentSchedule)
    expect(computeActiveInstallmentsExposure).toBe(financeComputeActiveInstallmentsExposure)

    const res = computeThreePartDebtBreakdown({
      bills: [
        {
          card_id: 'c-primary',
          account_id: 'acc-merged',
          bill_month: '2026-11',
          computed_status: 'unpaid',
          remaining_amount: 500,
          card: { card_type: 'credit', card_product: { currency: 'CNY' } },
        },
      ],
      // 副卡 c-supp 本期没有独立 bill，必须通过 cards 的 account_id 映射关联到 acc-merged
      cards: [
        { id: 'c-primary', account_id: 'acc-merged' },
        { id: 'c-supp', account_id: 'acc-merged' },
      ],
      payables: [],
      installmentPlans: [
        {
          id: 'inst-supp',
          card_id: 'c-supp',
          title: '副卡手机分期',
          plan_type: 'purchase',
          currency: 'CNY',
          principal_amount: 1000,
          total_periods: 3,
          paid_periods: 0,
          fee_mode: 'interest_free',
          fee_charge_mode: 'per_period',
          start_month: '2026-11',
          due_day: 15,
          due_month_offset: 0,
          billing_mode: 'included_in_statement',
          status: 'active',
          created_at: '2026-11-01',
          updated_at: '2026-11-01',
        },
      ],
      targetCurrency: 'CNY',
      rates: null,
    })

    // 2026-11 期 (333.33) 已被 acc-merged 主卡已出账单承接，仅剩后两期 333.33 + 333.34 = 666.67
    expect(res.plainOwed).toBe(500)
    expect(res.installmentOwed).toBe(666.67)
    expect(res.totalDebt).toBe(1166.67)
  })

  it('P1-2: 直接复用 HUB-169 滚动利息，UTC 时间戳按 Asia/Shanghai 自然日计算 (12.50)', () => {
    expect(estimateBillRepaymentHealth).toBe(financeEstimateBillRepaymentHealth)

    const health = estimateBillRepaymentHealth({
      bill: {
        bill_month: '2026-10',
        bill_amount: 2000,
        min_payment: 200,
        statement_date: '2026-10-20',
        due_date: '2026-11-10',
      },
      cardType: 'credit',
      items: [
        {
          transaction_date: '2026-10-05',
          amount: 1000,
          item_type: 'purchase',
          currency: 'CNY',
        },
        {
          transaction_date: '2026-10-15',
          amount: 1000,
          item_type: 'purchase',
          currency: 'CNY',
        },
      ],
      // UTC 2026-10-19T16:00:00Z = Asia/Shanghai 2026-10-20 00:00
      payments: [{ amount: 1000, paid_at: '2026-10-19T16:00:00Z' }],
      dailyRate: 0.0005,
      estimateDate: '2026-10-25',
    })

    expect(health.estimated_interest).toBe(12.5)
  })

  it('P1-3: CashflowForecastSection 使用 source/ref_id 渲染且未知 source 走徽标空兜底', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          base_date: '2026-11-25',
          horizon_days: 30,
          display_currency: 'CNY',
          reserves_by_currency: {
            CNY: { bill: 1200, installment: 500, payable: 0, total: 1700 },
          },
          converted_summary: {
            converted_currency: 'CNY',
            by_currency: { CNY: 1700 },
            total: 1700,
            converted: true,
            unconverted_currencies: [],
          },
          buckets: [],
          timeline: [
            {
              source: 'bill',
              ref_id: 'bill-abc',
              title: '2026-11 招商银行经典白',
              due_date: '2026-11-28',
              days_until_due: 3,
              amount: 1200,
              currency: 'CNY',
              card_tail: '8888',
            },
            {
              source: 'custom_unknown' as 'bill',
              ref_id: 'other-1',
              title: '未知类型待还',
              due_date: '2026-11-30',
              days_until_due: 5,
              amount: 500,
              currency: 'CNY',
            },
          ],
          overdue_alert: {
            count: 0,
            by_currency: {},
            total_converted: 0,
            fx_converted: true,
            items: [],
          },
        },
      }),
    })

    render(<CashflowForecastSection displayCurrency='CNY' />)

    await waitFor(() => {
      expect(screen.getByText('2026-11 招商银行经典白')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /2026-11 招商银行经典白/ })).toHaveAttribute(
      'href',
      '/bills/bill-abc',
    )
    expect(screen.getByText('未知类型待还')).toBeInTheDocument()

    // 验证 rpc 直接保留后端 source/ref_id
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          base_date: '2026-11-25',
          horizon_days: 30,
          display_currency: 'CNY',
          reserves_by_currency: {},
          converted_summary: {
            converted_currency: 'CNY',
            by_currency: {},
            total: 0,
            converted: true,
            unconverted_currencies: [],
          },
          buckets: [],
          timeline: [
            {
              source: 'payable',
              ref_id: 'pay-9',
              title: '房租',
              due_date: '2026-12-01',
              days_until_due: 6,
              amount: 3000,
              currency: 'CNY',
            },
          ],
          overdue_alert: { count: 0, by_currency: {}, total_converted: 0, fx_converted: true, items: [] },
        },
      }),
    })
    const fc = await getCashflowForecast({ horizon_days: 30, display_currency: 'CNY' })
    expect(fc.timeline[0].source).toBe('payable')
    expect(fc.timeline[0].ref_id).toBe('pay-9')
  })

  it('P1-4: ExportDialog 与 statement 页面严格对齐 PR #63 exports.server.ts 契约', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          headers: ['账单月份', '账单金额'],
          rows: [{ 账单月份: '2026-11', 账单金额: '500.00' }],
          filename: 'worldcredit-全家庭-2026-11-bills.csv',
        },
      }),
    })

    const holders = [
      { id: 'h1', name: '张三', created_by: 'u1', avatar_color: '#000', created_at: '2026-01-01' },
    ]
    render(
      <ExportDialog
        open={true}
        onClose={vi.fn()}
        holderId=''
        holders={holders}
        cards={[]}
        isAdmin={true}
        displayCurrency='CNY'
      />,
    )

    await user.click(screen.getByRole('button', { name: /导出 CSV/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rpc/exports/exportFamilyCsvRows',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const reqBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(reqBody.args[0]).toEqual(
      expect.objectContaining({
        table: 'bills',
        scope: 'family',
        mode: 'monthly',
        display_currency: 'CNY',
      }),
    )
    expect(reqBody.args[0]).not.toHaveProperty('type')
    expect(reqBody.args[0]).not.toHaveProperty('start_date')
    expect(reqBody.args[0]).not.toHaveProperty('end_date')

    const report: FamilyStatementReport = {
      mode: 'monthly',
      period: '2026-11',
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      scope: 'family',
      display_currency: 'CNY',
      holders: [
        { holder_id: 'h1', holder_name: '张三', bill_count: 1, total_billed: 1000, total_paid: 400, outstanding: 600 },
      ],
      bills: [
        {
          id: 'b1',
          holder_id: 'h1',
          holder_name: '张三',
          bank_name: '招商银行',
          card_name: '经典白',
          card_tail: '6666',
          bill_month: '2026-11',
          bill_amount: 1000,
          currency: 'CNY',
          min_payment: 100,
          due_date: '2026-11-25',
          status: 'partial',
        },
      ],
      payments: [],
      bill_items: [],
      installments: [],
      payables: [],
      category_breakdown: [],
      totals_by_currency: { CNY: { billed: 1000, paid: 400, outstanding: 600 } },
      converted_totals: {
        billed: 1000,
        paid: 400,
        outstanding: 600,
        fx_converted: true,
        fx_unconverted_currencies: [],
      },
    }

    const csv = statementReportToCsv(report)
    expect(csv).toContain('全家庭合并')
    expect(csv).toContain('1000.00')
    expect(csv).toContain('600.00')

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: report }),
    })
    window.history.pushState({}, '', '/analytics/statement?mode=monthly&period=2026-11&scope=family&currency=CNY')
    render(<StatementPrintPage />)
    await waitFor(() => {
      expect(screen.getByText(/全家庭合并 · 月度对账单/)).toBeInTheDocument()
    })
    expect(screen.getByText(/招商银行 经典白/)).toBeInTheDocument()
  })

  it('P2-5: getCategoryBreakdownExtended 调用 getCategoryBreakdownReport 返回 1/2 覆盖，下钻兼容 item_id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              category: 'dining',
              category_label: '餐饮美食',
              amount: 200,
              percentage: 100,
              item_count: 1,
              by_currency: { CNY: 200 },
              fx_converted: true,
              fx_unconverted_currencies: [],
            },
          ],
          covered_bills: 1,
          total_bills: 2,
          fx_converted: true,
          fx_unconverted_currencies: [],
          unallocated_refunds_by_currency: {},
        },
      }),
    })

    const breakdown = await getCategoryBreakdownExtended({ display_currency: 'CNY', include_fees: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rpc/analytics/getCategoryBreakdownReport',
      expect.anything(),
    )
    expect(breakdown.covered_bills).toBe(1)
    expect(breakdown.total_bills).toBe(2)

    // UI 下钻 & 改分类使用 item_id
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              item_id: 'bi-99',
              bill_id: 'bill-1',
              bill_month: '2026-11',
              description: '星巴克',
              merchant_name: '星巴克',
              category: 'dining',
              item_type: 'purchase',
              amount: 45,
              currency: 'CNY',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'bi-99' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    render(
      <CategoryBreakdownSection
        breakdown={breakdown}
        displayCurrency='CNY'
        filters={{}}
        includeFees={true}
        onToggleIncludeFees={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText(/1\/2 张账单/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /餐饮美食/ }))
    const select = await screen.findByLabelText('修改 星巴克 分类')
    await user.selectOptions(select, 'shopping')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rpc/billItems/updateBillItem',
        expect.objectContaining({
          body: JSON.stringify({
            args: ['bi-99', { category: 'shopping', remember_merchant: true }],
          }),
        }),
      )
    })
  })
})
