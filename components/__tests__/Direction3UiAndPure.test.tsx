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
  useAuth: () => ({ user: { id: 'u-admin', role: 'admin', name: 'Hubert', email: 'h@example.com' } }),
}))

import {
  classifyBillItem,
  computeActiveInstallmentsExposure,
  computeThreePartDebtBreakdown,
  estimateBillRepaymentHealth,
  generateInstallmentSchedule,
  normalizeBillItemInput,
  parseCsvBillItems,
  parseCsvMatrix,
  parsePastedBillItems,
  buildSafeCsv,
  sanitizeCsvCell,
  signedItemAmount,
  validateFxLockInput,
} from '@/lib/direction3/pure'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { ExportDialog } from '@/components/mobile/ExportDialog'
import { BillRepaymentHealthCard } from '@/components/mobile/BillRepaymentHealthCard'
import { CategoryBreakdownSection } from '@/components/mobile/CategoryBreakdownSection'
import { DashboardView } from '@/components/obsidian/DashboardView'
import { computeMetrics } from '@/lib/dashboard-metrics'
import type { BillDashboardItem } from '@/lib/api/bills'
import type { InstallmentPlan } from '@/lib/direction3/types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Direction 3 pure financial & import helpers', () => {
  it('防双重负号与自动分类：退款存储正数且净额为负', () => {
    const starbucks = normalizeBillItemInput({
      description: '星巴克消费',
      amount: 45,
    })
    expect(starbucks.category).toBe('dining')
    expect(starbucks.item_type).toBe('purchase')
    expect(starbucks.amount).toBe(45)

    const refund = normalizeBillItemInput({
      description: '淘宝退款',
      amount: -100,
    })
    expect(refund.item_type).toBe('refund')
    expect(refund.amount).toBe(100)
    expect(signedItemAmount(refund as { item_type: 'refund'; amount: number })).toBe(-100)
  })

  it('用户商户记忆规则优先于内置词典', () => {
    const userRules = new Map<string, 'entertainment'>([['starbucks', 'entertainment']])
    const cat = classifyBillItem(
      { description: 'ALIPAY*STARBUCKS #102', merchant_name: 'STARBUCKS #102' },
      userRules,
    )
    expect(cat).toBe('entertainment')
  })

  it('粘贴文本导入：MM/DD 跨年补齐与重复项默认取消勾选', () => {
    const rows = parsePastedBillItems('12/28 星巴克 38.00\n01/05 滴滴出行 25.00', {
      billMonth: '2026-01',
      defaultCurrency: 'CNY',
      existingItems: [
        {
          transaction_date: '2025-12-28',
          description: '星巴克',
          item_type: 'purchase',
          amount: 38,
        },
      ],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].item.transaction_date).toBe('2025-12-28')
    expect(rows[0].isDuplicate).toBe(true)
    expect(rows[0].checked).toBe(false)
    expect(rows[1].item.transaction_date).toBe('2026-01-05')
    expect(rows[1].isDuplicate).toBe(false)
    expect(rows[1].checked).toBe(true)
  })

  it('RFC 4180 CSV 解析：支持引号内逗号与中文表头自动识别', () => {
    const matrix = parseCsvMatrix('交易日期,商户,金额,币种\n2026-11-01,"Amazon, Inc.",120.50,USD')
    const rows = parseCsvBillItems(
      matrix,
      { dateCol: 0, descCol: 1, amountCol: 2, debitCreditCol: null, currencyCol: 3, categoryCol: null },
      { hasHeader: true, defaultCurrency: 'CNY' },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].item.description).toBe('Amazon, Inc.')
    expect(rows[0].item.currency).toBe('USD')
    expect(rows[0].item.category).toBe('shopping')
  })

  it('分期本金守恒：1000 / 3 期免息分摊严格合计 1000.00', () => {
    const schedule = generateInstallmentSchedule({
      principal_amount: 1000,
      total_periods: 3,
      paid_periods: 0,
      fee_mode: 'interest_free',
      fee_charge_mode: 'per_period',
      start_month: '2026-11',
      due_day: 15,
      due_month_offset: 0,
    })
    expect(schedule.map((s) => s.principal)).toEqual([333.33, 333.33, 333.34])
    const sum = schedule.reduce((acc, s) => acc + s.principal, 0)
    expect(Math.round(sum * 100) / 100).toBe(1000)
  })

  it('合并账户防重：included_in_statement 命中同 account_id 已出账期时不重复计入未出本金', () => {
    const plan: InstallmentPlan = {
      id: 'inst-1',
      card_id: 'sub-card-2',
      title: '副卡分期',
      plan_type: 'purchase',
      currency: 'CNY',
      principal_amount: 1000,
      total_periods: 2,
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
    }
    const scopes = new Set(['acc:acc-1:2026-11'])
    const accountMap = new Map<string, string | null>([['sub-card-2', 'acc-1']])
    const exposure = computeActiveInstallmentsExposure([plan], scopes, accountMap)
    expect(exposure.unbilledByCardAndPlan.get('inst-1')?.unbilledPrincipal).toBe(500)
  })

  it('两档滚动利息：Tier A FIFO 冲抵精确计算且全额还清返回 0', () => {
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
          currency: 'CNY',
          item_type: 'purchase',
        },
        {
          transaction_date: '2026-10-15',
          amount: 1000,
          currency: 'CNY',
          item_type: 'purchase',
        },
      ],
      payments: [{ amount: 1000, paid_at: '2026-10-20' }],
      dailyRate: 0.0005,
      estimateDate: '2026-10-25',
    })
    // 1000 * 0.0005 * 15 + 1000 * 0.0005 * 10 = 7.5 + 5 = 12.5
    expect(health.tier).toBe('A_items')
    expect(health.min_payment_status).toBe('covered')
    expect(health.estimated_interest).toBe(12.5)

    const paidFull = estimateBillRepaymentHealth({
      bill: {
        bill_month: '2026-10',
        bill_amount: 2000,
        min_payment: 0,
        due_date: '2026-11-10',
      },
      items: [],
      payments: [{ amount: 2000, paid_at: '2026-10-20' }],
    })
    expect(paidFull.is_fully_paid).toBe(true)
    expect(paidFull.estimated_interest).toBe(0)
    expect(paidFull.min_payment_status).toBe('unset')
  })

  it('CSV 公式注入防护：拦截前导空格及 = + - @ 等载荷', () => {
    expect(sanitizeCsvCell("=CMD|'/C calc'!A0")).toBe("'=CMD|'/C calc'!A0")
    expect(sanitizeCsvCell(' =1+1')).toBe("' =1+1")
    expect(sanitizeCsvCell('+SUM(1,2)')).toBe('"\'+SUM(1,2)"')
    expect(sanitizeCsvCell('@test')).toBe("'@test")
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1")
  })

  it('汇率锁定校验：一致通过，偏差超 0.05 拦截', () => {
    const ok = validateFxLockInput({
      amount: 500,
      billCurrency: 'USD',
      settledCurrency: 'CNY',
      settledAmount: 3625,
      lockedFxRate: 7.25,
    })
    expect(ok.ok).toBe(true)

    const bad = validateFxLockInput({
      amount: 500,
      billCurrency: 'USD',
      settledCurrency: 'CNY',
      settledAmount: 3625,
      lockedFxRate: 7.0,
    })
    expect(bad.ok).toBe(false)
  })

  it('首页三项总欠款聚合正确拆分普通/分期/贷款', () => {
    const res = computeThreePartDebtBreakdown({
      bills: [
        {
          card_id: 'c1',
          bill_month: '2026-11',
          computed_status: 'unpaid',
          remaining_amount: 2000,
          card: { card_type: 'credit', card_product: { currency: 'CNY' } },
        },
        {
          card_id: 'c-loan',
          bill_month: '2026-11',
          computed_status: 'unpaid',
          remaining_amount: 5000,
          card: { card_type: 'loan', card_product: { currency: 'CNY' } },
        },
      ],
      payables: [{ category: 'loan', status: 'unpaid', amount: 1000, paid_amount: 200, currency: 'CNY' }],
      installmentPlans: [
        {
          id: 'p1',
          card_id: 'c1',
          title: '分期',
          plan_type: 'purchase',
          currency: 'CNY',
          principal_amount: 1000,
          total_periods: 3,
          paid_periods: 0,
          fee_mode: 'interest_free',
          fee_charge_mode: 'per_period',
          start_month: '2026-12',
          due_day: 10,
          due_month_offset: 0,
          billing_mode: 'independent',
          status: 'active',
          created_at: '2026-11-01',
          updated_at: '2026-11-01',
        },
      ],
      targetCurrency: 'CNY',
      rates: null,
    })
    expect(res.plainOwed).toBe(2000)
    expect(res.installmentOwed).toBe(1000)
    expect(res.loanOwed).toBe(5800)
    expect(res.totalDebt).toBe(8800)
  })
})

