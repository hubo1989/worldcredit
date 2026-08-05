'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, Typography, Stack
} from '@mui/material'
import type { CardHolder } from '@/lib/types'

const COLORS = [
  '#1976d2', // Blue
  '#d32f2f', // Red
  '#388e3c', // Green
  '#f57c00', // Orange
  '#7b1fa2', // Purple
  '#00796b', // Teal
  '#607d8b', // Blue Grey
]

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { name: string; phone?: string; avatar_color: string }) => Promise<void>
  initial?: CardHolder
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])
  const [submitting, setSubmitting] = useState(false)

  // 当 initial 改变时重置表单（用于编辑模式）
  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setPhone(initial.phone ?? '')
      setColor(initial.avatar_color)
    } else {
      setName('')
      setPhone('')
      setColor(COLORS[0])
    }
  }, [initial, open])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ 
        name: name.trim(), 
        phone: phone.trim() || undefined, 
        avatar_color: color 
      })
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle fontWeight={700}>
        {initial ? '编辑持卡人' : '添加持卡人'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            fullWidth
            label="姓名"
            placeholder="例如：张三"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <TextField
            fullWidth
            label="手机号"
            placeholder="选填"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">
              选择头像颜色
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.5 }}>
              {COLORS.map(c => (
                <Box
                  key={c}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: c,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid',
                    borderColor: c === color ? 'text.primary' : 'transparent',
                    transition: 'all 0.2s',
                    '&:hover': { transform: 'scale(1.1)' }
                  }}
                />
              ))}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} color="inherit">取消</Button>
        <Button 
          variant="contained" 
          onClick={handleSubmit} 
          disabled={submitting || !name.trim()}
        >
          {submitting ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
