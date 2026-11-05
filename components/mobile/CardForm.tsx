'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import type { CreditCard, CardProduct } from '@/lib/types'
import { getCardProducts } from '@/lib/api/cards'
import { getEffectiveCreditLimit, isCreditLimitManuallySet } from '@/lib/utils'
import { AiFillBox } from '@/components/mobile/AiFillBox'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<CreditCard, 'id' | 'created_at'>) => Promise<void>
  holderId: string
  /**
   * 可选的归属持卡人列表：编辑卡片时传入即显示「归属持卡人」选择器，
   * 允许在列表内转移归属（双端 scope 由服务端校验）。
   */
  holders?: Array<{ id: string; name: string }>
  initial?: CreditCard
}

type DueType = 'after_billing' | 'fixed' | 'fixed_before_billing'

const DUE_TYPE_LABELS: Record<DueType, string> = {
  after_billing: '账单日后 X 天',
  fixed: '每月固定还款日',
  fixed_before_billing: '每月固定还款日（账单日倒推）',
}

/** 卡类型分段选择（对应 MUI ToggleButtonGroup exclusive 的暗色版）。 */
function CardTypeSegment({
  value, onChange,
}: {
  value: 'credit' | 'loan'
  onChange: (next: 'credit' | 'loan') => void
}) {
  const items: { value: 'credit' | 'loan'; label: string }[] = [
    { value: 'credit', label: '信用卡' },
    { value: 'loan', label: '贷款类' },
  ]
  return (
    <div role='group' aria-label='卡类型' className='grid grid-cols-2 gap-1 rounded-xl border border-d-border bg-d-subtle p-1'>
      {items.map(item => (
        <button
          key={item.value}
          type='button'
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={
            'h-9 rounded-lg text-[13px] font-semibold transition-colors ' +
            (value === item.value
              ? 'bg-d-surface text-d-text shadow-sm'
              : 'text-d-muted active:text-d-text')
          }
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function CardForm({ open, onClose, onSubmit, holderId, holders, initial }: Props) {
  const [products, setProducts] = useState<CardProduct[]>([])
  const [selectedBank, setSelectedBank] = useState('')
  const [productId, setProductId] = useState(initial?.card_product_id ?? '')
  const [last4, setLast4] = useState(initial?.card_number_last4 ?? '')
  const initialEffLimit = getEffectiveCreditLimit(initial)
  const [limit, setLimit] = useState(initialEffLimit != null ? initialEffLimit.toString() : '')
  const [billingDay, setBillingDay] = useState(initial?.billing_day.toString() ?? '')
  const [submitting, setSubmitting] = useState(false)
  // 编辑态下可改归属；新建仍固定为传入的 holderId
  const [ownerId, setOwnerId] = useState<string>(initial?.holder_id ?? holderId)
  useEffect(() => { setOwnerId(initial?.holder_id ?? holderId) }, [initial?.holder_id, holderId, open])

  // 卡类型
  const [cardType, setCardType] = useState<'credit' | 'loan'>(initial?.card_type ?? 'credit')

  // 贷款类
  const [loanDueDay, setLoanDueDay] = useState(initial?.loan_due_day?.toString() ?? '')

  // 发卡/激活日：周年权益锚点，未知保持 null
  const [issuedOn, setIssuedOn] = useState(initial?.issued_on ?? '')
  const [activatedOn, setActivatedOn] = useState(initial?.activated_on ?? '')

  // 还款规则覆盖
  const [overrideEnabled, setOverrideEnabled] = useState(
    !!(initial?.override_due_type || initial?.override_due_value)
  )
  const [cardName, setCardName] = useState(initial?.name_override ?? '')
  const [overrideDueType, setOverrideDueType] = useState<DueType>(
    (initial?.override_due_type as DueType) ?? 'after_billing'
  )
  const [overrideDueValue, setOverrideDueValue] = useState(
    initial?.override_due_value?.toString() ?? ''
  )

  // 账户模式覆盖：null = 自动推导
  const [accountModeOverride, setAccountModeOverride] = useState<'auto' | 'multi' | 'single'>(
    initial?.account_mode_override ?? 'auto'
  )

  useEffect(() => {
    getCardProducts().then(setProducts)
  }, [])

  // 提取所有的银行选项
  const bankOptions = Array.from(new Set(products.map(p => p.bank_name))).filter(Boolean)

  // 当前银行下的卡产品列表
  const availableProducts = selectedBank
    ? products.filter(p => p.bank_name === selectedBank)
    : products

  useEffect(() => {
    if (initial && products.length > 0) {
      const match = products.find(p => p.id === initial.card_product_id)
      if (match) {
        setSelectedBank(match.bank_name)
      }
      setProductId(initial.card_product_id)
      setCardName(initial.name_override || match?.card_name || '')
      setLast4(initial.card_number_last4 ?? '')
      const eff = getEffectiveCreditLimit(initial)
      setLimit(eff != null ? eff.toString() : '')
      setBillingDay(initial.billing_day.toString())
      setCardType(initial.card_type ?? 'credit')
      setLoanDueDay(initial.loan_due_day?.toString() ?? '')
      setIssuedOn(initial.issued_on ?? '')
      setActivatedOn(initial.activated_on ?? '')
      setOverrideEnabled(!!(initial.override_due_type || initial.override_due_value))
      setOverrideDueType((initial.override_due_type as DueType) ?? 'after_billing')
      setOverrideDueValue(initial.override_due_value?.toString() ?? '')
      setAccountModeOverride(initial.account_mode_override ?? 'auto')
    } else if (!initial) {
      setSelectedBank('')
      setProductId('')
      setCardName('')
      setLast4('')
      setLimit('')
      setBillingDay('')
      setCardType('credit')
      setLoanDueDay('')
      setIssuedOn('')
      setActivatedOn('')
      setOverrideEnabled(false)
      setOverrideDueType('after_billing')
      setOverrideDueValue('')
      setAccountModeOverride('auto')
    }
  }, [initial, open, products])

  const handleBankChange = (bank: string) => {
    setSelectedBank(bank)
    const filtered = products.filter(p => p.bank_name === bank)
    if (filtered.length > 0) {
      setProductId(filtered[0].id)
      setCardName(filtered[0].card_name)
    } else {
      setProductId('')
      setCardName('')
    }
  }

  const showOwnerSelect = !!initial && !!holders && holders.length > 0
  const isCredit = cardType === 'credit'
  const isLoan = cardType === 'loan'

  // 信用卡模式校验：新建卡必填额度；编辑既有卡允许仅改其他信息，或补充输入额度
  const creditValid = !!selectedBank && !!productId && !!billingDay && (!!initial || !!limit.trim())
  // 贷款类模式校验（产品和还款日必填，额度选填）
  const loanValid = !!selectedBank && !!productId && !!loanDueDay

  const canSubmit = isCredit ? creditValid : loanValid

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const parsedLimit = limit.trim() ? parseFloat(limit) : null
      const validLimit = parsedLimit && parsedLimit > 0 ? parsedLimit : 0

      // limitOverride 三段式语义推导（与 R2 统一口径）：
      // 1. 输入正数 (parsedLimit > 0)：同步写入 credit_limit 与 credit_limit_override 手动覆盖值
      // 2. 清空输入 (!limit.trim())：保留旧 override（initial?.credit_limit_override ?? null，视为不修改该字段）
      // 3. 显式输入 0 或非法值 (limit.trim() 有值但 parsedLimit <= 0)：清除手动 override（写入 null）
      const limitOverride =
        parsedLimit && parsedLimit > 0
          ? parsedLimit
          : limit.trim()
            ? null
            : (initial?.credit_limit_override ?? null)

      const base: Omit<CreditCard, 'id' | 'created_at'> = {
        holder_id: ownerId,
        card_product_id: productId,
        card_number_last4: last4 || undefined,
        credit_limit: validLimit,
        credit_limit_override: limitOverride,
        billing_day: billingDay ? parseInt(billingDay) : 1,
        status: 'active',
        card_type: cardType,
        loan_due_day: isLoan && loanDueDay ? parseInt(loanDueDay) : undefined,
        name_override: cardName.trim() || undefined,
        override_due_type: overrideEnabled ? overrideDueType : null,
        override_due_value: overrideEnabled && overrideDueValue ? parseInt(overrideDueValue) : undefined,
        account_mode_override: accountModeOverride === 'auto' ? null : accountModeOverride,
        issued_on: issuedOn || null,
        activated_on: activatedOn || null,
      }

      await onSubmit(base)
      onClose()
    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      alert('保存卡片失败: ' + message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '编辑卡片' : '添加卡片'}
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!canSubmit}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <AiFillBox mode="card" onFill={(data) => {
          if (data.bank_name) setSelectedBank(String(data.bank_name))
          if (data.card_number_last4) setLast4(String(data.card_number_last4))
          if (data.billing_day) {
            const d = String(data.billing_day).replace(/\D/g, '')
            if (d) setBillingDay(d)
          }
          if (data.card_name) {
            const match = products.find(p => p.card_name === data.card_name || p.card_name.includes(String(data.card_name)))
            if (match) {
              setSelectedBank(match.bank_name)
              setProductId(match.id)
            }
          }
        }} />

        {/* 归属持卡人：仅编辑态且提供列表时显示；转移连同历史账单一起移动 */}
        {showOwnerSelect && (
          <div className='mb-3'>
            <span className='mb-1 block text-[13px] font-semibold text-d-text'>归属持卡人</span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className='h-12 w-full rounded-xl border border-d-border bg-d-bg px-3 text-[15px] text-d-text outline-none focus:border-d-accent'
            >
              {holders!.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <p className='mt-1 text-[11px] text-d-muted'>转移归属会连同该卡全部历史账单一起移动；已关联权益台账的卡需先解绑。</p>
          </div>
        )}

        {/* 卡类型选择 */}
        <div>
          <p className='mb-1.5 text-[13px] font-semibold leading-5 text-d-muted'>卡类型</p>
          <CardTypeSegment value={cardType} onChange={setCardType} />
        </div>

        {/* 发卡银行选择 */}
        <SelectField
          label="发卡银行"
          required
          value={selectedBank}
          onChange={e => handleBankChange(e.target.value)}
          options={bankOptions.map(bank => ({ value: bank, label: bank }))}
        />

        {/* 卡片名称输入与常用卡种快捷点选 */}
        <div>
          <TextField
            label="卡片名称"
            required
            placeholder="输入卡片名称，或点选下方卡种"
            value={cardName}
            onChange={e => setCardName(e.target.value)}
          />

          {availableProducts.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {availableProducts.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type='button'
                  onClick={() => {
                    setProductId(p.id)
                    setCardName(p.card_name)
                  }}
                  className={
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                    (productId === p.id && cardName === p.card_name
                      ? 'bg-d-accent text-white'
                      : 'border border-d-border bg-d-subtle text-d-muted hover:text-d-text')
                  }
                >
                  {p.card_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---- 信用卡模式 ---- */}
        {isCredit && (
          <>
            <TextField
              label="额度"
              type="number"
              placeholder={initial && getEffectiveCreditLimit(initial) === null ? "未获取，请输入信用额度" : "例如：50000"}
              value={limit}
              onChange={e => setLimit(e.target.value)}
              required={!initial}
              helperText={
                initial && isCreditLimitManuallySet(initial)
                  ? "已手动设置（不会被邮件同步覆盖）"
                  : initial && getEffectiveCreditLimit(initial) === null
                  ? "邮件未获取到额度，请输入并保存"
                  : undefined
              }
              startAdornment={<span>¥</span>}
            />

            <TextField
              label="账单日"
              type="number"
              placeholder="1-31 之间的数字"
              value={billingDay}
              onChange={e => setBillingDay(e.target.value)}
              required
              helperText="每个月生成账单的日期"
              endAdornment={<span>日</span>}
            />

            <div className='grid grid-cols-2 gap-3'>
              <TextField
                label="发卡日"
                type="date"
                value={issuedOn}
                onChange={e => setIssuedOn(e.target.value)}
                helperText="周年类权益锚点"
              />
              <TextField
                label="激活日"
                type="date"
                value={activatedOn}
                onChange={e => setActivatedOn(e.target.value)}
                helperText="可选"
              />
            </div>

            {/* 还款规则覆盖 */}
            <div className='flex items-center gap-2.5'>
              <Toggle
                checked={overrideEnabled}
                onChange={setOverrideEnabled}
                ariaLabel='覆盖卡产品默认还款规则'
              />
              <span className='text-[14px] leading-5 text-d-text'>覆盖卡产品默认还款规则</span>
            </div>

            {overrideEnabled && (
              // 分组缩进线：1px d-border
              <div className='flex flex-col gap-4 border-l border-d-border pl-2'>
                <SelectField
                  label="还款规则"
                  value={overrideDueType}
                  onChange={e => setOverrideDueType(e.target.value as DueType)}
                  options={(Object.keys(DUE_TYPE_LABELS) as DueType[]).map(t => ({
                    value: t,
                    label: DUE_TYPE_LABELS[t],
                  }))}
                />

                <TextField
                  label={overrideDueType === 'after_billing' ? '天数' : '还款日'}
                  type="number"
                  placeholder={overrideDueType === 'after_billing' ? '例如：20' : '1-31'}
                  value={overrideDueValue}
                  onChange={e => setOverrideDueValue(e.target.value)}
                  endAdornment={<span>{overrideDueType === 'after_billing' ? '天' : '日'}</span>}
                />
              </div>
            )}

            <SelectField
              label="账户模式"
              value={accountModeOverride}
              onChange={e => setAccountModeOverride(e.target.value as 'auto' | 'multi' | 'single')}
              helperText="自动：按同银行同持卡人卡数推导；手工钉住可覆盖"
              options={[
                { value: 'auto', label: '自动推导' },
                { value: 'multi', label: '多卡一账户' },
                { value: 'single', label: '单卡单账户' },
              ]}
            />
          </>
        )}

        {/* ---- 贷款类模式 ---- */}
        {isLoan && (
          <>
            <TextField
              label="每月还款日"
              type="number"
              placeholder="1-31 之间的数字"
              value={loanDueDay}
              onChange={e => setLoanDueDay(e.target.value)}
              required
              helperText="每个月固定还款日期"
              endAdornment={<span>日</span>}
            />

            <TextField
              label="贷款金额"
              type="number"
              placeholder="选填"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              startAdornment={<span>¥</span>}
              helperText="选填，贷款总金额"
            />
          </>
        )}

        {/* 分隔线 */}
        <div className='h-px bg-d-border' />

        {/* 卡号末4位（通用） */}
        <TextField
          label="卡号末4位"
          placeholder="选填"
          value={last4}
          onChange={e => setLast4(e.target.value)}
          maxLength={6}
        />
      </div>
    </Modal>
  )
}
