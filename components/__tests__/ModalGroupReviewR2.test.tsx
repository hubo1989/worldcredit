// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  validateBillingDay,
  validateDueRule,
  resolveLimitOnEdit,
  parseLast4,
  DEFAULT_HOLDER_AVATAR_COLOR,
} from '@/components/mobile/card-form-shared'
import { AccountMergeWizardModal } from '@/components/mobile/AccountMergeWizardModal'
import { CardAccountModal } from '@/components/mobile/CardAccountModal'
import { CardCreateModal } from '@/components/mobile/CardCreateModal'
import type { CreditCard, CardProduct, CreditAccount } from '@/lib/types'
import type { CreditCardWithProduct } from '@/lib/api/cards'

// Mocks
vi.mock('@/lib/api/holders', () => ({
  getHolders: vi.fn(),
  createHolder: vi.fn(),
}))

vi.mock('@/lib/api/cards', () => ({
  getCardProducts: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  updateCardHolder: vi.fn(),
}))

vi.mock('@/lib/api/banks', () => ({
  getBanks: vi.fn(),
}))

vi.mock('@/lib/api/accounts', () => ({
  mergeCardsIntoAccount: vi.fn(),
}))

import { createHolder, getHolders } from '@/lib/api/holders'
import { getBanks, type BankItem } from '@/lib/api/banks'
import { getCardProducts } from '@/lib/api/cards'

const mockedCreateHolder = vi.mocked(createHolder)
const mockedGetHolders = vi.mocked(getHolders)
const mockedGetBanks = vi.mocked(getBanks)
const mockedGetCardProducts = vi.mocked(getCardProducts)

describe('card-form-shared 纯函数逻辑验证 (Medium 5, 7, 8, 11, 12)', () => {
  it('DEFAULT_HOLDER_AVATAR_COLOR 为 ObsidianUI 令牌色 #7aadff (Finding 12)', () => {
    expect(DEFAULT_HOLDER_AVATAR_COLOR).toBe('#7aadff')
  })

  it('validateBillingDay: 账单日校验', () => {
    expect(validateBillingDay('1')).toEqual({ valid: true, value: 1 })
    expect(validateBillingDay('31')).toEqual({ valid: true, value: 31 })
    expect(validateBillingDay('0').valid).toBe(false)
    expect(validateBillingDay('32').valid).toBe(false)
    expect(validateBillingDay('').valid).toBe(false)
    expect(validateBillingDay('abc').valid).toBe(false)
  })

  it('validateDueRule: 还款规则校验 (Medium 7)', () => {
    // 禁用时不校验
    expect(validateDueRule(false, 'after_billing', '')).toEqual({ valid: true, value: undefined })

    // 启用后必填
    expect(validateDueRule(true, 'after_billing', '').valid).toBe(false)

    // after_billing >= 0
    expect(validateDueRule(true, 'after_billing', '0')).toEqual({ valid: true, value: 0 })
    expect(validateDueRule(true, 'after_billing', '20')).toEqual({ valid: true, value: 20 })
    expect(validateDueRule(true, 'after_billing', '-1').valid).toBe(false)

    // fixed 1-31
    expect(validateDueRule(true, 'fixed', '1')).toEqual({ valid: true, value: 1 })
    expect(validateDueRule(true, 'fixed', '31')).toEqual({ valid: true, value: 31 })
    expect(validateDueRule(true, 'fixed', '0').valid).toBe(false)
    expect(validateDueRule(true, 'fixed', '32').valid).toBe(false)
  })

  it('resolveLimitOnEdit: 额度留空与清空语义 (Medium 8, 11)', () => {
    // 留空：保持原有值不动 (返回 undefined)
    expect(resolveLimitOnEdit('')).toEqual({
      valid: true,
      credit_limit: undefined,
      credit_limit_override: undefined,
    })
    expect(resolveLimitOnEdit('   ')).toEqual({
      valid: true,
      credit_limit: undefined,
      credit_limit_override: undefined,
    })

    // 输入 0：显式清空 override (credit_limit: 0, credit_limit_override: null)
    expect(resolveLimitOnEdit('0')).toEqual({
      valid: true,
      credit_limit: 0,
      credit_limit_override: null,
    })

    // 输入正数：覆盖
    expect(resolveLimitOnEdit('50000')).toEqual({
      valid: true,
      credit_limit: 50000,
      credit_limit_override: 50000,
    })

    // 非法负数
    expect(resolveLimitOnEdit('-10').valid).toBe(false)
  })

  it('parseLast4: 尾号解析', () => {
    expect(parseLast4('')).toEqual({ valid: true, value: '' })
    expect(parseLast4('1234')).toEqual({ valid: true, value: '1234' })
    expect(parseLast4('12345').valid).toBe(false)
    expect(parseLast4('abcd').valid).toBe(false)
  })
})

