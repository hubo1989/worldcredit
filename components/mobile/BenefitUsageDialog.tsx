'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button,
} from '@mui/material'
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
        记录权益使用
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="使用日期" margin="normal"
          type="date"
          value={usedAt}
          onChange={e => setUsedAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          required
        />
        <TextField
          fullWidth label="备注" margin="normal"
          multiline rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="如：用于北京首都机场T3"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ borderRadius: 'var(--radius-pill)' }}>取消</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!usedAt}
          sx={{ borderRadius: 'var(--radius-pill)' }}
        >
          记录
        </Button>
      </DialogActions>
    </Dialog>
  )
}
