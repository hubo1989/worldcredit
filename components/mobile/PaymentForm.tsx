// components/mobile/PaymentForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, Typography,
} from '@mui/material'
import { format } from 'date-fns'
import type { Bill } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { amount: number; paid_at: string; note?: string; channel: string }) => void
  bill: Bill
}

export function PaymentForm({ open, onClose, onSubmit, bill }: Props) {
  const [amount, setAmount] = useState(0)
  const [paidAt, setPaidAt] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [channel, setChannel] = useState('手动还款')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setAmount(0)
      setPaidAt(format(new Date(), 'yyyy-MM-dd'))
      setChannel('手动还款')
      setNote('')
    }
  }, [open])

  const isValid = () => amount > 0 && paidAt.match(/^\d{4}-\d{2}-\d{2}$/)

  const handleSubmit = () => {
    if (!isValid()) return
    onSubmit({
      amount,
      paid_at: paidAt,
      channel,
      note: note.trim() || undefined,
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>记录还款</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.100', borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary">
            账单金额: ¥{Number(bill.bill_amount).toFixed(2)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            账单月份: {bill.bill_month}
          </Typography>
        </Box>

        <TextField
          fullWidth label="还款金额" margin="normal"
          type="number" value={amount}
          onChange={e => setAmount(Math.max(0, Number(e.target.value)))}
          inputProps={{ min: 0, step: 0.01 }}
          autoFocus
        />
        <TextField
          fullWidth label="还款日期" margin="normal"
          type="date" value={paidAt}
          onChange={e => setPaidAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          fullWidth label="还款渠道" margin="normal"
          value={channel}
          onChange={e => setChannel(e.target.value)}
          placeholder="如：手动还款、自动扣款"
        />
        <TextField
          fullWidth label="备注" margin="normal"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="可选"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>
          确认还款
        </Button>
      </DialogActions>
    </Dialog>
  )
}
