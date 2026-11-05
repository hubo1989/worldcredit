// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React, { Suspense } from 'react'

const routerBack = vi.fn()
const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: routerBack, push: routerPush }),
}))

vi.mock('@/lib/api/cards', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCardDetail: vi.fn(),
    updateCard: vi.fn(),
    updateCardHolder: vi.fn(),
    getCardProducts: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('@/lib/api/holders', () => ({
  getHolders: vi.fn(),
}))

vi.mock('@/components/mobile/CardDefinitionModal', () => ({
  CardDefinitionModal: ({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) => {
    if (!open) return null
    return (
      <div data-testid='card-def-modal'>
        <span>CardDefinitionModal Opened</span>
        <button type='button' onClick={onSaved}>保存定义</button>
        <button type='button' onClick={onClose}>关闭定义</button>
      </div>
    )
  },
}))

vi.mock('@/components/mobile/CardAccountModal', () => ({
  CardAccountModal: ({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) => {
    if (!open) return null
    return (
      <div data-testid='card-account-modal'>
        <span>CardAccountModal Opened</span>
        <button type='button' onClick={onSaved}>保存账户</button>
        <button type='button' onClick={onClose}>关闭账户</button>
      </div>
    )
  },
}))

import { getCardDetail } from '@/lib/api/cards'
import { getHolders } from '@/lib/api/holders'
import CardDetailPage from '@/app/(mobile)/cards/[id]/page'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import type { OpportunityDto } from '@/lib/opportunities/queries.server'

const mockedGetCardDetail = vi.mocked(getCardDetail)
const mockedGetHolders = vi.mocked(getHolders)

function makeMockDetail(overrides: Record<string, unknown> = {}) {
  return {
    card: {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'prod-1',
      card_number_last4: '8888',
      credit_limit: 50000,
      credit_limit_override: null,
      billing_day: 5,
      status: 'active' as const,
      card_type: 'credit' as const,
      created_at: '2026-01-01T00:00:00Z',
      card_holder: {
        id: 'holder-1',
        name: '张三',
      },
      card_product: {
        id: 'prod-1',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        currency: 'CNY',
        country: 'CN',
        payment_due_type: 'after_billing' as const,
        payment_due_value: 20,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      ...overrides,
    },
    bills: [],
    benefits: [],
    opportunities: [] as OpportunityDto[],
    dueDateResolution: {
      has_exact_due_date: true,
      exact_due_date: '2026-11-25',
      exact_source: 'bill_override',
      summary: '人工确认还款日',
      email_evidences: [],
    },
  }
}

async function renderCardDetailPage() {
  const settledParams = Promise.resolve({ id: 'card-1' })
  await act(async () => {
    render(
      <Suspense fallback={<div>Loading...</div>}>
        <CardDetailPage params={settledParams} />
      </Suspense>,
    )
  })
}

describe('CardDetailPage 与卡片组件回归测试', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetHolders.mockResolvedValue([
      {
        id: 'holder-1',
        name: '张三',
        created_by: 'user-1',
        avatar_color: '#1565c0',
        created_at: '2026-01-01T00:00:00Z',
      },
    ])
  })

  it('点击卡面「修改卡片信息」按钮可打开 CardDefinitionModal，保存后调用 load 刷新', async () => {
    mockedGetCardDetail.mockResolvedValue(makeMockDetail() as unknown as Awaited<ReturnType<typeof getCardDetail>>)
    await renderCardDetailPage()

    // 初始状态下 Modal 未打开
    expect(screen.queryByTestId('card-def-modal')).not.toBeInTheDocument()

    // 点击卡面右上角「修改卡片信息」
    const editDefBtn = screen.getByRole('button', { name: '修改卡片信息' })
    expect(editDefBtn).toBeInTheDocument()
    await user.click(editDefBtn)

    // 断言 CardDefinitionModal 成功打开
    expect(screen.getByTestId('card-def-modal')).toBeInTheDocument()

    // 点击保存定义，验证触发 load 重新拉取详情
    const initialCalls = mockedGetCardDetail.mock.calls.length
    await user.click(screen.getByRole('button', { name: '保存定义' }))
    expect(mockedGetCardDetail.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('点击「总额度」或日期与费用「编辑」按钮可打开 CardAccountModal，保存后调用 load 刷新', async () => {
    mockedGetCardDetail.mockResolvedValue(makeMockDetail() as unknown as Awaited<ReturnType<typeof getCardDetail>>)
    await renderCardDetailPage()

    // 初始状态下 CardAccountModal 未打开
    expect(screen.queryByTestId('card-account-modal')).not.toBeInTheDocument()

    // 点击总额度格子
    const limitBtn = screen.getByRole('button', { name: '修改额度与账户' })
    await user.click(limitBtn)

    // 断言 CardAccountModal 成功打开
    expect(screen.getByTestId('card-account-modal')).toBeInTheDocument()

    // 点击保存账户
    const initialCalls = mockedGetCardDetail.mock.calls.length
    await user.click(screen.getByRole('button', { name: '保存账户' }))
    expect(mockedGetCardDetail.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('CardDetailPage 仅拉取卡片详情，不再发起多余的 getHolders 请求 (#3)', async () => {
    mockedGetHolders.mockRejectedValueOnce(new Error('Network Error'))
    mockedGetCardDetail.mockResolvedValue(makeMockDetail() as unknown as Awaited<ReturnType<typeof getCardDetail>>)

    await renderCardDetailPage()

    // 页面主数据正常展示，未展示“加载卡片失败”
    expect(screen.queryByText('加载卡片失败')).not.toBeInTheDocument()
    expect(screen.getByText('招商银行')).toBeInTheDocument()
    expect(screen.getByText('经典白金卡')).toBeInTheDocument()
    expect(screen.getByText('张三 · 信用卡')).toBeInTheDocument()
    // 死代码清理验证：确认页面不再调用 getHolders
    expect(mockedGetHolders).not.toHaveBeenCalled()
  })

  it('可用机会入口恢复使用 next/link 实现客户端导航与预取 (#4)', async () => {
    const detailWithOpps = makeMockDetail()
    detailWithOpps.opportunities = [
      {
        account_id: 'acc-1',
        card_ids: ['card-1'],
        title: '周三 5 折餐饮',
        status: 'available',
        reason: '本周可用',
        remaining_count: 2,
        unit_label: '次',
      } as unknown as OpportunityDto,
    ]
    mockedGetCardDetail.mockResolvedValue(detailWithOpps as unknown as Awaited<ReturnType<typeof getCardDetail>>)

    await renderCardDetailPage()

    const oppLink = screen.getByRole('link', { name: /周三 5 折餐饮/ })
    expect(oppLink).toBeInTheDocument()
    expect(oppLink).toHaveAttribute('href', '/promos?card=card-1')

    const allLink = screen.getByRole('link', { name: '查看全部机会 ›' })
    expect(allLink).toBeInTheDocument()
    expect(allLink).toHaveAttribute('href', '/promos?card=card-1')
  })

  it('CreditCardVisual 在已用额度超额时截断为 0，不显示负数可用额度', () => {
    const cardData = makeMockDetail().card as unknown as Parameters<typeof CreditCardVisual>[0]['card']
    // 额度 50,000，已用 60,000 -> 可用截断为 0，显示 "可用 ¥0"
    render(<CreditCardVisual card={cardData} usedAmount={60000} />)

    expect(screen.getByText(/已用 ¥60,000/)).toBeInTheDocument()
    expect(screen.getByText(/可用 ¥0/)).toBeInTheDocument()
    expect(screen.queryByText(/-\s*¥/)).not.toBeInTheDocument()
    expect(screen.queryByText(/¥-10,000/)).not.toBeInTheDocument()
  })
})
