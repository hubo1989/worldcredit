'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import type { CreditCard, CardProduct } from '@/lib/types'
import { getCardProducts } from '@/lib/api/cards'
import { AiFillBox } from '@/components/mobile/AiFillBox'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<CreditCard, 'id' | 'created_at'>) => Promise<void>
  holderId: string
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

export function CardForm({ open, onClose, onSubmit, holderId, initial }: Props) {
  const [products, setProducts] = useState<CardProduct[]>([])
  const [selectedBank, setSelectedBank] = useState('')
  const [productId, setProductId] = useState(initial?.card_product_id ?? '')
  const [last4, setLast4] = useState(initial?.card_number_last4 ?? '')
  const [limit, setLimit] = useState(initial?.credit_limit.toString() ?? '')
  const [billingDay, setBillingDay] = useState(initial?.billing_day.toString() ?? '')
  const [submitting, setSubmitting] = useState(false)

  // 卡类型
  const [cardType, setCardType] = useState<'credit' | 'loan'>(initial?.card_type ?? 'credit')

  // 贷款类
  const [loanDueDay, setLoanDueDay] = useState(initial?.loan_due_day?.toString() ?? '')

  // 还款规则覆盖
  const [overrideEnabled, setOverrideEnabled] = useState(
    !!(initial?.override_due_type || initial?.override_billing_day)
  )
  const [overrideBillingDay, setOverrideBillingDay] = useState(
    initial?.override_billing_day?.toString() ?? ''
  )
  const [overrideDueType, setOverrideDueType] = useState<DueType>(
    (initial?.override_due_type as DueType) ?? 'after_billing'
  )
  const [overrideDueValue, setOverrideDueValue] = useState(
    initial?.override_due_value?.toString() ?? ''
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
      setLast4(initial.card_number_last4 ?? '')
      setLimit(initial.credit_limit.toString())
      setBillingDay(initial.billing_day.toString())
      setCardType(initial.card_type ?? 'credit')
      setLoanDueDay(initial.loan_due_day?.toString() ?? '')
      setOverrideEnabled(!!(initial.override_due_type || initial.override_billing_day))
      setOverrideBillingDay(initial.override_billing_day?.toString() ?? '')
      setOverrideDueType((initial.override_due_type as DueType) ?? 'after_billing')
      setOverrideDueValue(initial.override_due_value?.toString() ?? '')
    } else if (!initial) {
      setSelectedBank('')
      setProductId('')
      setLast4('')
      setLimit('')
      setBillingDay('')
      setCardType('credit')
      setLoanDueDay('')
      setOverrideEnabled(false)
      setOverrideBillingDay('')
      setOverrideDueType('after_billing')
      setOverrideDueValue('')
    }
  }, [initial, open, products])

  const handleBankChange = (bank: string) => {
    setSelectedBank(bank)
    const filtered = products.filter(p => p.bank_name === bank)
    if (filtered.length > 0) {
      setProductId(filtered[0].id)
    } else {
      setProductId('')
    }
  }

  const isCredit = cardType === 'credit'
  const isLoan = cardType === 'loan'

  // 信用卡模式校验
  const creditValid = !!selectedBank && !!productId && !!limit && !!billingDay
  // 贷款类模式校验（产品和还款日必填，额度选填）
  const loanValid = !!selectedBank && !!productId && !!loanDueDay

  const canSubmit = isCredit ? creditValid : loanValid

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const base: Omit<CreditCard, 'id' | 'created_at'> = {
        holder_id: holderId,
        card_product_id: productId,
        card_number_last4: last4 || undefined,
        credit_limit: limit ? parseFloat(limit) : 0,
        billing_day: billingDay ? parseInt(billingDay) : 1,
        status: 'active',
        card_type: cardType,
        loan_due_day: isLoan && loanDueDay ? parseInt(loanDueDay) : undefined,
        override_billing_day: overrideEnabled && overrideBillingDay ? parseInt(overrideBillingDay) : undefined,
        override_due_type: overrideEnabled ? overrideDueType : null,
        override_due_value: overrideEnabled && overrideDueValue ? parseInt(overrideDueValue) : undefined,
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

        {/* 卡片名称选择 */}
        <SelectField
          label="卡片名称"
          required
          value={productId}
          onChange={e => setProductId(e.target.value)}
          disabled={!selectedBank}
          helperText={!selectedBank ? '请先选择发卡银行' : undefined}
          options={availableProducts.map(p => ({ value: p.id, label: p.card_name }))}
        />

        {/* ---- 信用卡模式 ---- */}
        {isCredit && (
          <>
            <TextField
              label="额度"
              type="number"
              placeholder="例如：50000"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              required
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
                <TextField
                  label="账单日（覆盖）"
                  type="number"
                  placeholder="留空则使用上方账单日"
                  value={overrideBillingDay}
                  onChange={e => setOverrideBillingDay(e.target.value)}
                  helperText="可选，覆盖卡产品的默认账单日"
                  endAdornment={<span>日</span>}
                />

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
