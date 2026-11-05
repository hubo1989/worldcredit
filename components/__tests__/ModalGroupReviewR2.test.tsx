// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  validateBillingDay,
  validateDueRule,
  validateLimitOnCreate,
  resolveLimitOnEdit,
  parseLast4,
  sanitizeLast4Input,
  resolveBankChange,
  resolveProductSelect,
  resolveNameOverride,
  DEFAULT_HOLDER_AVATAR_COLOR,
  normalizeDueType,
  buildDueRulePayload,
} from '@/components/mobile/card-form-shared'
import { CardForm, resolveCardFormLimit, getCardFormLimitHelperText } from '@/components/mobile/CardForm'
import { CardDefinitionModal } from '@/components/mobile/CardDefinitionModal'
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
import { getCardProducts, updateCard, updateCardHolder } from '@/lib/api/cards'

const mockedCreateHolder = vi.mocked(createHolder)
const mockedGetHolders = vi.mocked(getHolders)
const mockedGetBanks = vi.mocked(getBanks)
const mockedGetCardProducts = vi.mocked(getCardProducts)
const mockedUpdateCard = vi.mocked(updateCard)
const mockedUpdateCardHolder = vi.mocked(updateCardHolder)

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

    // 未识别的规则类型显式返回 invalid (#7 封闭函数)
    expect(validateDueRule(true, 'fixed_before_billing', '15').valid).toBe(false)
    expect(validateDueRule(true, 'unknown_due_rule', '10').valid).toBe(false)
  })

  it('normalizeDueType: 存量规则类型归一化 (#2)', () => {
    expect(normalizeDueType('fixed')).toBe('fixed')
    expect(normalizeDueType('fixed_before_billing')).toBe('fixed')
    expect(normalizeDueType('after_billing')).toBe('after_billing')
    expect(normalizeDueType(null)).toBe('after_billing')
    expect(normalizeDueType(undefined)).toBe('after_billing')
    expect(normalizeDueType('unknown_type')).toBe('after_billing')
  })

  it('buildDueRulePayload: 关闭与开启状态 payload 构建一致性 (#1, #7)', () => {
    // 关闭状态（enabled: false）：两字段皆为 null，确保通知服务端 SET NULL
    expect(buildDueRulePayload(false)).toEqual({
      override_due_type: null,
      override_due_value: null,
    })
    expect(buildDueRulePayload(false, 'fixed', 15)).toEqual({
      override_due_type: null,
      override_due_value: null,
    })
    expect(buildDueRulePayload(false, 'after_billing', '20')).toEqual({
      override_due_type: null,
      override_due_value: null,
    })

    // 开启状态（enabled: true）：正常归一化 type 并格式化数值
    expect(buildDueRulePayload(true, 'after_billing', 20)).toEqual({
      override_due_type: 'after_billing',
      override_due_value: 20,
    })
    expect(buildDueRulePayload(true, 'after_billing', '25')).toEqual({
      override_due_type: 'after_billing',
      override_due_value: 25,
    })
    // 存量 fixed_before_billing 归一为 fixed
    expect(buildDueRulePayload(true, 'fixed_before_billing', '10')).toEqual({
      override_due_type: 'fixed',
      override_due_value: 10,
    })
  })

  it('validateLimitOnCreate: 新建额度校验要求大于0的正数 (#3)', () => {
    expect(validateLimitOnCreate('').valid).toBe(false)
    expect(validateLimitOnCreate('   ').valid).toBe(false)
    expect(validateLimitOnCreate('0').valid).toBe(false)
    expect(validateLimitOnCreate('-10').valid).toBe(false)
    expect(validateLimitOnCreate('abc').valid).toBe(false)
    expect(validateLimitOnCreate('50000')).toEqual({ valid: true, value: 50000 })
    expect(validateLimitOnCreate(30000)).toEqual({ valid: true, value: 30000 })
  })

  it('sanitizeLast4Input: 输入过滤只保留数字且最多4位 (#5)', () => {
    expect(sanitizeLast4Input('1234')).toBe('1234')
    expect(sanitizeLast4Input('12a3b4c')).toBe('1234')
    expect(sanitizeLast4Input('123456')).toBe('1234')
    expect(sanitizeLast4Input('ab_cd')).toBe('')
  })

  it('resolveBankChange & resolveProductSelect & resolveNameOverride: 共享表单逻辑 (#4)', () => {
    const dummyProds: CardProduct[] = [
      { id: 'p1', bank_name: '招商银行', bank_id: 'b1', card_name: '经典白金卡', currency: 'CNY', card_type: 'credit' } as unknown as CardProduct,
      { id: 'p2', bank_name: '招商银行', bank_id: 'b1', card_name: '青年卡', currency: 'CNY', card_type: 'credit' } as unknown as CardProduct,
    ]
    // 未自定义卡名时，切银行自动回填首个产品名
    expect(resolveBankChange(dummyProds, false, '')).toEqual({
      productId: 'p1',
      cardName: '经典白金卡',
    })
    // 已自定义卡名时，保留用户自定卡名
    expect(resolveBankChange(dummyProds, true, '我的专属卡')).toEqual({
      productId: 'p1',
      cardName: '我的专属卡',
    })
    // 无产品时回填兜底名
    expect(resolveBankChange([], false, '')).toEqual({
      productId: '',
      cardName: '标准信用卡',
    })

    // 点选卡产品
    expect(resolveProductSelect(dummyProds[1])).toEqual({
      productId: 'p2',
      cardName: '青年卡',
      hasCustomName: false,
    })

    // 名称覆盖推导：与产品名相同或未自定义时不覆盖
    expect(resolveNameOverride('经典白金卡', dummyProds[0], false)).toBeNull()
    expect(resolveNameOverride('经典白金卡', dummyProds[0], true)).toBeNull()
    expect(resolveNameOverride('我的招行卡', dummyProds[0], true)).toBe('我的招行卡')
    expect(resolveNameOverride('', dummyProds[0], true)).toBeNull()
  })

  it('resolveCardFormLimit & getCardFormLimitHelperText: CardForm 额度推导与 helperText (#1, #2)', () => {
    const mockCard = {
      id: 'c1',
      credit_limit: 50000,
      credit_limit_override: 50000,
    } as CreditCard

    // 编辑场景留空：不传 limit/override (undefined)，保持旧 override 不丢失 (#1)
    expect(resolveCardFormLimit('', true, mockCard)).toEqual({
      valid: true,
      credit_limit: undefined,
      credit_limit_override: undefined,
    })

    // 编辑场景输入 0：显式清空 (0, null)
    expect(resolveCardFormLimit('0', true, mockCard)).toEqual({
      valid: true,
      credit_limit: 0,
      credit_limit_override: null,
    })

    // 编辑场景输入正数：正常覆盖
    expect(resolveCardFormLimit('80000', true, mockCard)).toEqual({
      valid: true,
      credit_limit: 80000,
      credit_limit_override: 80000,
    })

    // 新建信用卡：拒绝 0 和空 (#3)
    expect(resolveCardFormLimit('', true, undefined).valid).toBe(false)
    expect(resolveCardFormLimit('0', true, undefined).valid).toBe(false)
    expect(resolveCardFormLimit('30000', true, undefined)).toEqual({
      valid: true,
      credit_limit: 30000,
      credit_limit_override: 30000,
    })

    // 新建贷款类：允许留空 (0, null)
    expect(resolveCardFormLimit('', false, undefined)).toEqual({
      valid: true,
      credit_limit: 0,
      credit_limit_override: null,
    })

    // helperText 函数化验证 (#2)
    expect(getCardFormLimitHelperText(undefined)).toBeUndefined()
    expect(getCardFormLimitHelperText(mockCard)).toBe('已手动设置（不会被邮件同步覆盖）')
    const unsyncedCard = { id: 'c2', credit_limit: 0, credit_limit_override: null } as CreditCard
    expect(getCardFormLimitHelperText(unsyncedCard)).toBe('邮件未获取到额度，请输入并保存')
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

  it('AccountMergeWizard: 锚点卡判定仅以 account.primary_card_id 为准，未设置时不猜主卡并标注「已在目标账户中」 (#6)', () => {
    // 构造目标账户未设置 primary_card_id 的卡片列表
    const cardsWithoutAnchor: (CreditCard & { card_product?: CardProduct; account?: CreditAccount })[] = [
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
          primary_card_id: undefined, // 未设置 primary_card_id
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
    ]

    render(
      <AccountMergeWizardModal
        open={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        cards={cardsWithoutAnchor}
      />
    )

    // 不应展示「当前账户锚点卡」
    expect(screen.queryByText(/当前账户锚点卡/)).not.toBeInTheDocument()
    // c1 应该展示「已在目标账户中」
    expect(screen.getByText('已在目标账户中')).toBeInTheDocument()
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

  it('CardAccountModal: createHolder 成功但后续 updateCardHolder 失败时，明确提示可在下拉中重选且不删持卡人 (#5)', async () => {
    mockedCreateHolder.mockResolvedValueOnce({
      id: 'h-new',
      name: '王五',
      created_by: 'u1',
      avatar_color: '#7aadff',
      created_at: '2026-01-01',
    })
    mockedUpdateCardHolder.mockRejectedValueOnce(new Error('网络超时'))

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

    // 切换到新建持卡人模式并输入姓名
    const createToggleBtn = await screen.findByText(/\+\s*新建持卡人/)
    fireEvent.click(createToggleBtn)
    const nameInput = screen.getByPlaceholderText(/输入持卡人姓名/)
    fireEvent.change(nameInput, { target: { value: '王五' } })

    // 保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      // 错误提示明确告知持卡人已创建但卡片更新失败，引导在下拉中重选
      expect(screen.getByText(/已创建持卡人「王五」但卡片更新失败，可在下拉中重选：网络超时/)).toBeInTheDocument()
    })
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

describe('CardForm 组件交互与回归验证 (#1, #2, #5)', () => {
  const dummyProducts: CardProduct[] = [
    {
      id: 'cp-cmb-1',
      bank_id: 'b1',
      bank_name: '招商银行',
      card_name: '经典白金卡',
      currency: 'CNY',
      card_type: 'credit',
    } as unknown as CardProduct,
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetCardProducts.mockResolvedValue(dummyProducts)
  })

  it('CardForm: 编辑卡片时留空额度提交，不提交 credit_limit: 0，保留原有 override 不丢 (#1)', async () => {
    const initialCard: CreditCard = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'cp-cmb-1',
      card_number_last4: '1234',
      credit_limit: 50000,
      credit_limit_override: 50000,
      billing_day: 15,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
    }
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <CardForm
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        holderId="holder-1"
        initial={initialCard}
      />
    )

    // 等待 products 异步加载并回填表单（快捷卡种渲染）
    await screen.findByRole('button', { name: '经典白金卡' })

    // 清空额度输入框
    const limitInput = screen.getByLabelText(/额度/)
    fireEvent.change(limitInput, { target: { value: '' } })

    // 保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })

    // 关键断言：留空时不提交 credit_limit: 0，两个字段均为 undefined
    const submitted = handleSubmit.mock.calls[0][0]
    expect(submitted.credit_limit).toBeUndefined()
    expect(submitted.credit_limit_override).toBeUndefined()
  })

  it('CardForm: 编辑卡片显式输入 0，提交 credit_limit: 0 与 credit_limit_override: null 走清除路径 (#1)', async () => {
    const initialCard: CreditCard = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'cp-cmb-1',
      card_number_last4: '1234',
      credit_limit: 50000,
      credit_limit_override: 50000,
      billing_day: 15,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
    }
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <CardForm
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        holderId="holder-1"
        initial={initialCard}
      />
    )

    // 等待 products 异步加载并回填表单（快捷卡种渲染）
    await screen.findByRole('button', { name: '经典白金卡' })

    // 输入 0
    const limitInput = screen.getByLabelText(/额度/)
    fireEvent.change(limitInput, { target: { value: '0' } })

    // 保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })

    const submitted = handleSubmit.mock.calls[0][0]
    expect(submitted.credit_limit).toBe(0)
    expect(submitted.credit_limit_override).toBeNull()
  })

  it('CardForm: 关闭自定义还款规则后保存，override_due_type 与 override_due_value 皆提交 null (#1, #7)', async () => {
    const initialCard: CreditCard = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'cp-cmb-1',
      card_number_last4: '1234',
      credit_limit: 50000,
      billing_day: 15,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
      override_due_type: 'after_billing',
      override_due_value: 20,
    }
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <CardForm
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        holderId="holder-1"
        initial={initialCard}
      />
    )

    await screen.findByRole('button', { name: '经典白金卡' })

    // 找到还款规则 Toggle 并点击关闭
    const toggle = screen.getByRole('switch', { name: '覆盖卡产品默认还款规则' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()

    // 保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })

    const submitted = handleSubmit.mock.calls[0][0]
    expect(submitted.override_due_type).toBeNull()
    expect(submitted.override_due_value).toBeNull()
  })

  it('CardForm: 存量卡片仅残留 override_due_value 但 override_due_type 为 null 时，初始化为关闭态，重开不复活 (#1, #7)', async () => {
    const initialCard: CreditCard = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'cp-cmb-1',
      card_number_last4: '1234',
      credit_limit: 50000,
      billing_day: 15,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
      override_due_type: null,
      override_due_value: 20, // DB 残留
    }

    render(
      <CardForm
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        holderId="holder-1"
        initial={initialCard}
      />
    )

    await screen.findByRole('button', { name: '经典白金卡' })

    // 开关必须处于未开启状态，不会因为残留 value 复活
    const toggle = screen.getByRole('switch', { name: '覆盖卡产品默认还款规则' })
    expect(toggle).not.toBeChecked()
  })

  it('CardForm: 存量 fixed_before_billing 读取不崩溃，归一到 fixed 并可重新保存成功 (#2, #7)', async () => {
    const initialCard: CreditCard = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'cp-cmb-1',
      card_number_last4: '1234',
      credit_limit: 50000,
      billing_day: 15,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
      override_due_type: 'fixed_before_billing' as unknown as CreditCard['override_due_type'],
      override_due_value: 15,
    }
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <CardForm
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
        holderId="holder-1"
        initial={initialCard}
      />
    )

    await screen.findByRole('button', { name: '经典白金卡' })

    // 规则类型选项中只有 2 项合法选项，不包含 fixed_before_billing
    const select = screen.getByLabelText('还款规则') as unknown as HTMLSelectElement
    expect(select.value).toBe('fixed')

    // 保存能够成功，且提交类型为合法的 fixed
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })

    const submitted = handleSubmit.mock.calls[0][0]
    expect(submitted.override_due_type).toBe('fixed')
    expect(submitted.override_due_value).toBe(15)
  })
})

