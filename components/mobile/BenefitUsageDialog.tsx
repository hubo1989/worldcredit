'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea } from '@/components/obsidian/fields'
import { format } from 'date-fns'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { used_at: string; note?: string }) => void
}

export function BenefitUsageDialog({ open, onClose, onSubmit }: Props) {
  const [usedAt, setUsedAt] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setUsedAt(format(new Date(), 'yyyy-MM-dd'))
      setNote('')
    }
  }, [open])

  const handleSubmit = () => {
    if (!usedAt) return
    onSubmit({
      used_at: usedAt,
      note: note.trim() || undefined,
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      title='记录权益使用'
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={!usedAt}>记录</Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <TextField
          label='使用日期' required
          type='date'
          value={usedAt}
          onChange={e => setUsedAt(e.target.value)}
        />
        <TextArea
          label='备注'
          rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder='如：用于北京首都机场T3'
        />
      </div>
    </Modal>
  )
}
