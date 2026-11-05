'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { getHolders, createHolder } from '@/lib/api/holders'
import { updateCard, updateCardHolder, type CreditCardWithProduct } from '@/lib/api/cards'
import { getEffectiveCreditLimit, getEffectiveBillingDay } from '@/lib/utils'
import { currencySymbol } from '@/lib/fx'
import type { CardHolder } from '@/lib/types'
import {
  validateBillingDay,
  resolveLimitOnEdit,
  parseLast4,
  DEFAULT_HOLDER_AVATAR_COLOR,
} from './card-form-shared'

interface Props {
  open: boolean
  onClose: () => void
  card: CreditCardWithProduct
  onSaved: () => void
}

export function CardAccountModal({ open, onClose, card, onSaved }: Props) {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [selectedHolderId, setSelectedHolderId] = useState<string>('')
  const [isCreatingHolder, setIsCreatingHolder] = useState(false)
  const [newHolderName, setNewHolderName] = useState('')

  const [last4, setLast4] = useState<string>('')
  const [limit, setLimit] = useState<string>('')
  const [billingDay, setBillingDay] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cardCurrency = card.card_product?.currency || 'CNY'
  const curSymbol = currencySymbol(cardCurrency)

  useEffect(() => {
    if (!open) return
    setError(null)
    setIsCreatingHolder(false)
    setNewHolderName('')

    setSelectedHolderId(card.holder_id)
    setLast4(card.card_number_last4 ?? '')

    const effLimit = getEffectiveCreditLimit(card)
    setLimit(effLimit != null ? String(effLimit) : '')

    const effDay = getEffectiveBillingDay(card)
    setBillingDay(effDay != null ? String(effDay) : '')

    getHolders()
      .then(setHolders)
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载持卡人失败')
      })
  }, [open, card])

  const handleSubmit = async () => {
    setError(null)

    // 1. 本地字段校验先行（Finding 5, 8, 11）
    if (isCreatingHolder) {
      if (!newHolderName.trim()) {
        setError('请输入持卡人姓名')
        return
      }
    } else if (!selectedHolderId) {
      setError('请选择或新建持卡人')
      return
    }

    const dayCheck = validateBillingDay(billingDay)
    if (!dayCheck.valid) {
      setError(dayCheck.error || '每月账单日必须在 1 到 31 之间')
      return
    }

    const limitCheck = resolveLimitOnEdit(limit)
    if (!limitCheck.valid) {
      setError(limitCheck.error || '信用额度必须为非负数')
      return
    }

    const last4Check = parseLast4(last4)
    if (!last4Check.valid) {
      setError(last4Check.error || '卡号尾号必须为 1 到 4 位数字')
      return
    }

    setSubmitting(true)

    // 2. 全部校验通过后再创建持卡人，并立即退出创建态（Finding 5, 12）
    let finalHolderId = selectedHolderId
    if (isCreatingHolder) {
      try {
        const created = await createHolder({
          name: newHolderName.trim(),
          avatar_color: DEFAULT_HOLDER_AVATAR_COLOR,
        })
        finalHolderId = created.id
        setSelectedHolderId(created.id)
        setIsCreatingHolder(false)
        setNewHolderName('')
        setHolders(prev => [created, ...prev])
      } catch (err) {
        setError(err instanceof Error ? err.message : '创建持卡人失败')
        setSubmitting(false)
        return
      }
    }

    // 3. 执行更新，妥善处理第二步失败时的半提交状态（Finding 10, 11）
    let holderUpdated = false
    try {
      if (finalHolderId !== card.holder_id) {
        await updateCardHolder(card.id, finalHolderId)
        holderUpdated = true
      }

      await updateCard(card.id, {
        card_number_last4: last4Check.value,
        credit_limit: limitCheck.credit_limit,
        credit_limit_override: limitCheck.credit_limit_override,
        billing_day: dayCheck.value,
      })

      onSaved()
      onClose()
    } catch (err) {
      if (holderUpdated) {
        setError('持卡人已变更，但卡片其余字段保存失败：' + (err instanceof Error ? err.message : String(err)))
      } else {
        setError(err instanceof Error ? err.message : '保存失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title='修改账单信息（人+卡）'
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={submitting}>
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

        {/* 持卡人选择与内联创建 */}
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
                <button
                  type='button'
                  onClick={() => setIsCreatingHolder(false)}
                  className='text-[12px] font-semibold text-d-muted hover:text-d-text'
                >
                  返回选择
                </button>
              </div>
              <input
                type='text'
                placeholder='输入持卡人姓名'
                value={newHolderName}
                onChange={(e) => setNewHolderName(e.target.value)}
                className='h-10 w-full rounded-lg border border-d-border bg-d-surface px-3 text-[14px] text-d-text outline-none focus:border-d-accent'
              />
            </div>
          )}
        </div>

        {/* 卡片尾号 */}
        <TextField
          label='卡片尾号'
          placeholder='例如：8888（选填）'
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/[^\w]/g, '').slice(0, 4))}
          helperText='建议填写后 4 位，方便核对账单'
        />

        {/* 信用额度 */}
        <TextField
          label='信用额度'
          type='number'
          placeholder='例如：50000'
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          startAdornment={<span>{curSymbol}</span>}
          helperText='单张卡信用额度'
        />

        {/* 每月账单日 */}
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
      </div>
    </Modal>
  )
}
