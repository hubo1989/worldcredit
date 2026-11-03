// PayableForm 历史非规范币种与封闭币种枚举交互测试：
// 1. 存量可安全归一值（' usd ' / '人民币'）打开编辑即归一到封闭枚举并正常提交；
// 2. 存量未知币种（'EUR'）必须显式展示 EUR（绝不静默显示/提交成 CNY），且提示若调整币种须选 CNY/USD/HKD；
// 3. 存量 EUR 仅修改名称/备注等其他字段时允许保存，不传 currency 字段以保留历史 EUR，不改金额语义；
// 4. 新增应付仅展示 CNY / USD / HKD 三个封闭选项。
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { PayableForm } from '@/components/mobile/PayableForm'
import type { PayableWithStatus } from '@/lib/api/payables'

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'u1@example.com', role: 'admin' } }),
}))

vi.mock('@/lib/api/holders', () => ({
  getHolders: vi.fn().mockResolvedValue([
    { id: 'holder-1', name: '本人' },
    { id: 'holder-2', name: '家人' },
  ]),
}))

vi.mock('@/lib/api/payables', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/payables')>('@/lib/api/payables')
  return {
    ...actual,
    createRecurringPayable: vi.fn(),
    updateRecurringPayable: vi.fn(),
  }
})

import { createRecurringPayable, updateRecurringPayable } from '@/lib/api/payables'

const mockedCreate = vi.mocked(createRecurringPayable)
const mockedUpdate = vi.mocked(updateRecurringPayable)

function makePayable(overrides: Partial<PayableWithStatus> = {}): PayableWithStatus {
  return {
    id: 'payable-1',
    created_by: 'user-1',
    name: '德国服务器',
    category: 'utility',
    amount: 88.5,
    currency: 'EUR',
    due_day: 12,
    holder_id: null,
    note: '按月续费',
    bank_account: null,
    is_active: 1,
    created_at: '2026-01-01T00:00:00Z',
    period: '2026-10',
    due_date: '2026-10-12',
    days_until_due: 2,
    paid_amount: 0,
    status: 'unpaid',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PayableForm currency compatibility', () => {
  it('displays legacy unknown EUR explicitly without silently converting to CNY, and omits currency when saving other fields', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    mockedUpdate.mockResolvedValueOnce(makePayable({ name: '德国服务器（新）' }))

    render(
      <PayableForm
        open
        existing={makePayable({ currency: 'EUR' })}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    )

    const currencySelect = screen.getByLabelText('币种')
    expect(currencySelect).toHaveValue('__legacy__')
    expect(screen.getByRole('option', { name: /EUR/ })).toBeInTheDocument()
    expect(screen.getByText(/CNY.*USD.*HKD/)).toBeInTheDocument()

    const nameInput = screen.getByLabelText('名称')
    await user.clear(nameInput)
    await user.type(nameInput, '德国服务器（新）')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    const [updatedId, patch] = mockedUpdate.mock.calls[0]
    expect(updatedId).toBe('payable-1')
    expect(patch.name).toBe('德国服务器（新）')
    expect(patch.amount).toBe(88.5)
    expect('currency' in patch).toBe(false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('sends canonical currency when user explicitly migrates legacy EUR to USD', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValueOnce(makePayable({ currency: 'USD' }))

    render(
      <PayableForm
        open
        existing={makePayable({ currency: 'EUR' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    await user.selectOptions(screen.getByLabelText('币种'), 'USD')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate.mock.calls[0][1]).toMatchObject({
      currency: 'USD',
      amount: 88.5,
    })
  })

  it('normalizes known legacy alias (人民币 / lowercase usd) on populate and submits canonical ISO code', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValueOnce(makePayable({ currency: 'CNY' }))

    render(
      <PayableForm
        open
        existing={makePayable({ currency: ' 人民币 ' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    const currencySelect = screen.getByLabelText('币种')
    expect(currencySelect).toHaveValue('CNY')

    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate.mock.calls[0][1].currency).toBe('CNY')
  })

  it('offers only CNY / USD / HKD when creating a new payable', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValueOnce(makePayable({ currency: 'HKD' }))

    render(<PayableForm open existing={null} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const currencySelect = screen.getByLabelText('币种')
    expect(Array.from(currencySelect.querySelectorAll('option')).map(opt => opt.getAttribute('value'))).toEqual(['CNY', 'USD', 'HKD'])

    await user.type(screen.getByLabelText('名称'), '香港宽频')
    await user.type(screen.getByLabelText('每月金额'), '298')
    await user.selectOptions(currencySelect, 'HKD')
    await user.type(screen.getByLabelText('每月应付日'), '18')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate.mock.calls[0][0].currency).toBe('HKD')
  })
})

describe('PayableForm 归属持卡人', () => {
  it('新建时可选归属并随请求提交 holder_id', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValueOnce(makePayable({ id: 'payable-new' }))
    render(<PayableForm open onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText('名称'), '房租')
    await user.type(screen.getByLabelText('每月金额'), '4500')
    await user.type(screen.getByLabelText('每月应付日'), '5')
    await user.selectOptions(await screen.findByLabelText('归属（可选）'), 'holder-2')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ holder_id: 'holder-2' })
  })

  it('未选择归属时提交 null，不伪造持卡人', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValueOnce(makePayable({ id: 'payable-new' }))
    render(<PayableForm open onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText('名称'), '房租')
    await user.type(screen.getByLabelText('每月金额'), '4500')
    await user.type(screen.getByLabelText('每月应付日'), '5')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ holder_id: null })
  })
})
