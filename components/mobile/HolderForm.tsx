// components/mobile/HolderForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box
} from '@mui/material'
import type { CardHolder } from '@/lib/types'

const COLORS = ['#1976d2', '#d32f2f', '#388e3c', '#f57c00', '#7b1fa2', '#00796b']

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
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      // 弹窗浮层：18px 圆角 + float 阴影 + 无边框
      slotProps={{
        paper: {
          sx: {
            border: 0,
            borderRadius: 'var(--radius-depth-3)',
            boxShadow: 'var(--shadow-float)',
          },
        },
      }}
    >
      {/* 弹窗标题：22/28 · 600 · -0.7px */}
      <DialogTitle
        sx={{
          fontSize: 'var(--type-title-size)',
          lineHeight: 'var(--type-title-line)',
          fontWeight: 'var(--type-title-weight)',
          letterSpacing: 'var(--type-title-tracking)',
          color: 'var(--text)',
        }}
      >
        {initial ? '编辑持卡人' : '添加持卡人'}
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="姓名" margin="normal" required
          value={name} onChange={e => setName(e.target.value)}
          autoFocus
        />
        <TextField
          fullWidth label="手机号" margin="normal"
          value={phone} onChange={e => setPhone(e.target.value)}
        />
        <TextField
          fullWidth label="成员账号邮箱（匹配已注册用户后自动绑定）" margin="normal"
          type="email" value={email} onChange={e => setEmail(e.target.value)}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              sx={{
                // 色块选择器不是图标按钮，保持 36px 原尺寸
                width: 36, height: 36, borderRadius: '50%', bgcolor: c, cursor: 'pointer',
                border: '3px solid',
                borderColor: c === color ? 'primary.main' : 'transparent',
                transition: 'border-color 200ms var(--ease-out)',
              }}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ borderRadius: 'var(--radius-pill)' }}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} sx={{ borderRadius: 'var(--radius-pill)' }}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
