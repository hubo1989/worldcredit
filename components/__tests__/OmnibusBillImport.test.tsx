// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BillImportDialog, type CardOption } from '../mobile/BillImportDialog'
import { BillDraftsPanel } from '../mobile/BillDraftsPanel'
import { StatementPasswordVaultPanel } from '../mobile/StatementPasswordVaultPanel'
import { GmailConnectPanel } from '../mobile/GmailConnectPanel'
import { HolderForm } from '../mobile/HolderForm'
import { AiFillBox } from '../mobile/AiFillBox'
import {
  extractDuplicateBillDetails,
  formatAttributionLabel,
  getDraftCurrencySymbol,
  isDraftCompleteForConfirm,
} from '../mobile/omnibusApi'

const mockCallRpc = vi.fn()
const mockAiComplete = vi.fn()

vi.mock('@/lib/api/rpc-client', () => {
  class RpcError extends Error {
    readonly code?: string
    readonly details?: unknown
    readonly request_id?: string
    constructor(message: string, code?: string, details?: unknown, requestId?: string) {
      super(message)
      this.name = 'RpcError'
      this.code = code
      this.details = details
      this.request_id = requestId
    }
  }
  return {
    RpcError,
    callRpc: (...args: unknown[]) => mockCallRpc(...args),
  }
})

vi.mock('@/lib/api/ai', () => ({
  aiComplete: (...args: unknown[]) => mockAiComplete(...args),
}))

vi.mock('@/lib/api/cards', () => ({
  getCards: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/api/holders', () => ({
  getHolders: vi.fn().mockResolvedValue([
    { id: 'h-1', name: '张三', avatar_color: '#6366f1', aliases: ['SAN ZHANG'], created_by: 'u-1', created_at: '' },
    { id: 'h-2', name: '李四', avatar_color: '#10b981', aliases: [], created_by: 'u-1', created_at: '' },
  ]),
}))

vi.mock('@/lib/api/banks', () => ({
  getBanks: vi.fn().mockResolvedValue([{ id: 'b-1', name: '招商银行', short_name: '招行' }]),
}))

vi.mock('@/lib/api/gmail', () => ({
  getGmailStatus: vi.fn().mockResolvedValue({ connected: true, email: 'main@gmail.com' }),
  syncGmail: vi.fn(),
  disconnectGmail: vi.fn(),
}))

vi.mock('@/lib/api/billDrafts', () => ({
  getBillImportDrafts: vi.fn(),
  updateBillImportDraft: vi.fn(),
  confirmBillImportDraft: vi.fn(),
  discardBillImportDraft: vi.fn(),
}))

const sampleCards: CardOption[] = [
  {
    id: 'card-hk',
    label: '汇丰 HKD · 8848',
    card: {
      id: 'card-hk',
      holder_id: 'h-1',
      card_product_id: 'prod-1',
      account_id: null,
      card_number_last4: '8848',
      credit_limit: 50000,
      billing_day: 15,
      card_type: 'credit',
      status: 'active',
      created_at: '',
      card_product: { bank_name: 'HSBC HK', currency: 'HKD' },
    },
  },
  {
    id: 'card-us',
    label: 'Chase USD · 4242',
    card: {
      id: 'card-us',
      holder_id: 'h-1',
      card_product_id: 'prod-2',
      account_id: null,
      card_number_last4: '4242',
      credit_limit: 50000,
      billing_day: 10,
      card_type: 'credit',
      status: 'active',
      created_at: '',
      card_product: { bank_name: 'Chase', currency: 'USD' },
    },
  },
]

