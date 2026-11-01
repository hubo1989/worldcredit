// 账单编辑组件测试（spec 13 §6）：
// 1. 共享纯函数：校验 / 金额低于已还警告 / 还款预览口径
// 2. BillEditForm：合法保存走 updateBillFields；金额低于已还出警告；校验拦截不发起请求；
//    撤销钉住走 clearOverride；admin 可见删除入口且走 deleteBill
// 3. BillPaymentsManage：编辑单笔走 updatePayment；删除走 deletePayment；预览状态重算
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { BillEditForm } from '@/components/mobile/BillEditForm'
import { BillPaymentsManage } from '@/components/mobile/BillPaymentsManage'
import {
  validateEditableFields,
  amountBelowPaidWarning,
  previewAfterPayments,
} from '@/components/mobile/bill-editing-shared'
import type { Bill, Payment } from '@/lib/types'

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    card_id: 'card-1',
    bill_month: '2026-10',
    statement_start: '2026-09-27',
    statement_end: '2026-10-26',
    statement_date: '2026-10-26',
    bill_amount: 4800,
    min_payment: 480,
    due_date: '2026-11-24',
    status: 'partial',
    created_at: '2026-10-27T00:00:00Z',
    ...overrides,
  }
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    bill_id: 'bill-1',
    amount: 1600,
    paid_at: '2026-10-30',
    channel: '手动还款',
    note: undefined,
    idempotency_key: 'key-1',
    created_at: '2026-10-30T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateEditableFields', () => {
  const base = {
    amount: '4800',
    min_payment: '480',
    statement_date: '2026-10-26',
    due_date: '2026-11-24',
    statement_start: '2026-09-27',
    statement_end: '2026-10-26',
  }

  it('通过合法值', () => {
    expect(validateEditableFields(base)).toEqual({})
  })

  it('拒绝空/负数/非数字金额', () => {
    expect(validateEditableFields({ ...base, amount: '' }).amount).toBeTruthy()
    expect(validateEditableFields({ ...base, amount: '-1' }).amount).toBeTruthy()
    expect(validateEditableFields({ ...base, amount: 'abc' }).amount).toBeTruthy()
  })

  it('最低还款额可留空但不可为非法数字', () => {
    expect(validateEditableFields({ ...base, min_payment: '' }).min_payment).toBeUndefined()
    expect(validateEditableFields({ ...base, min_payment: '-5' }).min_payment).toBeTruthy()
  })

  it('拒绝不存在的日历日期', () => {
    expect(validateEditableFields({ ...base, due_date: '2026-02-30' }).due_date).toBeTruthy()
    expect(validateEditableFields({ ...base, statement_start: '2026-11-31' }).statement_start).toBeTruthy()
  })

  it('日期可留空', () => {
    expect(
      validateEditableFields({ ...base, statement_date: '', statement_start: '', statement_end: '' }),
    ).toEqual({})
  })
})

describe('amountBelowPaidWarning', () => {
  it('新金额低于已还时警告', () => {
    expect(amountBelowPaidWarning(1200, 1600)).toBe(true)
  })
  it('新金额不低于已还时不警告；无还款也不警告', () => {
    expect(amountBelowPaidWarning(1600, 1600)).toBe(false)
    expect(amountBelowPaidWarning(1200, 0)).toBe(false)
  })
})

describe('previewAfterPayments', () => {
  const payments = [
    { id: 'p1', amount: 1000 },
    { id: 'p2', amount: 600 },
  ]

  it('累计/剩余按生效金额计算', () => {
    const r = previewAfterPayments(4800, payments, null, 0)
    expect(r.totalPaid).toBe(1600)
    expect(r.remaining).toBe(3200)
    expect(r.status).toBe('partial')
  })

  it('编辑中的那笔用编辑后的金额参与预览', () => {
    const r = previewAfterPayments(4800, payments, 'p2', 2000)
    expect(r.totalPaid).toBe(3000)
    expect(r.remaining).toBe(1800)
    expect(r.status).toBe('partial')
  })

  it('已还 ≥ 生效金额 − 0.01 即 paid（允许回退口径）', () => {
    expect(previewAfterPayments(1600, payments, null, 0).status).toBe('paid')
    expect(previewAfterPayments(1600.005, payments, null, 0).status).toBe('paid')
  })

  it('删光还款后回退 unpaid', () => {
    expect(previewAfterPayments(4800, [], null, 0).status).toBe('unpaid')
  })
})

