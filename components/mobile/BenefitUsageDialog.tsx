// components/mobile/BenefitUsageDialog.tsx
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>记录权益使用</DialogTitle>
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
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!usedAt}>记录</Button>
      </DialogActions>
    </Dialog>
  )
}
