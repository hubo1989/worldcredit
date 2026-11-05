'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { getBanks, type BankItem } from '@/lib/api/banks'
import { getCardProducts, updateCard, type CreditCardWithProduct } from '@/lib/api/cards'
import type { CardProduct } from '@/lib/types'
import { getEffectiveCardName } from '@/lib/utils'
import {
  validateDueRule,
  DUE_TYPE_LABELS,
} from './card-form-shared'

interface Props {
  open: boolean
  onClose: () => void
  card: CreditCardWithProduct
  onSaved: () => void
}

type DueType = 'after_billing' | 'fixed'

export function CardDefinitionModal({ open, onClose, card, onSaved }: Props) {
  const [banks, setBanks] = useState<BankItem[]>([])
  const [products, setProducts] = useState<CardProduct[]>([])
  const [selectedBankId, setSelectedBankId] = useState<string>('')
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [cardName, setCardName] = useState<string>('')
  const [hasCustomName, setHasCustomName] = useState<boolean>(false)

  // 还款规则覆盖
  const [overrideEnabled, setOverrideEnabled] = useState(
    !!(card.override_due_type || card.override_due_value)
  )
  const [overrideDueType, setOverrideDueType] = useState<DueType>(
    (card.override_due_type as DueType) ?? 'after_billing'
  )
  const [overrideDueValue, setOverrideDueValue] = useState(
    card.override_due_value?.toString() ?? ''
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

        setOverrideEnabled(!!(card.override_due_type || card.override_due_value))
        setOverrideDueType((card.override_due_type as DueType) ?? 'after_billing')
        setOverrideDueValue(card.override_due_value?.toString() ?? '')
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
    if (bankProds.length > 0) {
      setSelectedProductId(bankProds[0].id)
      if (!hasCustomName) {
        setCardName(bankProds[0].card_name)
      }
    } else {
      // Finding 6: 无产品银行不再在客户端合成伪造 ID，置空让服务端按同口径兜底
      setSelectedProductId('')
      if (!hasCustomName) {
        setCardName('标准信用卡')
      }
    }
  }

  const handleSelectProduct = (prod: CardProduct) => {
    setSelectedProductId(prod.id)
    setCardName(prod.card_name)
    setHasCustomName(false)
  }

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

    // Finding 9: 判定名称是否自定义；若未自定义或与选定产品同名，则提交 null 清空 override
    const currentProd = products.find((p) => p.id === selectedProductId)
    const isCustom = hasCustomName && (!currentProd || cardName.trim() !== currentProd.card_name)

    setError(null)
    setSubmitting(true)
    try {
      await updateCard(card.id, {
        card_product_id: selectedProductId || undefined,
        bank_id: selectedBankId || undefined,
        name_override: isCustom ? cardName.trim() : null,
        override_due_type: overrideEnabled ? overrideDueType : null,
        override_due_value: overrideEnabled ? dueCheck.value : undefined,
      })
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
              onChange={(e) => setOverrideDueType(e.target.value as DueType)}
              options={(Object.keys(DUE_TYPE_LABELS) as DueType[]).map((t) => ({
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
      </div>
    </Modal>
  )
}