describe('BillEditForm', () => {
  const defaultProps = {
    open: true,
    bill: makeBill(),
    identityLabel: '招商银行 招行信用卡 · 尾号 1234 · 2026-10 期',
    totalPaid: 1600,
    currency: '¥',
    canDelete: true,
    onClose: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onDeleted: vi.fn().mockResolvedValue(undefined),
  }

  it('合法保存：调 updateBillFields 且只带有效字段', async () => {
    const user = userEvent.setup()
    const submitFields = vi.fn().mockResolvedValue(makeBill())
    render(<BillEditForm {...defaultProps} onSubmitFields={submitFields} />)

    const amount = screen.getByLabelText(/账单金额/)
    await user.clear(amount)
    await user.type(amount, '5200')

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(submitFields).toHaveBeenCalledTimes(1)
    })
    expect(submitFields).toHaveBeenCalledWith('bill-1', {
      amount: 5200,
      min_payment: 480,
      statement_date: '2026-10-26',
      due_date: '2026-11-24',
      statement_start: '2026-09-27',
      statement_end: '2026-10-26',
    })
  })

  it('金额低于已还总额时显示触发器边界警告，但允许继续保存', async () => {
    const user = userEvent.setup()
    const submitFields = vi.fn().mockResolvedValue(makeBill())
    render(<BillEditForm {...defaultProps} onSubmitFields={submitFields} />)

    const amount = screen.getByLabelText(/账单金额/)
    await user.clear(amount)
    await user.type(amount, '1200')

    expect(screen.getByText(/新金额低于已还总额/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(submitFields).toHaveBeenCalledTimes(1)
    })
  })

  it('非法金额被前端校验拦截，不发起保存请求', async () => {
    const user = userEvent.setup()
    const submitFields = vi.fn().mockResolvedValue(makeBill())
    render(<BillEditForm {...defaultProps} onSubmitFields={submitFields} />)

    const amount = screen.getByLabelText(/账单金额/)
    await user.clear(amount)

    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(submitFields).not.toHaveBeenCalled()
    expect(screen.getByText('请填写账单金额')).toBeInTheDocument()
  })

  it('撤销金额钉住：调 clearOverride(billId, ["amount"])', async () => {
    const user = userEvent.setup()
    const clearField = vi.fn().mockResolvedValue(makeBill())
    render(
      <BillEditForm
        {...defaultProps}
        bill={makeBill({ bill_amount_override: 4720 })}
        onClearOverrideField={clearField}
      />,
    )

    await user.click(screen.getByRole('button', { name: '撤销账单金额的手动设定' }))

    await waitFor(() => {
      expect(clearField).toHaveBeenCalledWith('bill-1', ['amount'])
    })
  })

  it('admin 可见删除入口并确认删除', async () => {
    const user = userEvent.setup()
    const doDelete = vi.fn().mockResolvedValue(undefined)
    render(<BillEditForm {...defaultProps} onDeleteBill={doDelete} />)

    await user.click(screen.getByRole('button', { name: /删除账单/ }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(doDelete).toHaveBeenCalledWith('bill-1')
    })
    await waitFor(() => {
      expect(defaultProps.onDeleted).toHaveBeenCalled()
    })
  })

  it('member（canDelete=false）看不到删除入口', () => {
    render(<BillEditForm {...defaultProps} canDelete={false} />)
    expect(screen.queryByRole('button', { name: /删除账单/ })).not.toBeInTheDocument()
    expect(screen.getByText('删除账单仅限管理员操作。')).toBeInTheDocument()
  })

  it('身份锁定提示可见（卡与账期不可改）', () => {
    render(<BillEditForm {...defaultProps} />)
    expect(screen.getByText(/卡与账期为账单身份，不可修改/)).toBeInTheDocument()
  })
})

describe('BillPaymentsManage', () => {
  const payments = [makePayment(), makePayment({ id: 'pay-2', amount: 800, paid_at: '2026-11-02' })]
  const baseProps = {
    open: true,
    payments,
    effectiveAmount: 4800,
    currency: '¥',
    onClose: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
  }

  it('汇总应还/已还/剩余', () => {
    render(<BillPaymentsManage {...baseProps} />)
    expect(screen.getByText('¥4,800')).toBeInTheDocument()
    // 已还 1600+800=2400 出现在汇总块；用 getAllByText 容忍金额在多处出现
    expect(screen.getAllByText('¥2,400').length).toBeGreaterThan(0)
  })

  it('编辑单笔金额保存：调 updatePayment(paymentId, patch) 并刷新', async () => {
    const user = userEvent.setup()
    const doUpdate = vi.fn().mockResolvedValue(undefined)
    render(<BillPaymentsManage {...baseProps} onUpdatePayment={doUpdate} />)

    await user.click(screen.getAllByRole('button', { name: '编辑' })[0])
    const amount = screen.getByLabelText(/还款金额/)
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(doUpdate).toHaveBeenCalledWith('pay-1', {
        amount: 2000,
        paid_at: '2026-10-30',
        note: null,
      })
    })
    await waitFor(() => {
      expect(baseProps.onChanged).toHaveBeenCalled()
    })
  })

  it('编辑态显示保存后状态预览（改小到 2000 → 仍 partial）', async () => {
    const user = userEvent.setup()
    render(<BillPaymentsManage {...baseProps} onUpdatePayment={vi.fn().mockResolvedValue(undefined)} />)

    await user.click(screen.getAllByRole('button', { name: '编辑' })[0])
    const amount = screen.getByLabelText(/还款金额/)
    await user.clear(amount)
    await user.type(amount, '2000')

    expect(screen.getByText('保存后预览')).toBeInTheDocument()
    expect(screen.getByText('部分还款')).toBeInTheDocument()
  })

  it('删除单笔：确认后调 deletePayment(paymentId)', async () => {
    const user = userEvent.setup()
    const doDelete = vi.fn().mockResolvedValue(undefined)
    render(<BillPaymentsManage {...baseProps} onDeletePaymentFn={doDelete} />)

    await user.click(screen.getAllByRole('button', { name: '删除该笔还款' })[0])
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(doDelete).toHaveBeenCalledWith('pay-1')
    })
  })

  it('非法金额（0/负数）被拦截，不发起请求', async () => {
    const user = userEvent.setup()
    const doUpdate = vi.fn().mockResolvedValue(undefined)
    render(<BillPaymentsManage {...baseProps} onUpdatePayment={doUpdate} />)

    await user.click(screen.getAllByRole('button', { name: '编辑' })[0])
    const amount = screen.getByLabelText(/还款金额/)
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(doUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('还款金额必须是大于 0 的数字')).toBeInTheDocument()
  })
})