describe('CardDefinitionModal 规则关闭与重开回归验证 (#1, #7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetBanks.mockResolvedValue([
      { id: 'b1', name: '招商银行', country: 'CN' } as unknown as BankItem,
    ])
    mockedGetCardProducts.mockResolvedValue([
      {
        id: 'cp-cmb-1',
        bank_id: 'b1',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        currency: 'CNY',
        card_type: 'credit',
      } as unknown as CardProduct,
    ])
  })

  it('CardDefinitionModal: 关闭自定义还款规则后保存，override_due_type 与 override_due_value 皆提交 null (#1)', async () => {
    const card: CreditCardWithProduct = {
      id: 'c1',
      holder_id: 'h1',
      card_product_id: 'cp-cmb-1',
      credit_limit: 50000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      override_due_type: 'after_billing',
      override_due_value: 20,
      card_product: {
        id: 'cp-cmb-1',
        bank_id: 'b1',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        currency: 'CNY',
        country: 'CN',
      } as unknown as CardProduct,
    }

    render(
      <CardDefinitionModal
        open={true}
        onClose={vi.fn()}
        card={card}
        onSaved={vi.fn()}
      />
    )

    await screen.findByDisplayValue('经典白金卡')

    // 关闭开关
    const toggle = screen.getByRole('switch', { name: '自定义还款规则' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()

    // 保存
    const saveBtn = screen.getByRole('button', { name: '保存' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockedUpdateCard).toHaveBeenCalledTimes(1)
    })

    const patch = mockedUpdateCard.mock.calls[0][1]
    expect(patch.override_due_type).toBeNull()
    expect(patch.override_due_value).toBeNull()
  })

  it('CardDefinitionModal: 存量卡片仅残留 override_due_value 但 override_due_type 为 null 时，重开不复活 (#1)', async () => {
    const card: CreditCardWithProduct = {
      id: 'c1',
      holder_id: 'h1',
      card_product_id: 'cp-cmb-1',
      credit_limit: 50000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01',
      override_due_type: null,
      override_due_value: 20, // DB 残留
      card_product: {
        id: 'cp-cmb-1',
        bank_id: 'b1',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        currency: 'CNY',
        country: 'CN',
      } as unknown as CardProduct,
    }

    render(
      <CardDefinitionModal
        open={true}
        onClose={vi.fn()}
        card={card}
        onSaved={vi.fn()}
      />
    )

    await screen.findByDisplayValue('经典白金卡')

    // 开关不会因为残留 value 亮起
    const toggle = screen.getByRole('switch', { name: '自定义还款规则' })
    expect(toggle).not.toBeChecked()
  })
})
