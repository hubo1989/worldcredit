// components/mobile/PaymentForm.tsx
'use client'

import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Stack
} from '@mui/material'
import { formatAmount } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { amount: number; paid_at: string; channel: string; note?: string }) => void
  billAmount: number
  paidAmount: number
  currency: string
}

const CHANNELS = ['手动还款', '自动扣款', '银行转账', '支付宝', '微信', '其他']

export function PaymentForm({ open, onClose, onSubmit, billAmount, paidAmount, currency }: Props) {
  const remaining = billAmount - paidAmount
  const [amount, setAmount] = useState(String(remaining))
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split('T')[0])
  const [channel, setChannel] = useState('手动还款')
  const [note, setNote] = useState('')

  const handleSubmit = () => {
    const val = parseFloat(amount)
    if (!val || val <= 0) return
    if (val > remaining) return // Prevent overpayment
    onSubmit({ amount: val, paid_at: paidAt, channel, note: note.trim() || undefined })
    // Reset
    setAmount(String(remaining))
    setNote('')
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>记录还款</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="待还金额" value={formatAmount(remaining, currency)}
            InputProps={{ readOnly: true }} size="small"
          />
          <TextField
            label="还款金额" required value={amount}
            onChange={e => setAmount(e.target.value)}
            type="number" autoFocus
            inputProps={{ min: 0.01, max: remaining, step: 0.01 }}
          />
          <TextField
            label="还款日期" type="date" required value={paidAt}
            onChange={e => setPaidAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            select label="还款渠道" value={channel}
            onChange={e => setChannel(e.target.value)}
          >
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </TextField>
          <TextField
            label="备注" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="可选"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit}>确认还款</Button>
      </DialogActions>
    </Dialog>
  )
}
