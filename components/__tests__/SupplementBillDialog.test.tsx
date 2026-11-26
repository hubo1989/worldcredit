// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SupplementBillDialog } from '@/components/mobile/SupplementBillDialog'
import {
  computeSuggestedDueDate,
  detectMissingStatementsFromSummary,
  normalizeMissingStatementGraceDays,
  type CardWithMissingStatement,
} from '@/components/mobile/supplementBillApi'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { NotificationCenterView } from '@/components/mobile/NotificationCenterView'
import { DEFAULT_REMINDER_CONFIG } from '@/lib/api/preferences.shared'
import { compareBillsListCardsByMode, type BillsListCard } from '@/lib/utils'
import type { CardProduct, CreditAccount, CreditCard, UserNotificationItem } from '@/lib/types'

const mockCallRpc = vi.fn()
const mockGetBillByCardMonth = vi.fn()
const mockPush = vi.fn()
const mockBack = vi.fn()
const mockGetNotifications = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}))

vi.mock('@/lib/api/rpc-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/rpc-client')>('@/lib/api/rpc-client')
  return {
    ...actual,
    callRpc: (...args: unknown[]) => mockCallRpc(...args),
  }
})

vi.mock('@/lib/api/bills', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/bills')>('@/lib/api/bills')
  return {
    ...actual,
    getBillByCardMonth: (...args: unknown[]) => mockGetBillByCardMonth(...args),
  }
})

vi.mock('@/lib/api/notifications', () => ({
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  markNotificationRead: vi.fn().mockResolvedValue({ updated: true, unread_count: 0 }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ updated_count: 0, unread_count: 0 }),
  deleteNotification: vi.fn().mockResolvedValue({ deleted: true, unread_count: 0 }),
  deleteAllNotifications: vi.fn().mockResolvedValue({ deleted_count: 0, unread_count: 0 }),
}))

