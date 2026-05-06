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
  onSubmit: (data: { name: string; phone?: string; avatar_color: string }) => void
  initial?: CardHolder
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setPhone(initial?.phone ?? '')
      setColor(initial?.avatar_color ?? COLORS[0])
    }
  }, [open, initial])

  const handleSubmit = () => {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), phone: phone.trim() || undefined, avatar_color: color })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑持卡人' : '添加持卡人'}</DialogTitle>
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
        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              sx={{
                width: 36, height: 36, borderRadius: '50%', bgcolor: c, cursor: 'pointer',
                border: c === color ? '3px solid #000' : '3px solid transparent',
                transition: 'border 0.2s',
              }}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}
