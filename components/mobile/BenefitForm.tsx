'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { format } from 'date-fns'
import type { Benefit } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Benefit, 'id' | 'created_at'>) => void
  initial?: Benefit
}

const PERIOD_OPTIONS = [
  { value: 'yearly', label: '按年' },
  { value: 'monthly', label: '按月' },
  { value: 'one_time', label: '一次性' },
]

export function BenefitForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quota, setQuota] = useState(1)
  const [period, setPeriod] = useState<Benefit['period']>('one_time')
  const [resetMonth, setResetMonth] = useState<number | undefined>(undefined)
  const [expiryDate, setExpiryDate] = useState('')

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setDescription(initial?.description ?? '')
      setQuota(initial?.quota ?? 1)
      setPeriod(initial?.period ?? 'one_time')
      setResetMonth(initial?.reset_month)
      setExpiryDate(initial?.expiry_date ?? '')
    }
  }, [open, initial])

  const isValid = () => {
    if (!name.trim()) return false
    if (quota <= 0) return false
    if (period === 'yearly' && (resetMonth === undefined || resetMonth < 1 || resetMonth > 12)) {
      return false
    }
    return true
  }

  const handleSubmit = () => {
    if (!isValid()) return
    onSubmit({
      card_product_id: initial?.card_product_id ?? '',
      name: name.trim(),
      description: description.trim() || undefined,
      quota,
      period,
      reset_month: period === 'yearly' ? resetMonth : undefined,
      expiry_date: expiryDate || undefined,
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑权益' : '添加权益'}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={!isValid()}>
            保存
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <TextField
          label="权益名称"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：机场贵宾厅、接送机"
          required
        />
        <TextArea
          label="权益说明"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="权益的具体说明"
        />
        <TextField
          label="总额度"
          type="number"
          value={quota}
          onChange={e => setQuota(Math.max(1, Number(e.target.value)))}
          min={1}
          step={1}
          required
        />
        <SelectField
          label="周期"
          value={period}
          onChange={e => setPeriod(e.target.value as Benefit['period'])}
          options={PERIOD_OPTIONS}
        />
        {period === 'yearly' && (
          <TextField
            label="重置月份"
            type="number"
            value={resetMonth ?? ''}
            onChange={e => setResetMonth(e.target.value ? Number(e.target.value) : undefined)}
            min={1}
            max={12}
            placeholder="1-12"
            required
          />
        )}
        <TextField
          label="到期日"
          type="date"
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
          min={format(new Date(), 'yyyy-MM-dd')}
        />
      </div>
    </Modal>
  )
}