function makeCardSummary(overrides: {
  id?: string
  holderId?: string
  bankName?: string
  cardName?: string
  currency?: string
  last4?: string
  billingDay?: number
  overrideBillingDay?: number | null
  dueType?: CardProduct['payment_due_type']
  dueValue?: number
  status?: CreditCard['status']
  cardType?: CreditCard['card_type']
  createdAt?: string
  account?: CreditAccount
  historyMonths?: string[]
  memberCards?: CreditCard[]
} = {}): CardWithMissingStatement {
  const cardId = overrides.id ?? 'card-1'
  const holderId = overrides.holderId ?? 'h-1'
  const product: CardProduct = {
    id: 'prod-' + cardId,
    bank_id: 'bank-1',
    bank_name: overrides.bankName ?? '招商银行',
    card_name: overrides.cardName ?? '经典白金卡',
    country: 'CN',
    currency: overrides.currency ?? 'CNY',
    payment_due_type: overrides.dueType ?? 'after_billing',
    payment_due_value: overrides.dueValue ?? 20,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
  const card: CreditCard & { card_product: CardProduct } = {
    id: cardId,
    holder_id: holderId,
    account_id: overrides.account?.id ?? null,
    card_product_id: product.id,
    card_number_last4: overrides.last4 ?? '8888',
    credit_limit: 50000,
    billing_day: overrides.billingDay ?? 10,
    override_billing_day: overrides.overrideBillingDay ?? null,
    status: overrides.status ?? 'active',
    card_type: overrides.cardType ?? 'credit',
    created_at: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    card_product: product,
  }
  const historyBills = (overrides.historyMonths ?? []).map((m, idx) => ({
    id: `bill-${cardId}-${idx}`,
    card_id: cardId,
    account_id: overrides.account?.id ?? null,
    bill_month: m,
    bill_amount: 1000,
    due_date: `${m}-28`,
    status: 'paid' as const,
    created_at: '2026-01-01T00:00:00Z',
    card,
    payments: [],
    paid_amount: 1000,
    remaining_amount: 0,
    days_until_due: 0,
    interest_free_days_left: 0,
    computed_status: 'paid' as const,
  }))
  return {
    card,
    holder_id: holderId,
    status: 'unissued',
    activeBill: historyBills[0] ?? null,
    unpaidAmount: 0,
    graceDays: 30,
    billingDay: overrides.overrideBillingDay ?? overrides.billingDay ?? 10,
    nextBillingDate: new Date('2026-11-10'),
    nextDueDate: new Date('2026-11-30'),
    historyBills,
    account: overrides.account,
    memberCards: overrides.memberCards,
  }
}

describe('SupplementBillDialog 与超期检测客户端逻辑', () => {
  beforeEach(() => {
    mockCallRpc.mockReset()
    mockGetBillByCardMonth.mockReset().mockResolvedValue(null)
    mockPush.mockReset()
    mockBack.mockReset()
    mockGetNotifications.mockReset().mockResolvedValue({ items: [], unread_count: 0, total_count: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('推算三类还款日规则并支持月末 29-31 日收拢', () => {
    const baseCard = makeCardSummary({ billingDay: 31 }).card
    expect(
      computeSuggestedDueDate(baseCard, { payment_due_type: 'after_billing', payment_due_value: 20 }, '2026-02')
    ).toBe('2026-03-20')
    expect(
      computeSuggestedDueDate(baseCard, { payment_due_type: 'fixed', payment_due_value: 31 }, '2026-01')
    ).toBe('2026-02-28')
    expect(
      computeSuggestedDueDate(baseCard, { payment_due_type: 'fixed', payment_due_value: 31 }, '2024-01')
    ).toBe('2024-02-29')
    expect(
      computeSuggestedDueDate(
        baseCard,
        { payment_due_type: 'fixed_before_billing', payment_due_value: 5 },
        '2026-10'
      )
    ).toBe('2026-10-05')

    // 优先级：card.override_due_* -> card_product.payment_due_* -> account.due_*
    const overrideCard = {
      ...baseCard,
      override_due_type: 'fixed' as const,
      override_due_value: 8,
    }
    const accountWithFixedDue: Pick<CreditAccount, 'billing_day' | 'due_type' | 'due_value'> = {
      billing_day: 12,
      due_type: 'fixed',
      due_value: 18,
    }
    expect(
      computeSuggestedDueDate(
        overrideCard,
        { payment_due_type: 'after_billing', payment_due_value: 20 },
        '2026-10',
        accountWithFixedDue
      )
    ).toBe('2026-11-08')
    expect(
      computeSuggestedDueDate(
        baseCard,
        { payment_due_type: 'after_billing', payment_due_value: 15 },
        '2026-10',
        accountWithFixedDue
      )
    ).toBe('2026-11-15')
    expect(
      computeSuggestedDueDate(
        baseCard,
        null,
        '2026-10',
        accountWithFixedDue
      )
    ).toBe('2026-11-18')
    expect(
      computeSuggestedDueDate(
        baseCard,
        null,
        '2026-10',
        { billing_day: 10, due_type: 'after_billing', due_value: 25 }
      )
    ).toBe('2026-11-25')
  })

  it('自动预填卡/缺失账期/日期，改月份自动重算未手改日期，拦下非法日历日', async () => {
    const cardSummary = makeCardSummary({
      id: 'c-cmb',
      billingDay: 10,
      dueType: 'after_billing',
      dueValue: 20,
    })
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    mockCallRpc.mockResolvedValueOnce({
      bill: { id: 'b-new' },
      action: 'created',
      is_zero_bill: false,
      payment_created: false,
    })

    render(
      <SupplementBillDialog
        open
        onClose={onClose}
        onSuccess={onSuccess}
        cardsSummary={[cardSummary]}
        holderMap={{ 'h-1': '张三' }}
        initialCardId='c-cmb'
        initialBillMonth='2026-10'
      />
    )

    const monthInput = screen.getByLabelText(/缺失账期/) as HTMLInputElement
    const stmtInput = screen.getByLabelText(/出账日/) as HTMLInputElement
    const dueInput = screen.getByLabelText(/最后还款日/) as HTMLInputElement
    const amtInput = screen.getByLabelText(/本期应还金额/) as HTMLInputElement

    expect(monthInput.value).toBe('2026-10')
    expect(stmtInput.value).toBe('2026-10-10')
    expect(dueInput.value).toBe('2026-10-30')

    // 切换缺失账期后，未手改日期自动重算
    fireEvent.change(monthInput, { target: { value: '2026-09' } })
    await waitFor(() => {
      expect(stmtInput.value).toBe('2026-09-10')
      expect(dueInput.value).toBe('2026-09-30')
    })

    // 非法日历日（2026-02-30）被前端拦截，不发 RPC
    fireEvent.change(amtInput, { target: { value: '1280.50' } })
    fireEvent.change(dueInput, { target: { value: '2026-02-30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存补录' }))
    await waitFor(() => {
      expect(screen.getByText(/真实日历日/)).toBeInTheDocument()
    })
    expect(mockCallRpc).not.toHaveBeenCalled()

    // 恢复为合法历史日期并勾选「我已在银行还清本期」
    fireEvent.change(dueInput, { target: { value: '2026-09-30' } })
    const paidCheckbox = screen.getByRole('checkbox', { name: /我已在银行还清本期/ })
    fireEvent.click(paidCheckbox)
    fireEvent.click(screen.getByRole('button', { name: '保存补录' }))

    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith(
        'bills',
        'supplementMissingBill',
        expect.objectContaining({
          card_id: 'c-cmb',
          bill_month: '2026-09',
          bill_amount: 1280.5,
          due_date: '2026-09-30',
          pin_due_date: true,
          pin_statement_date: false,
          mark_as_paid: true,
        })
      )
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('支持一键确认 0 元零账单与一键切换至 BillImportDialog', async () => {
    const cardSummary = makeCardSummary({ id: 'c-zero', billingDay: 10 })
    const onSwitchToImport = vi.fn()
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    mockCallRpc.mockResolvedValueOnce({
      bill: { id: 'b-zero', status: 'paid', bill_amount_override: 0 },
      action: 'created',
      is_zero_bill: true,
      payment_created: false,
    })

    render(
      <SupplementBillDialog
        open
        onClose={onClose}
        onSuccess={onSuccess}
        cardsSummary={[cardSummary]}
        initialCardId='c-zero'
        initialBillMonth='2026-10'
        onSwitchToImport={onSwitchToImport}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /本期无消费，确认 0 元零账单/ }))
    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith(
        'bills',
        'supplementMissingBill',
        expect.objectContaining({
          card_id: 'c-zero',
          bill_month: '2026-10',
          bill_amount: 0,
          mark_as_paid: false,
        })
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /我有文本 \/ 截图 \/ PDF/ }))
    expect(onSwitchToImport).toHaveBeenCalledWith('c-zero')
  })

  it('客户端超期检测：排除停用/销卡/贷款卡/归档账户，合并账户去重且支持主卡停用顺位回退', () => {
    expect(normalizeMissingStatementGraceDays(0)).toBe(0)
    expect(normalizeMissingStatementGraceDays(15)).toBe(15)
    expect(normalizeMissingStatementGraceDays(99)).toBe(3)
    expect(normalizeMissingStatementGraceDays(-1)).toBe(3)

    const mergedAccount: CreditAccount = {
      id: 'acc-cmb',
      holder_id: 'h-1',
      bank_id: 'b-1',
      bank_name: '招商银行',
      currency: 'CNY',
      statement_mode: 'merged',
      quota_mode: 'shared',
      billing_day: 10,
      primary_card_id: 'c-primary-cancelled',
      status: 'active',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }
    const archivedAccount: CreditAccount = {
      ...mergedAccount,
      id: 'acc-archived',
      status: 'archived',
      primary_card_id: 'c-archived',
    }

    const cards: CardWithMissingStatement[] = [
      // 主卡已销卡，两张活跃副卡顺位由 c-sub-2 接替（仅输出 1 条）
      makeCardSummary({
        id: 'c-primary-cancelled',
        status: 'cancelled',
        billingDay: 10,
        last4: '1111',
        account: mergedAccount,
        historyMonths: ['2026-09'],
      }),
      makeCardSummary({
        id: 'c-sub-2',
        status: 'active',
        billingDay: 10,
        last4: '2222',
        createdAt: '2026-02-01T00:00:00Z',
        account: mergedAccount,
        historyMonths: ['2026-09'],
      }),
      makeCardSummary({
        id: 'c-sub-3',
        status: 'active',
        billingDay: 10,
        last4: '3333',
        createdAt: '2026-03-01T00:00:00Z',
        account: mergedAccount,
        historyMonths: [],
      }),
      // 贷款卡、冻结卡、归档账户卡均排除
      makeCardSummary({
        id: 'c-loan',
        cardType: 'loan',
        billingDay: 5,
        historyMonths: ['2026-09'],
      }),
      makeCardSummary({
        id: 'c-frozen',
        status: 'frozen',
        billingDay: 5,
        historyMonths: ['2026-09'],
      }),
      makeCardSummary({
        id: 'c-archived',
        billingDay: 5,
        account: archivedAccount,
        historyMonths: ['2026-09'],
      }),
      // 从未出账的活跃新卡：今天建卡不误报；11-05 建卡且账单日 10 号在 11-15（0天宽限）触发
      makeCardSummary({
        id: 'c-new-today',
        billingDay: 10,
        createdAt: '2026-11-15T00:00:00Z',
        historyMonths: [],
      }),
      makeCardSummary({
        id: 'c-new-overdue',
        billingDay: 10,
        createdAt: '2026-11-05T00:00:00Z',
        historyMonths: [],
      }),
    ]

    const result = detectMissingStatementsFromSummary(cards, {
      today: '2026-11-15',
      graceDays: 3,
    })

    expect(result.items.map(i => i.anchorCardId)).toEqual(['c-sub-2', 'c-new-overdue'])
    expect(result.items[0].isMerged).toBe(true)
    expect(result.items[0].missingBillMonth).toBe('2026-10')
    expect(result.items[0].subject).toContain('含尾号 2222 · 3333')
    expect(result.items[1].missingBillMonth).toBe('2026-11')
    expect(result.suppressedCardIds.has('c-sub-3')).toBe(true)
  })

  it('排序规则：tier=2 内超期未出账卡排在正常未出账卡之前并按 daysPast 降序', () => {
    const cards: Array<BillsListCard & { id: string }> = [
      { id: 'normal', status: 'unissued', billingDay: 20, graceDays: 30, nextDueDate: '2026-12-10', historyBills: [] },
      { id: 'miss-4', status: 'unissued', billingDay: 10, graceDays: 30, nextDueDate: '2026-12-10', historyBills: [], missingStatement: { daysPast: 4 } },
      { id: 'miss-12', status: 'unissued', billingDay: 5, graceDays: 30, nextDueDate: '2026-12-10', historyBills: [], missingStatement: { daysPast: 12 } },
      { id: 'overdue', status: 'overdue', billingDay: 1, graceDays: 30, nextDueDate: '2026-12-10', historyBills: [{ due_date: '2026-10-01', computed_status: 'overdue' }] },
    ]
    const sorted = [...cards].sort((a, b) => compareBillsListCardsByMode(a, b, 'nearest_due', new Date('2026-11-15')))
    expect(sorted.map(c => c.id)).toEqual(['overdue', 'miss-12', 'miss-4', 'normal'])
  })

  it('ReminderPreferencesCard 宽限天数 0-15 天调整与 NotificationCenterView 未收账单明细渲染', async () => {
    const onChange = vi.fn()
    render(<ReminderPreferencesCard config={DEFAULT_REMINDER_CONFIG} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '0 天' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing_statement_grace_days: 0 })
    )
    fireEvent.click(screen.getByRole('button', { name: '增加宽限天数' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing_statement_grace_days: 4 })
    )

    cleanup()

    const missingNotif: UserNotificationItem = {
      id: 'n-miss',
      user_id: 'u-1',
      notification_key: 'bill_missing_statement:c-1:2026-10:2026-11-15',
      category: 'bill_missing_statement' as UserNotificationItem['category'],
      title: '未收到账单：招商银行 经典白（尾号 8888）',
      body: '2026-10 期账单已过账单日 5 天仍未入账',
      target_url: '/bills?action=supplement&cardId=c-1&billMonth=2026-10',
      metadata_json: JSON.stringify({
        kind: 'bill_missing_statement',
        missing_statements: [
          {
            card_id: 'c-1',
            subject: '招商银行 经典白（尾号 8888）',
            bill_month: '2026-10',
            expected_statement_date: '2026-11-10',
            days_past: 5,
            is_merged: false,
          },
        ],
      }),
      sent_at: '2026-11-15T01:00:00.000Z',
      status: 'sent',
      error: null,
      read_at: null,
      deleted_at: null,
      push_sent_at: null,
    }
    mockGetNotifications.mockResolvedValueOnce({
      items: [missingNotif],
      unread_count: 1,
      total_count: 1,
    })

    render(<NotificationCenterView />)
    await waitFor(() => {
      expect(screen.getByText('未收账单')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByRole('button', { name: /未收到账单：招商银行/ })[0])
    await waitFor(() => {
      expect(screen.getByText('超期未获得账单明细')).toBeInTheDocument()
      expect(screen.getByText(/缺失账期 2026-10 · 应出账日 2026-11-10/)).toBeInTheDocument()
    })
  })
})