describe('Direction 3 UI components', () => {
  it('PaymentForm：外币账单展示动态原币符号并双向联动锁定汇率', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <PaymentForm
        open={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        totalAmount={500}
        billMonth='2026-11'
        billCurrency='USD'
        displayCurrency='CNY'
        fxRates={null}
      />,
    )

    expect(screen.getByText(/账单总额: US\$500\.00/)).toBeInTheDocument()
    const settledInput = screen.getByLabelText(/实付金额 \(CNY\)/)
    await user.type(settledInput, '3625')
    const rateInput = screen.getByLabelText(/锁定汇率/) as HTMLInputElement
    expect(rateInput.value).toBe('7.2500')

    await user.click(screen.getByRole('button', { name: '确认已还款' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500,
          settled_currency: 'CNY',
          settled_amount: 3625,
          locked_fx_rate: 7.25,
        }),
      )
    })
  })

  it('ExportDialog：admin 可选全家庭合并，member 不显示全家庭选项', () => {
    const holders = [
      { id: 'h1', name: '张三', created_by: 'u1', avatar_color: '#000', created_at: '2026-01-01' },
      { id: 'h2', name: '李四', created_by: 'u1', avatar_color: '#111', created_at: '2026-01-01' },
    ]
    const { rerender } = render(
      <ExportDialog
        open={true}
        onClose={vi.fn()}
        holderId=''
        holders={holders}
        cards={[]}
        isAdmin={true}
      />,
    )
    expect(screen.getByRole('option', { name: '全部家庭成员（全家庭合并）' })).toBeInTheDocument()

    rerender(
      <ExportDialog
        open={true}
        onClose={vi.fn()}
        holderId='h1'
        holders={holders}
        cards={[]}
        isAdmin={false}
      />,
    )
    expect(screen.queryByRole('option', { name: '全部家庭成员（全家庭合并）' })).not.toBeInTheDocument()
  })

  it('BillRepaymentHealthCard：缺失最低还款额呈中性状态，无明细呈档位B说明', () => {
    render(
      <BillRepaymentHealthCard
        bill={{
          bill_month: '2026-11',
          bill_amount: 1200,
          min_payment: 0,
          statement_date: '2026-11-05',
          due_date: '2026-11-25',
        }}
        cardType='credit'
        currency='USD'
        items={[]}
        payments={[]}
      />,
    )
    expect(screen.getByText(/未设置最低还款额/)).toBeInTheDocument()
    expect(screen.getByText(/档位 B：当前账单未录入明细/)).toBeInTheDocument()
  })

  it('CategoryBreakdownSection：无明细显示引导空态，缺汇率显示显式告警', () => {
    const { rerender } = render(
      <CategoryBreakdownSection
        breakdown={{
          items: [],
          covered_bills: 0,
          total_bills: 2,
          fx_converted: true,
          fx_unconverted_currencies: [],
          unallocated_refunds_by_currency: {},
        }}
        displayCurrency='CNY'
        filters={{}}
        includeFees={true}
        onToggleIncludeFees={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('暂无交易明细数据')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去账单页补录' })).toHaveAttribute('href', '/bills')

    rerender(
      <CategoryBreakdownSection
        breakdown={{
          items: [
            {
              category: 'dining',
              amount: 1000,
              percentage: 100,
              item_count: 3,
              by_currency: { CNY: 1000, USD: 100 },
              fx_converted: false,
              fx_unconverted_currencies: ['USD'],
            },
          ],
          covered_bills: 1,
          total_bills: 2,
          fx_converted: false,
          fx_unconverted_currencies: ['USD'],
          unallocated_refunds_by_currency: {},
        }}
        displayCurrency='CNY'
        filters={{}}
        includeFees={true}
        onToggleIncludeFees={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText(/以下币种暂缺汇率，未纳入占比折算：USD/)).toBeInTheDocument()
  })

  it('DashboardView：展开总欠款不再显示暂未接入，显示三项真实金额与预测入口', () => {
    const metrics = computeMetrics([] as BillDashboardItem[], 7, 'CNY', null, [])
    const onNavCashflow = vi.fn()
    render(
      <DashboardView
        metrics={metrics}
        holderPills={[{ value: 'all', label: '全部' }]}
        holderFilter='all'
        onHolderFilter={vi.fn()}
        futureRange={7}
        onFutureRange={vi.fn()}
        debtExpanded={true}
        onDebtExpanded={vi.fn()}
        privacyOn={false}
        privacyIcon={<span>eye</span>}
        onTogglePrivacy={vi.fn()}
        amountClass='num-tabular'
        displayCurrency='CNY'
        onPaySingle={vi.fn()}
        onPayAllOpen={vi.fn()}
        onNavBills={vi.fn()}
        onNavPromos={vi.fn()}
        onNavCashflowForecast={onNavCashflow}
        totalCardCount={1}
        holders={[{ id: 'h1', name: '张三' }]}
        cardsByHolder={{ h1: 1 }}
        quickActions={[]}
        promoCount={0}
        urgentReminders={[]}
        userName='张三'
        userEmail='test@example.com'
        debtBreakdown={{
          totalDebt: 3500,
          installmentOwed: 1200,
          loanOwed: 300,
          plainOwed: 2000,
        }}
      />,
    )
    expect(screen.queryByText('暂未接入')).not.toBeInTheDocument()
    expect(screen.getByText('¥1,200')).toBeInTheDocument()
    expect(screen.getByText('¥300')).toBeInTheDocument()
    expect(screen.getByText('¥3,500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 30/60/90 天预测 ›' })).toBeInTheDocument()
  })

  it('Direction3 复核回归：12 月账单 1/15 跨年进位、7-11 商户不误判为日期、行内去重与 BOM 首行修复', () => {
    const rows = parsePastedBillItems('1/15 7-11 便利店 25.00\n1/15 7-11 便利店 25.00', {
      billMonth: '2026-12',
      defaultCurrency: 'CNY',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].item.transaction_date).toBe('2027-01-15')
    expect(rows[0].item.description).toContain('7-11')
    expect(rows[0].isDuplicate).toBe(false)
    expect(rows[0].checked).toBe(true)
    expect(rows[1].isDuplicate).toBe(true)
    expect(rows[1].checked).toBe(false)

    const csv = buildSafeCsv(['商户', '金额'], [{ 商户: '星巴克', 金额: 38 }])
    expect(csv.startsWith('\uFEFF商户,金额\n')).toBe(true)
  })

  it('BillRepaymentHealthCard & PaymentForm 复核回归：月底钳制、日利率无效提示、非法金额拦截', async () => {
    const user = userEvent.setup()
    render(
      <BillRepaymentHealthCard
        bill={{
          bill_month: '2026-01',
          bill_amount: 2000,
          min_payment: 200,
          statement_date: '2026-01-31',
          due_date: '2026-02-20',
        }}
        cardType='credit'
        currency='CNY'
        items={[]}
        payments={[]}
      />,
    )
    await user.click(screen.getByRole('button', { name: '还款利息试算' }))
    expect(screen.getByText(/截至 2026-02-28/)).toBeInTheDocument()
    const rateInput = screen.getByLabelText('测算日利率 (%)')
    await user.clear(rateInput)
    await user.type(rateInput, '2')
    expect(screen.getByText(/输入无效（需在 0–1% 之间），已按默认 0\.05% 试算/)).toBeInTheDocument()

    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <PaymentForm
        open={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        totalAmount={0}
        billCurrency='CNY'
      />,
    )
    const amountInput = screen.getByLabelText(/还款金额/)
    await user.clear(amountInput)
    await user.type(amountInput, '-5')
    await user.click(screen.getByRole('button', { name: '确认已还款' }))
    expect(screen.getByText('请输入有效的还款金额')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
