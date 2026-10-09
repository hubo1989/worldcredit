// components/mobile/HolderForm.tsx
'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import type { CardHolder } from '@/lib/types'

// 暗色底上可辨的持卡人色板（原 MUI 亮色色板在 #131a2a 面板上发灰）。
const COLORS = ['#7aadff', '#ff8a8a', '#6ee7a0', '#ffc46b', '#c4a5ff', '#5fd4d0']

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { name: string; phone?: string; email?: string; avatar_color: string }) => void
  initial?: CardHolder
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setPhone(initial?.phone ?? '')
      setEmail(initial?.email ?? '')
      setColor(initial?.avatar_color ?? COLORS[0])
    }
  }, [open, initial])

  const handleSubmit = () => {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, avatar_color: color })
    onClose()
  }

  return (
    <Modal
      open={open}
      title={initial ? '编辑持卡人' : '添加持卡人'}
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>保存</Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <TextField
          label='姓名' required
          value={name} onChange={e => setName(e.target.value)}
          autoFocus
        />
        <TextField
          label='手机号'
          value={phone} onChange={e => setPhone(e.target.value)}
        />
        <TextField
          label='邮箱（选填，仅作记录）'
          type='email' value={email} onChange={e => setEmail(e.target.value)}
        />
        <div className='flex flex-wrap gap-2.5 pt-1'>
          {COLORS.map(c => (
            <button
              key={c}
              type='button'
              aria-label={`选择颜色 ${c}`}
              onClick={() => setColor(c)}
              className='h-9 w-9 rounded-full transition-[box-shadow] '
              style={{
                backgroundColor: c,
                // 选中态用同色外环，避免亮色 border token 在暗底上突兀
                boxShadow: c === color ? `0 0 0 3px var(--color-d-surface), 0 0 0 5px ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}