describe('AccountMergeWizardModal 组件交互验证 (High 1, Medium 4)', () => {
  const sampleCards: (CreditCard & { card_product?: CardProduct; account?: CreditAccount })[] = [
    {
      id: 'c1',
      holder_id: 'h1',
      account_id: 'acc-cmb',
      card_product_id: 'cp_cmb_1',
      card_number_last4: '1111',
      credit_limit: 50000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      card_product: {
        id: 'cp_cmb_1',
        bank_name: '招商银行',
        card_name: '招行卡1',
        country: 'CN',
        currency: 'CNY',
      } as unknown as CardProduct,
      account: {
        id: 'acc-cmb',
        holder_id: 'h1',
        bank_name: '招商银行',
        currency: 'CNY',
        statement_mode: 'merged',
        quota_mode: 'shared',
        status: 'active',
        primary_card_id: 'c1',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    },
    {
      id: 'c2',
      holder_id: 'h1',
      account_id: 'acc-other',
      card_product_id: 'cp_cmb_2',
      card_number_last4: '2222',
      credit_limit: 30000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      card_product: {
        id: 'cp_cmb_2',
        bank_name: '招商银行',
        card_name: '招行卡2',
        country: 'CN',
        currency: 'CNY',
      } as unknown as CardProduct,
    },
    {
      id: 'c3',
      holder_id: 'h1',
      account_id: 'acc-icbc',
      card_product_id: 'cp_icbc_1',
      card_number_last4: '3333',
      credit_limit: 20000,
      billing_day: 10,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      card_product: {
        id: 'cp_icbc_1',
        bank_name: '工商银行',
        card_name: '工行卡1',
        country: 'CN',
        currency: 'CNY',
      } as unknown as CardProduct,
    },
    {
      id: 'c4',
      holder_id: 'h1',
      account_id: 'acc-icbc',
      card_product_id: 'cp_icbc_2',
      card_number_last4: '4444',
      credit_limit: 20000,
      billing_day: 10,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      card_product: {
        id: 'cp_icbc_2',
        bank_name: '工商银行',
        card_name: '工行卡2',
        country: 'CN',
        currency: 'CNY',
      } as unknown as CardProduct,
    },
  ]

  it('High 1: 切换银行清空勾选', async () => {
    const { container } = render(
      <AccountMergeWizardModal
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        cards={sampleCards}
      />
    )

    // 默认展示招行，获取所有可勾选的 checkbox
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    // 第 1 个是 c1（锚点卡，disabled），第 2 个是 c2（可勾选）
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(true)
    const c2Checkbox = checkboxes[1] as HTMLInputElement
    expect(c2Checkbox.checked).toBe(false)

    fireEvent.click(c2Checkbox)
    expect(c2Checkbox.checked).toBe(true)

    // 切换到工商银行
    const selects = container.querySelectorAll('select')
    const bankSelect = selects[0]
    fireEvent.change(bankSelect, { target: { value: '工商银行' } })

    // 再次切回招商银行，c2 的勾选已被清空
    fireEvent.change(bankSelect, { target: { value: '招商银行' } })
    const checkboxesAfter = container.querySelectorAll('input[type="checkbox"]')
    const c2CheckboxAfter = checkboxesAfter[1] as HTMLInputElement
    expect(c2CheckboxAfter.checked).toBe(false)
  })

  it('Medium 4: 属于目标账户的卡片（锚点卡）处于 disabled 且不可勾选', () => {
    const { container } = render(
      <AccountMergeWizardModal
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        cards={sampleCards}
      />
    )

    // c1 归属于目标账户 acc-cmb，其 checkbox 必须 disabled
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    const c1Checkbox = checkboxes[0] as HTMLInputElement
    expect(c1Checkbox.disabled).toBe(true)
    expect(c1Checkbox.checked).toBe(false)

    fireEvent.click(c1Checkbox)
    expect(c1Checkbox.checked).toBe(false)
  })
})

describe('Modal 提交前校验失败不建持卡人 (Medium 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetHolders.mockResolvedValue([])
    mockedGetBanks.mockResolvedValue([
      { id: 'b_cmb', name: '招商银行', country: 'CN' } as unknown as BankItem,
    ])
    mockedGetCardProducts.mockResolvedValue([])
  })

  it('CardAccountModal: 账单日校验失败时绝不调用 createHolder', async () => {
    const card: CreditCardWithProduct = {
      id: 'c1',
      holder_id: 'h1',
      card_product_id: 'cp1',
      credit_limit: 50000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      card_product: {
        id: 'cp1',
        bank_name: '招商银行',
        card_name: '白金卡',
        currency: 'CNY',
        country: 'CN',
      } as unknown as CardProduct,
    }

    render(
      <CardAccountModal
        open={true}
        onClose={vi.fn()}
        card={card}
        onSaved={vi.fn()}
      />
    )

    // 切换到新建持卡人模式
    const createToggleBtn = await screen.findByText(/\+\s*新建持卡人/)
    fireEvent.click(createToggleBtn)

    // 输入新建姓名
    const nameInput = screen.getByPlaceholderText(/输入持卡人姓名/)
    fireEvent.change(nameInput, { target: { value: '张三' } })

    // 输入非法账单日 99
    const dayInput = screen.getByPlaceholderText('1-31')
    fireEvent.change(dayInput, { target: { value: '99' } })

    // 点击保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveBtn)

    // 出现错误提示
    await waitFor(() => {
      expect(screen.getByText('每月账单日必须在 1 到 31 之间')).toBeInTheDocument()
    })

    // createHolder 绝对不能被调用
    expect(mockedCreateHolder).not.toHaveBeenCalled()
  })

  it('CardCreateModal: 额度校验失败时绝不调用 createHolder', async () => {
    render(
      <CardCreateModal
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    // 等待银行加载完成
    await waitFor(() => {
      expect(mockedGetBanks).toHaveBeenCalled()
    })

    // 当 holders 为空时默认直接进入新建态
    const nameInput = await screen.findByPlaceholderText(/输入持卡人姓名/)
    fireEvent.change(nameInput, { target: { value: '李四' } })

    // 卡名
    const nameField = screen.getByPlaceholderText('输入卡片名称，或点选下方常用卡种')
    fireEvent.change(nameField, { target: { value: '我的卡' } })

    // 额度输入负数
    const limitInput = screen.getByPlaceholderText('50000')
    fireEvent.change(limitInput, { target: { value: '-100' } })

    // 账单日
    const dayInput = screen.getByPlaceholderText('1-31')
    fireEvent.change(dayInput, { target: { value: '10' } })

    // 点击创建
    const submitBtn = screen.getByRole('button', { name: '创建卡片' })
    fireEvent.click(submitBtn)

    // 出现错误
    await waitFor(() => {
      expect(screen.getByText('请输入有效的信用额度')).toBeInTheDocument()
    })

    // createHolder 绝对不能被调用
    expect(mockedCreateHolder).not.toHaveBeenCalled()
  })
})
