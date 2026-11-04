'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { getBanks, type BankItem } from '@/lib/api/banks'
import { getCardProducts, createCard } from '@/lib/api/cards'
import { getHolders, createHolder } from '@/lib/api/holders'
import type { CardProduct, CardHolder } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  initialHolderId?: string
}

type DueType = 'after_billing' | 'fixed' | 'fixed_before_billing'

const DUE_TYPE_LABELS: Record<DueType, string> = {
  after_billing: '账单日后 X 天',
  fixed: '每月固定还款日',
  fixed_before_billing: '每月固定还款日（账单日倒推）',
}

export function CardCreateModal({ open, onClose, onSuccess, initialHolderId }: Props) {
  const [banks, setBanks] = useState<BankItem[]>([])
  const [products, setProducts] = useState<CardProduct[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])

  const [selectedBankId, setSelectedBankId] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [cardName, setCardName] = useState('')
  const [hasCustomName, setHasCustomName] = useState(false)

  const [selectedHolderId, setSelectedHolderId] = useState(initialHolderId || '')
  const [isCreatingHolder, setIsCreatingHolder] = useState(false)
  const [newHolderName, setNewHolderName] = useState('')

  const [last4, setLast4] = useState('')
  const [limit, setLimit] = useState('')
  const [billingDay, setBillingDay] = useState('')

  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [overrideDueType, setOverrideDueType] = useState<DueType>('after_billing')
  const [overrideDueValue, setOverrideDueValue] = useState('')

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    setIsCreatingHolder(false)
    setNewHolderName('')
    setLast4('')
    setLimit('')
    setBillingDay('')
    setOverrideEnabled(false)

    Promise.all([getBanks(), getCardProducts(), getHolders()])
      .then(([bankList, prodList, holderList]) => {
        setBanks(bankList)
        setProducts(prodList)
        setHolders(holderList)

        // 默认选第一家银行
        if (bankList.length > 0) {
          const firstBank = bankList[0]
          setSelectedBankId(firstBank.id)
          const firstBankProds = prodList.filter((p) => p.bank_id === firstBank.id)
          if (firstBankProds.length > 0) {
            setSelectedProductId(firstBankProds[0].id)
            setCardName(firstBankProds[0].card_name)
          } else {
            setSelectedProductId(`cp_default_${firstBank.id}`)
            setCardName('标准信用卡')
          }
          setHasCustomName(false)
        }

        // 默认选持卡人
        if (initialHolderId) {
          setSelectedHolderId(initialHolderId)
        } else if (holderList.length > 0) {
          setSelectedHolderId(holderList[0].id)
        } else {
          setIsCreatingHolder(true)
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载选项失败')
      })
      .finally(() => setLoading(false))
  }, [open, initialHolderId])

  const availableProducts = selectedBankId
    ? products.filter((p) => p.bank_id === selectedBankId)
    : []

  const handleBankChange = (bankId: string) => {
    setSelectedBankId(bankId)
    setError(null)
    const bankProds = products.filter((p) => p.bank_id === bankId)
    if (bankProds.length > 0) {
      setSelectedProductId(bankProds[0].id)
      if (!hasCustomName) {
        setCardName(bankProds[0].card_name)
      }
    } else {
      setSelectedProductId(`cp_default_${bankId}`)
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
    setError(null)

    if (!selectedBankId) {
      setError('请选择发卡银行')
      return
    }

    if (!cardName.trim()) {
      setError('请输入卡片名称')
      return
    }

    let finalHolderId = selectedHolderId
    if (isCreatingHolder) {
      if (!newHolderName.trim()) {
        setError('请输入新建持卡人姓名')
        return
      }
      try {
        const created = await createHolder({
          name: newHolderName.trim(),
          avatar_color: '#3b82f6',
        })
        finalHolderId = created.id
      } catch (err) {
        setError(err instanceof Error ? err.message : '新建持卡人失败')
        return
      }
    }

    if (!finalHolderId) {
      setError('请选择或新建持卡人')
      return
    }

    const dayNum = parseInt(billingDay, 10)
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      setError('每月账单日必须在 1 到 31 之间')
      return
    }

    const limitNum = parseFloat(limit)
    if (!limit.trim() || isNaN(limitNum) || limitNum < 0) {
      setError('请输入有效的信用额度')
      return
    }

    setSubmitting(true)
    try {
      await createCard({
        holder_id: finalHolderId,
        bank_id: selectedBankId,
        card_product_id: selectedProductId || undefined,
        name_override: cardName.trim(),
        card_number_last4: last4.trim() || null,
        credit_limit: limitNum,
        billing_day: dayNum,
        override_due_type: overrideEnabled ? overrideDueType : null,
        override_due_value: overrideEnabled && overrideDueValue ? parseInt(overrideDueValue, 10) : undefined,
      })

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建卡片失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title='新增卡片'
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={loading || submitting}>
            创建卡片
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

        {/* 1. 选银行 */}
        <SelectField
          label='发卡银行'
          required
          value={selectedBankId}
          onChange={(e) => handleBankChange(e.target.value)}
          options={banks.map((b) => ({ value: b.id, label: b.name }))}
        />

        {/* 2. 卡片名称 */}
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

        {/* 3. 持卡人 */}
        <div>
          {!isCreatingHolder ? (
            <div className='flex flex-col gap-1.5'>
              <div className='flex items-center justify-between'>
                <span className='text-[13px] font-semibold text-d-muted'>持卡人 *</span>
                <button
                  type='button'
                  onClick={() => setIsCreatingHolder(true)}
                  className='text-[12px] font-semibold text-d-accent-light'
                >
                  + 新建持卡人
                </button>
              </div>
              <select
                value={selectedHolderId}
                onChange={(e) => setSelectedHolderId(e.target.value)}
                className='h-11 w-full rounded-xl border border-d-border bg-d-surface px-3 text-[15px] text-d-text outline-none focus:border-d-accent'
              >
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className='flex flex-col gap-1.5 rounded-xl border border-d-border bg-d-subtle p-3'>
              <div className='flex items-center justify-between'>
                <span className='text-[13px] font-semibold text-d-text'>新建持卡人</span>
                {holders.length > 0 && (
                  <button
                    type='button'
                    onClick={() => setIsCreatingHolder(false)}
                    className='text-[12px] font-semibold text-d-muted hover:text-d-text'
                  >
                    选择已有持卡人
                  </button>
                )}
              </div>
              <input
                type='text'
                placeholder='输入持卡人姓名（如：张三）'
                value={newHolderName}
                onChange={(e) => setNewHolderName(e.target.value)}
                className='h-10 w-full rounded-lg border border-d-border bg-d-surface px-3 text-[14px] text-d-text outline-none focus:border-d-accent'
              />
            </div>
          )}
        </div>

        {/* 4. 账户参数 */}
        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='卡号末4位'
            placeholder='选填'
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/[^\w]/g, '').slice(0, 4))}
          />

          <TextField
            label='信用额度'
            required
            type='number'
            placeholder='50000'
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            startAdornment={<span>¥</span>}
          />
        </div>

        <TextField
          label='每月账单日'
          required
          type='number'
          placeholder='1-31'
          value={billingDay}
          onChange={(e) => setBillingDay(e.target.value)}
          endAdornment={<span>日</span>}
          helperText='每月生成账单的日期'
        />

        {/* 5. 可选自定义还款规则 */}
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
