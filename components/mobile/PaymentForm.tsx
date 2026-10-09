'use client'

import { useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { amount: number; paid_at: string; note?: string }) => Promise<void>
  totalAmount: number
  billMonth?: string
  /** 调用方可选传入：账单 ID（预留附件场景，当前对话框未使用） */
  billId?: string
  /** 调用方可选传入：附件变更后的刷新回调（预留附件场景，当前未使用） */
  onAttachmentChanged?: () => Promise<void>
}

export function PaymentForm({ open, onClose, onSubmit, totalAmount, billMonth }: Props) {
  const [amount, setAmount] = useState(totalAmount.toString())
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const num = parseFloat(amount)
    if (!num || num <= 0) return

    setSubmitting(true)
    try {
      await onSubmit({
        amount: num,
        paid_at: paidAt,
        note: note.trim() || undefined
      })
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`登记账单还款${billMonth ? ` (${billMonth})` : ''}`}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!amount || parseFloat(amount) <= 0}
          >
            {submitting ? '登记中...' : '确认已还款'}
          </Button>
        </>
      }
    >
      <p className='mb-4 text-[14px] leading-5 text-d-muted'>
        账单总额: ¥{totalAmount.toFixed(2)}
      </p>

      <div className='flex flex-col gap-4'>
        <TextField
          label="还款金额"
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          startAdornment={<span>¥</span>}
          required
        />

        <TextField
          label="还款日期"
          type="date"
          value={paidAt}
          onChange={e => setPaidAt(e.target.value)}
          required
        />

        <TextField
          label="还款备注"
          placeholder="如: 支付宝还款 / 网银转账"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>
    </Modal>
  )
}
