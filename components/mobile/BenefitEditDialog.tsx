'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import type { Benefit } from '@/lib/types'

interface BenefitEditDialogProps {
  open: boolean
  cardProductId: string
  benefit?: Benefit | null
  onClose: () => void
  onSaved: () => void
  onSave: (data: Omit<Benefit, 'id' | 'created_at'>) => Promise<void>
}

export function BenefitEditDialog({
  open,
  cardProductId,
  benefit,
  onClose,
  onSaved,
  onSave
}: BenefitEditDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quota, setQuota] = useState(1)
  const [period, setPeriod] = useState<'yearly' | 'monthly' | 'one_time'>('yearly')
  const [resetMonth, setResetMonth] = useState<number>(1)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (benefit) {
      setName(benefit.name || '')
      setDescription(benefit.description || '')
      setQuota(benefit.quota || 1)
      setPeriod(benefit.period || 'yearly')
      setResetMonth(benefit.reset_month || 1)
    } else {
      setName('')
      setDescription('')
      setQuota(1)
      setPeriod('yearly')
      setResetMonth(1)
    }
  }, [benefit, open])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSave({
        card_product_id: cardProductId,
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={benefit ? '编辑卡片权益' : '新增专属权益'}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!name.trim()}>
            {submitting ? '保存中...' : '保存权益'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
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
