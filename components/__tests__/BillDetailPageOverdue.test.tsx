// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React, { Suspense } from 'react'

const routerBack = vi.fn()
const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: routerBack, push: routerPush }),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

vi.mock('@/lib/api/bills', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getBillDetail: vi.fn(),
    getPaymentTotal: vi.fn().mockResolvedValue(0),
    createPayment: vi.fn(),
    updateBillStatus: vi.fn(),
  }
})

import { getBillDetail } from '@/lib/api/bills'
import BillDetailPage from '@/app/(mobile)/bills/[id]/page'

const mockedGetBillDetail = vi.mocked(getBillDetail)

const settledParams = Promise.resolve({ id: 'b1' })

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={<div>Loading suspense...</div>}>
        <BillDetailPage params={settledParams} />
      </Suspense>,
    )
  })
}

function makeBillDetail(overrides: Record<string, unknown> = {}) {
  const { payments = [], ...billOverrides } = overrides
  return {
    bill: {
      id: 'b1',
      card_id: 'c1',
      bill_month: '2026-10',
      bill_amount: 1000,
      bill_amount_override: null,
      min_payment: 100,
      status: 'unpaid',
      due_date: '2026-10-25',
      statement_date: '2026-10-05',
      statement_start: '2026-09-06',
      statement_end: '2026-10-05',
      created_at: '2026-10-05T00:00:00Z',
      card: {
        id: 'c1',
        holder_id: 'h1',
        card_product_id: 'cp1',
        card_number_last4: '2104',
        credit_limit: 50000,
        billing_day: 5,
        status: 'active' as const,
        card_type: 'credit' as const,
        created_at: '2026-01-01T00:00:00Z',
        card_holder: {
          id: 'h1',
          name: '本人',
        },
        card_product: {
          id: 'cp1',
          bank_name: '民泰银行',
          card_name: '民泰普卡',
          currency: 'CNY',
          country: 'CN',
          payment_due_type: 'after_billing' as const,
          payment_due_value: 20,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      ...billOverrides,
    },
    payments,
  }
}

describe('BillDetailPage 逾期天数显示规则回归测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('待出账且已还款的账单：不显示已逾期天数，状态显示为已还', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2099-12-05',
        statement_end: '2099-12-05',
        due_date: '2020-01-01', // 即使历史数据中 due_date 在过去
        status: 'paid',
        payments: [{ id: 'p1', amount: 1000, paid_at: '2026-10-20' }],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 不显示任何逾期天数文案
    expect(screen.queryByText(/已逾期/)).not.toBeInTheDocument()
    expect(screen.getAllByText('已还').length).toBeGreaterThanOrEqual(1)
  })

  it('待出账且未还款的账单（即使到期日异常）：出账前不显示已逾期天数', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2099-12-05',
        statement_end: '2099-12-05',
        due_date: '2020-01-01', // 到期日异常在过去
        status: 'unpaid',
        payments: [],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 待出账未到出账日，出账前绝不显示已逾期
    expect(screen.queryByText(/已逾期/)).not.toBeInTheDocument()
    expect(screen.getByText('待还')).toBeInTheDocument()
  })

  it('已出账且已还款的账单：不显示已逾期天数', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        statement_end: '2026-08-05',
        due_date: '2026-08-25', // 过去的还款日
        status: 'paid',
        payments: [{ id: 'p1', amount: 1000, paid_at: '2026-08-20' }],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    expect(screen.queryByText(/已逾期/)).not.toBeInTheDocument()
    expect(screen.getAllByText('已还').length).toBeGreaterThanOrEqual(1)
  })

  it('已出账且未还款且已过还款日：正确显示已逾期天数', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        statement_end: '2026-08-05',
        due_date: '2026-08-25', // 过去很多天
        status: 'unpaid',
        payments: [],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    expect(screen.getByText(/已逾期 \d+ 天/)).toBeInTheDocument()
    expect(screen.getByText('逾期')).toBeInTheDocument()
  })

  it('卡片信息与覆盖额度正确渲染（尾号不重复前缀，手动额度覆盖生效）', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        due_date: '2026-08-25',
        card: {
          id: 'c1',
          holder_id: 'h1',
          card_product_id: 'cp1',
          card_number_last4: '2104',
          credit_limit: 50000,
          credit_limit_override: 88000,
          billing_day: 5,
          status: 'active' as const,
          card_type: 'credit' as const,
          created_at: '2026-01-01T00:00:00Z',
          card_holder: { id: 'h1', name: '本人' },
          card_product: {
            id: 'cp1',
            bank_name: '民泰银行',
            card_name: '民泰普卡',
            currency: 'CNY',
            country: 'CN',
            payment_due_type: 'after_billing' as const,
            payment_due_value: 20,
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
          },
        },
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 卡片尾号应直接展示 2104，而不是「尾号 2104」
    expect(screen.getByText('2104')).toBeInTheDocument()
    expect(screen.queryByText('尾号 2104')).not.toBeInTheDocument()

    // 额度应优先展示 credit_limit_override (¥88,000)，而不是原始的 ¥50,000
    expect(screen.getByText('¥88,000')).toBeInTheDocument()

    // 今日刷卡免息展示正常
    expect(screen.getByText(/今日刷卡免息/)).toBeInTheDocument()
  })

  it('数据库 status=paid 但实际部分还款：徽章显示「部分」，且逾期提示正常展示（不被 isSettled 抑制）', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        statement_end: '2026-08-05',
        due_date: '2026-08-25', // 已逾期
        bill_amount: 1000,
        status: 'paid', // 数据库错误落库为 paid
        payments: [{ id: 'p1', amount: 400, paid_at: '2026-08-20' }],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 徽章与重算一致显示「部分」；「已还」仅在金额四格 label 出现 1 次，状态徽章无「已还」
    expect(screen.getByText('部分')).toBeInTheDocument()
    expect(screen.getAllByText('已还')).toHaveLength(1)

    // isSettled 由重算状态推导为 false，逾期提示不应被抑制
    expect(screen.getByText(/已逾期 \d+ 天/)).toBeInTheDocument()
  })

  it('0 元账单且无流水：重算状态为 paid，状态徽章显示「已还」，且不显示免息/逾期提醒', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        statement_end: '2026-08-05',
        due_date: '2026-08-25',
        bill_amount: 0,
        status: 'unpaid', // 数据库即便为 unpaid
        payments: [],
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 0 元账单重算为已还：状态徽章与金额四格各 1 次，共 2 次
    expect(screen.getAllByText('已还')).toHaveLength(2)
    expect(screen.queryByText('待还')).not.toBeInTheDocument()
    expect(screen.queryByText(/已逾期/)).not.toBeInTheDocument()
    expect(screen.queryByText(/剩 \d+ 天免息/)).not.toBeInTheDocument()
  })

  it('数据库误标 status=paid 且金额>0 但无还款流水：删去兜底盲信后以重算状态为准，不掩盖为已还', async () => {
    mockedGetBillDetail.mockResolvedValueOnce(
      makeBillDetail({
        statement_date: '2026-08-05',
        statement_end: '2026-08-05',
        due_date: '2026-08-25', // 已逾期
        bill_amount: 1000,
        status: 'paid', // 误标 paid
        payments: [], // 但无流水
      }) as never,
    )

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('账单详情')).toBeInTheDocument()
    })

    // 应根据流水和到期日重算为逾期，而不是盲信数据库的 paid
    expect(screen.getByText('逾期')).toBeInTheDocument()
    expect(screen.getAllByText('已还')).toHaveLength(1)
  })
})
