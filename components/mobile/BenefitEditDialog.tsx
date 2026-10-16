'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import type { Benefit } from '@/lib/types'

export interface BenefitProductOption {
  id: string
  bank_name: string
  card_name: string
}

interface BenefitEditDialogProps {
  open: boolean
  /** 目标产品初始值；编辑既有权益时为其归属产品。 */
  cardProductId: string
  /** 用户真实持有的卡对应的产品列表（P0：不再从权益记录反猜目标卡）。 */
  products: BenefitProductOption[]
  benefit?: Benefit | null
  onClose: () => void
  onSaved: () => void
  onSave: (data: Omit<Benefit, 'id' | 'created_at'>) => Promise<void>
}

export function BenefitEditDialog({
  open,
  cardProductId,
  products,
  benefit,
  onClose,
  onSaved,
  onSave
}: BenefitEditDialogProps) {
  const [productId, setProductId] = useState(cardProductId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quota, setQuota] = useState(1)
  const [period, setPeriod] = useState<'yearly' | 'monthly' | 'one_time'>('yearly')
  const [resetMonth, setResetMonth] = useState<number>(1)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (benefit) {
      setProductId(benefit.card_product_id)
      setName(benefit.name || '')
      setDescription(benefit.description || '')
      setQuota(benefit.quota || 1)
      setPeriod(benefit.period || 'yearly')
      setResetMonth(benefit.reset_month || 1)
    } else {
      setProductId(cardProductId || products[0]?.id || '')
      setName('')
      setDescription('')
      setQuota(1)
      setPeriod('yearly')
      setResetMonth(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benefit, open])

  const handleSubmit = async () => {
    if (!name.trim() || !productId) return
    setSubmitting(true)
    try {
      await onSave({
        card_product_id: productId,
        name: name.trim(),
        description: description.trim() || undefined,
        quota: Number(quota) || 1,
        period,
        reset_month: period === 'yearly' ? Number(resetMonth) : undefined
      })
      onSaved()
      onClose()
    } catch (err) {
      alert('保存权益失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!name.trim() && !!productId

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={benefit ? '编辑卡片权益' : '新增专属权益'}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!canSubmit}>
            {submitting ? '保存中...' : '保存权益'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <SelectField
          label='适用卡片产品'
          required
          value={productId}
          onChange={e => setProductId(e.target.value)}
          options={products.map(p => ({
            value: p.id,
            label: `${p.bank_name} · ${p.card_name}`,
          }))}
        />
        <TextField
          label="权益名称"
          required
          placeholder="例如: 每年免费机场接送"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <TextArea
          label="权益描述说明"
          placeholder="例如: 境内指定机场接送机服务，每年2次"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <div className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <TextField
              label="享用额度(次数)"
              type="number"
              value={quota}
              onChange={e => setQuota(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <div className='w-40 shrink-0'>
            <SelectField
              label="周期类型"
              value={period}
              onChange={e => setPeriod(e.target.value as 'yearly' | 'monthly' | 'one_time')}
              options={[
                { value: 'yearly', label: '每年 (Yearly)' },
                { value: 'monthly', label: '每月 (Monthly)' },
                { value: 'one_time', label: '一次性 (One Time)' },
              ]}
            />
          </div>
        </div>

        {period === 'yearly' && (
          <SelectField
            label="年度重置月份"
            value={resetMonth}
            onChange={e => setResetMonth(Number(e.target.value))}
            options={Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({
              value: String(m),
              label: `${m} 月重置`,
            }))}
          />
        )}
      </div>
    </Modal>
  )
}