describe('HUB-157 Web omnibus UI & utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('omnibusApi 工具函数正确格式化货币符号、冲突详情与归属来源', () => {
    expect(getDraftCurrencySymbol('HKD')).toBe('HK$')
    expect(getDraftCurrencySymbol('USD')).toBe('US$')
    expect(getDraftCurrencySymbol('CNY')).toBe('¥')

    expect(formatAttributionLabel('connection_default')).toBe('邮箱默认归属')

    expect(
      isDraftCompleteForConfirm({
        card_id: 'c-1',
        parse_status: 'ready',
        parsed_payload: { bill_amount: 1200, bill_month: '2026-10', due_date: '2026-11-05' },
      })
    ).toBe(true)

    expect(
      isDraftCompleteForConfirm({
        card_id: 'c-1',
        parse_status: 'needs_password',
        parsed_payload: { bill_amount: 1200, bill_month: '2026-10', due_date: '2026-11-05' },
      })
    ).toBe(false)

    const conflict = extractDuplicateBillDetails({
      details: {
        reason: 'DUPLICATE_BILL',
        existing_bill: {
          id: 'b-1',
          bill_month: '2026-10',
          bill_amount: 1000,
          paid_amount: 0,
          status: 'unpaid',
          has_override: false,
        },
        draft_bill: { bill_amount: 1200, due_date: '2026-11-05', currency: 'USD' },
      },
    })
    expect(conflict?.existing_bill.id).toBe('b-1')
    expect(conflict?.draft_bill.currency).toBe('USD')
  })

  it('BillImportDialog 无即将推出阻断，随所选卡片动态切换币种并完成文本三步导入', async () => {
    mockCallRpc.mockImplementation((mod: string, fn: string) => {
      if (mod === 'billDrafts' && fn === 'importAndParseBill') {
        return Promise.resolve({
          outcome: 'draft_created',
          drafts: [
            {
              id: 'draft-new-1',
              created_by: 'u-1',
              card_id: 'card-hk',
              holder_id: 'h-1',
              source_type: 'text',
              parsed_payload: {
                bank_name: 'HSBC HK',
                card_last4: '8848',
                currency: 'HKD',
                bill_month: '2026-10',
                bill_amount: 3450.25,
                due_date: '2026-11-05',
              },
              status: 'draft',
              parse_status: 'ready',
              created_at: '2026-10-20T00:00:00Z',
            },
          ],
        })
      }
      if (mod === 'billDrafts' && fn === 'confirmBillImportDraft') {
        return Promise.resolve({ id: 'bill-final-1' })
      }
      return Promise.resolve(null)
    })

    const onSuccess = vi.fn()
    render(
      <BillImportDialog
        open={true}
        onClose={() => {}}
        onImportSuccess={onSuccess}
        cards={sampleCards}
        userId='u-1'
      />
    )

    expect(screen.queryByText(/即将推出/)).toBeNull()
    expect(screen.getByText('上传截图')).toBeTruthy()
    expect(screen.getByText('上传 PDF')).toBeTruthy()

    const cardSelect = screen.getByRole('combobox')
    fireEvent.change(cardSelect, { target: { value: 'card-hk' } })
    const textarea = screen.getByPlaceholderText(/粘贴银行短信或邮件正文/)
    fireEvent.change(textarea, { target: { value: 'HSBC 尾号8848 本期应还 HKD 3,450.25' } })

    fireEvent.click(screen.getByRole('button', { name: /开始解析/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认入账' })).toBeTruthy()
    })
    expect(screen.getAllByText(/HK\$/).length).toBeGreaterThan(0)

    const billDraftsMod = await import('@/lib/api/billDrafts')
    vi.mocked(billDraftsMod.confirmBillImportDraft).mockResolvedValueOnce({ id: 'bill-final-1' } as never)

    fireEvent.click(screen.getByRole('button', { name: '确认入账' }))

    await waitFor(() => {
      expect(screen.getByText('确认入账成功')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('BillDraftsPanel 按紧急程度置顶 needs_password 并支持解锁与 409 合并更新', async () => {
    const billDraftsMod = await import('@/lib/api/billDrafts')
    const { RpcError } = await import('@/lib/api/rpc-client')

    vi.mocked(billDraftsMod.getBillImportDrafts).mockResolvedValue([
      {
        id: 'draft-ready',
        created_by: 'u-1',
        card_id: 'card-us',
        holder_id: 'h-1',
        source_type: 'text',
        parsed_payload: {
          bank_name: 'Chase',
          card_last4: '4242',
          currency: 'USD',
          bill_month: '2026-10',
          bill_amount: 990,
          due_date: '2026-11-10',
        },
        status: 'draft',
        created_at: '2026-10-19T00:00:00Z',
        parse_status: 'ready',
      } as never,
      {
        id: 'draft-locked',
        created_by: 'u-1',
        card_id: 'card-hk',
        holder_id: 'h-1',
        source_type: 'pdf',
        parsed_payload: { bank_name: '招商银行', card_last4: '6677', currency: 'CNY' },
        status: 'draft',
        created_at: '2026-10-18T00:00:00Z',
        parse_status: 'needs_password',
        password_hint: '身份证后6位',
      } as never,
    ])

    vi.mocked(billDraftsMod.confirmBillImportDraft).mockRejectedValueOnce(
      new RpcError('duplicate', 'CONFLICT', {
        reason: 'DUPLICATE_BILL',
        existing_bill: {
          id: 'bill-old',
          bill_month: '2026-10',
          bill_amount: 800,
          paid_amount: 0,
          status: 'unpaid',
          has_override: false,
        },
        draft_bill: { bill_amount: 990, due_date: '2026-11-10', currency: 'USD' },
      })
    )

    mockCallRpc.mockImplementation((mod: string, fn: string) => {
      if (mod === 'billDrafts' && fn === 'unlockEncryptedDraft') {
        return Promise.resolve({ drafts: [], vault_rule_saved: true })
      }
      if (mod === 'billDrafts' && fn === 'confirmBillImportDraft') {
        return Promise.resolve({ id: 'bill-replaced' })
      }
      if (mod === 'billDrafts' && fn === 'batchDiscardBillDrafts') {
        return Promise.resolve({ discarded_count: 1 })
      }
      return Promise.resolve(null)
    })

    render(<BillDraftsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '输入密码解锁' })).toBeTruthy()
    })

    // needs_password 应排在 ready 前面
    const lockBtn = screen.getByRole('button', { name: '输入密码解锁' })
    const readyCard = screen.getByText(/Chase/)
    expect(lockBtn.compareDocumentPosition(readyCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 打开解锁弹层并提交密码
    fireEvent.click(lockBtn)
    fireEvent.change(screen.getByPlaceholderText('请输入 PDF 打开密码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '解锁并解析' }))
    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith(
        'billDrafts',
        'unlockEncryptedDraft',
        'draft-locked',
        expect.objectContaining({ password: '123456' })
      )
    })

    // 确认入账触发 409 DUPLICATE_BILL 后弹出对比窗
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }))
    await waitFor(() => {
      expect(screen.getByText('检测到同卡同月重复账单')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '合并更新原账单' }))
    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith('billDrafts', 'confirmBillImportDraft', 'draft-ready', {
        conflict_resolution: 'merge_update',
      })
    })
  })

  it('StatementPasswordVaultPanel 支持加载与新增密码规则', async () => {
    mockCallRpc.mockImplementation((mod: string, fn: string) => {
      if (mod === 'passwordVault' && fn === 'listPasswordRules') {
        return Promise.resolve([
          {
            id: 'pw-1',
            user_id: 'u-1',
            label: '招行常用密码',
            holder_id: 'h-1',
            bank_id: 'b-1',
            bank_keyword: 'CMB',
            hint: '身份证后6位',
            use_count: 2,
            created_at: '',
            updated_at: '',
          },
        ])
      }
      if (mod === 'passwordVault' && fn === 'createPasswordRule') {
        return Promise.resolve({
          id: 'pw-2',
          user_id: 'u-1',
          label: '汇丰生日密码',
          use_count: 0,
          created_at: '',
          updated_at: '',
        })
      }
      return Promise.resolve(null)
    })

    render(<StatementPasswordVaultPanel />)

    await waitFor(() => {
      expect(screen.getByText('招行常用密码')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /添加规则/ }))
    fireEvent.change(screen.getByPlaceholderText('例如：本人身份证后6位 / 汇丰生日'), {
      target: { value: '汇丰生日密码' },
    })
    fireEvent.change(screen.getByPlaceholderText('仅加密写入，不会再次明文回显'), {
      target: { value: '19900101' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith(
        'passwordVault',
        'createPasswordRule',
        expect.objectContaining({ label: '汇丰生日密码', password: '19900101' })
      )
    })
  })

  it('GmailConnectPanel 渲染多邮箱并支持切换全部邮箱先停草稿箱复核开关', async () => {
    mockCallRpc.mockImplementation((mod: string, fn: string) => {
      if (mod === 'gmail' && fn === 'getGmailConnections') {
        return Promise.resolve([
          {
            id: 'c-1',
            email: 'primary@gmail.com',
            display_label: '家庭主邮箱',
            default_holder_id: 'h-1',
            attribution_mode: 'auto_then_default',
            sync_enabled: true,
            status: 'active',
          },
          {
            id: 'c-2',
            email: 'spouse@gmail.com',
            display_label: '配偶邮箱',
            default_holder_id: 'h-2',
            attribution_mode: 'always_default',
            sync_enabled: true,
            status: 'active',
          },
        ])
      }
      if (mod === 'preferences' && fn === 'getUserImportPreferences') {
        return Promise.resolve({ auto_commit_trusted_email: true })
      }
      if (mod === 'preferences' && fn === 'updateUserImportPreferences') {
        return Promise.resolve({ auto_commit_trusted_email: false })
      }
      return Promise.resolve(null)
    })

    render(<GmailConnectPanel />)

    await waitFor(() => {
      expect(screen.getByText('primary@gmail.com')).toBeTruthy()
      expect(screen.getByText('spouse@gmail.com')).toBeTruthy()
    })

    const toggle = screen.getByRole('switch', { name: '全部邮箱同步先停草稿箱复核' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(mockCallRpc).toHaveBeenCalledWith('preferences', 'updateUserImportPreferences', {
        auto_commit_trusted_email: false,
      })
    })
  })

  it('HolderForm 支持编辑持卡人别名标签并透传 onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <HolderForm
        open={true}
        onClose={() => {}}
        onSubmit={onSubmit}
        initial={{
          id: 'h-1',
          name: '张三',
          avatar_color: '#6366f1',
          aliases: ['SAN ZHANG'],
          created_by: 'u-1',
          created_at: '',
        }}
      />
    )

    fireEvent.change(screen.getByLabelText('账单匹配别名（选填）'), { target: { value: 'ZHANG SAN' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '张三',
          aliases: ['SAN ZHANG', 'ZHANG SAN'],
        })
      )
    })
  })

  it('AiFillBox 在服务端未配置 AI 时按原文兜底识别多币种并提示核对', async () => {
    mockAiComplete.mockRejectedValue(new Error('not configured'))
    const onFill = vi.fn()
    render(<AiFillBox mode='bill' onFill={onFill} />)

    fireEvent.change(screen.getByPlaceholderText(/粘贴账单邮件/), {
      target: { value: 'HSBC HK 本期应还 HK$ 2,340.50' },
    })
    fireEvent.click(screen.getByRole('button', { name: '智能填充' }))

    await waitFor(
      () => {
        expect(onFill).toHaveBeenCalledWith(
          expect.objectContaining({
            currency: 'HKD',
            bill_amount: 2340.5,
            _aiSource: 'regex',
          })
        )
      },
      { timeout: 2500 }
    )
    expect(screen.getByText(/本地规则粗提/)).toBeTruthy()
  })
})
