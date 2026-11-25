'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { getBanks, type BankItem } from '@/lib/api/banks'
import { getCardProducts, updateCard, type CreditCardWithProduct } from '@/lib/api/cards'
import type { CardProduct } from '@/lib/types'
import { currencySymbol } from '@/lib/fx'
import { getEffectiveCardName } from '@/lib/utils'
import {
  ANNUAL_FEE_CYCLE_LABELS,
  ANNUAL_FEE_STATUS_LABELS,
  type AnnualFeeCycleType,
  type AnnualFeeStatus,
  type CreditCardWithAnnualFee,
} from '@/lib/recommendations-ui/types'
import {
  validateDueRule,
  resolveBankChange,
  resolveProductSelect,
  resolveNameOverride,
  DUE_TYPE_LABELS,
  normalizeDueType,
  buildDueRulePayload,
  type DueRuleType,
} from './card-form-shared'

interface Props {
  open: boolean
  onClose: () => void
  card: CreditCardWithProduct
  onSaved: () => void
}

export function CardDefinitionModal({ open, onClose, card, onSaved }: Props) {
  const [banks, setBanks] = useState<BankItem[]>([])
  const [products, setProducts] = useState<CardProduct[]>([])
  const [selectedBankId, setSelectedBankId] = useState<string>('')
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [cardName, setCardName] = useState<string>('')
  const [hasCustomName, setHasCustomName] = useState<boolean>(false)

  // 还款规则覆盖：只看 override_due_type，避免残留 value 导致关闭后复活
  const [overrideEnabled, setOverrideEnabled] = useState(
    !!card.override_due_type
  )
  const [overrideDueType, setOverrideDueType] = useState<DueRuleType>(
    normalizeDueType(card.override_due_type)
  )
  const [overrideDueValue, setOverrideDueValue] = useState(
    card.override_due_value?.toString() ?? ''
  )
  const extCard = card as unknown as CreditCardWithAnnualFee
  const [annualFeeOverride, setAnnualFeeOverride] = useState(
    card.annual_fee_override != null ? String(card.annual_fee_override) : ''
  )
  const [issuedOn, setIssuedOn] = useState(card.issued_on ?? '')
  const [activatedOn, setActivatedOn] = useState(card.activated_on ?? '')
  const [annualFeeCycleType, setAnnualFeeCycleType] = useState<string>(
    extCard.annual_fee_cycle_type ?? ''
  )
  const [nextAnnualFeeDate, setNextAnnualFeeDate] = useState(
    extCard.next_annual_fee_date ?? ''
  )
  const [annualFeeStatus, setAnnualFeeStatus] = useState<string>(
    extCard.annual_fee_status ?? ''
  )

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    Promise.all([getBanks(), getCardProducts()])
      .then(([bankList, prodList]) => {
        setBanks(bankList)
        setProducts(prodList)

        const currentBankId = card.card_product?.bank_id || ''
        setSelectedBankId(currentBankId)
        setSelectedProductId(card.card_product_id)

        const effName = getEffectiveCardName(card, card.card_product)
        setCardName(effName)
        setHasCustomName(!!card.name_override)

        setOverrideEnabled(!!card.override_due_type)
        setOverrideDueType(normalizeDueType(card.override_due_type))
        setOverrideDueValue(card.override_due_value?.toString() ?? '')
        const ext = card as unknown as CreditCardWithAnnualFee
        setAnnualFeeOverride(card.annual_fee_override != null ? String(card.annual_fee_override) : '')
        setIssuedOn(card.issued_on ?? '')
        setActivatedOn(card.activated_on ?? '')
        setAnnualFeeCycleType(ext.annual_fee_cycle_type ?? '')
        setNextAnnualFeeDate(ext.next_annual_fee_date ?? '')
        setAnnualFeeStatus(ext.annual_fee_status ?? '')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载银行列表失败')
      })
      .finally(() => setLoading(false))
  }, [open, card])

  // 当前所选银行名下的卡产品
  const availableProducts = selectedBankId
    ? products.filter((p) => p.bank_id === selectedBankId)
    : []

  const handleBankChange = (bankId: string) => {
    setSelectedBankId(bankId)
    setError(null)

    // 找到新银行下的卡产品
    const bankProds = products.filter((p) => p.bank_id === bankId)
    const next = resolveBankChange(bankProds, hasCustomName, cardName)
    setSelectedProductId(next.productId)
    setCardName(next.cardName)
  }

  const handleSelectProduct = (prod: CardProduct) => {
    const next = resolveProductSelect(prod)
    setSelectedProductId(next.productId)
    setCardName(next.cardName)
    setHasCustomName(next.hasCustomName)
  }

  const isLoan = card.card_type === 'loan'

  const handleSubmit = async () => {
    if (!cardName.trim()) {
      setError('请输入卡片名称')
      return
    }

    // Finding 7, 8: 还款规则校验
    const dueCheck = validateDueRule(overrideEnabled, overrideDueType, overrideDueValue)
    if (!dueCheck.valid) {
      setError(dueCheck.error || '还款规则校验失败')
      return
    }

    const dueRulePayload = buildDueRulePayload(overrideEnabled, overrideDueType, dueCheck.value)

    // Finding 9: 判定名称是否自定义；若未自定义或与选定产品同名，则提交 null 清空 override
    const currentProd = products.find((p) => p.id === selectedProductId)
    const finalNameOverride = resolveNameOverride(cardName, currentProd, hasCustomName)

    let parsedAnnualFeeOverride: number | null = null
    if (!isLoan && annualFeeOverride.trim()) {
      const feeNum = Number(annualFeeOverride.trim())
      if (!Number.isFinite(feeNum) || feeNum < 0) {
        setError('年费覆盖金额必须为非负数')
        return
      }
      parsedAnnualFeeOverride = feeNum
    }
    if (!isLoan && nextAnnualFeeDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(nextAnnualFeeDate.trim())) {
      setError('下次年费扣费日格式必须为 YYYY-MM-DD')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      await updateCard(card.id, {
        card_product_id: selectedProductId || undefined,
        bank_id: selectedBankId || undefined,
        name_override: finalNameOverride,
        ...dueRulePayload,
        ...(!isLoan
          ? {
              annual_fee_override: parsedAnnualFeeOverride,
              issued_on: issuedOn.trim() || null,
              activated_on: activatedOn.trim() || null,
              annual_fee_cycle_type: (annualFeeCycleType || null) as AnnualFeeCycleType | null,
              next_annual_fee_date: nextAnnualFeeDate.trim() || null,
              annual_fee_status: (annualFeeStatus || null) as AnnualFeeStatus | null,
            }
          : {}),
      } as Parameters<typeof updateCard>[1])
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改卡片信息失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title='修改卡片信息'
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={loading || submitting}>
            保存
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {error && (
          <div className='rounded-xl bg-d-danger-soft p-3 text-[12px] font-semibold text-d-danger-ink'>
            {error}
          </div>
        )}

        {/* 所属银行 */}
        <SelectField
          label='所属银行'
          required
          value={selectedBankId}
          onChange={(e) => handleBankChange(e.target.value)}
          options={banks.map((b) => ({ value: b.id, label: b.name }))}
        />

        {/* 卡片名称 */}
        <div>
          <TextField
            label='卡片名称'
            required
            placeholder='输入卡片名称，或点选下方常用卡种'
            value={cardName}
            onChange={(e) => {
              setCardName(e.target.value)
              setHasCustomName(true)
            }}
          />

          {availableProducts.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {availableProducts.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type='button'
                  onClick={() => handleSelectProduct(p)}
                  className={
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                    (selectedProductId === p.id && cardName === p.card_name
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

        {/* 还款规则自定义 */}
        <div className='flex items-center gap-2.5 pt-1'>
          <Toggle
            checked={overrideEnabled}
            onChange={setOverrideEnabled}
            ariaLabel='自定义还款规则'
          />
          <span className='text-[13px] font-medium text-d-text'>自定义还款规则</span>
        </div>

        {overrideEnabled && (
          <div className='flex flex-col gap-3 border-l-2 border-d-border pl-3'>
            <SelectField
              label='还款规则'
              value={overrideDueType}
              onChange={(e) => setOverrideDueType(e.target.value as DueRuleType)}
              options={(Object.keys(DUE_TYPE_LABELS) as DueRuleType[]).map((t) => ({
                value: t,
                label: DUE_TYPE_LABELS[t],
              }))}
            />

            <TextField
              label={overrideDueType === 'after_billing' ? '天数' : '还款日'}
              type='number'
              placeholder={overrideDueType === 'after_billing' ? '例如：20' : '1-31'}
              value={overrideDueValue}
              onChange={(e) => setOverrideDueValue(e.target.value)}
              endAdornment={<span>{overrideDueType === 'after_billing' ? '天' : '日'}</span>}
            />
          </div>
        )}

        {!isLoan && (
          <>
            <div className='h-px bg-d-border' />

            {/* 年费与周年日 */}
            <div className='flex flex-col gap-3'>
              <p className='text-[13px] font-semibold text-d-muted'>年费周期与卡生命周期</p>
              <div className='grid grid-cols-2 gap-3'>
                <TextField
                  label='发卡日'
                  type='date'
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
                <TextField
                  label='激活日'
                  type='date'
                  value={activatedOn}
                  onChange={(e) => setActivatedOn(e.target.value)}
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <TextField
                  label={`年费覆盖（${card.card_product?.currency || 'CNY'}）`}
                  type='number'
                  inputMode='decimal'
                  min='0'
                  placeholder='留空用默认'
                  value={annualFeeOverride}
                  onChange={(e) => setAnnualFeeOverride(e.target.value)}
                  startAdornment={<span>{currencySymbol(card.card_product?.currency || 'CNY')}</span>}
                />
                <SelectField
                  label='年费周期'
                  value={annualFeeCycleType}
                  onChange={(e) => setAnnualFeeCycleType(e.target.value)}
                  options={[
                    { value: '', label: '沿用卡产品默认' },
                    ...(Object.keys(ANNUAL_FEE_CYCLE_LABELS) as AnnualFeeCycleType[]).map((k) => ({
                      value: k,
                      label: ANNUAL_FEE_CYCLE_LABELS[k],
                    })),
                  ]}
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <TextField
                  label='下次年费扣费日'
                  type='date'
                  value={nextAnnualFeeDate}
                  onChange={(e) => setNextAnnualFeeDate(e.target.value)}
                />
                <SelectField
                  label='年费状态'
                  value={annualFeeStatus}
                  onChange={(e) => setAnnualFeeStatus(e.target.value)}
                  options={[
                    { value: '', label: '自动 / 未指定' },
                    ...(Object.keys(ANNUAL_FEE_STATUS_LABELS) as AnnualFeeStatus[]).map((k) => ({
                      value: k,
                      label: ANNUAL_FEE_STATUS_LABELS[k],
                    })),
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
