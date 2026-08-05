'use client'

import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, InputAdornment, Stack,
  Alert, Divider
} from '@mui/material'
import { format } from 'date-fns'
import { BillAttachments } from './BillAttachments'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { amount: number; paid_at: string; note?: string }) => Promise<void>
  totalAmount: number
  billMonth: string
  billId?: string
  onAttachmentChanged?: () => void
}

export function PaymentForm({ open, onClose, onSubmit, totalAmount, billMonth, billId, onAttachmentChanged }: Props) {
  const [amount, setAmount] = useState(totalAmount.toString())
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!amount || !date) return
    setSubmitting(true)
    try {
      await onSubmit({
        amount: parseFloat(amount),
        paid_at: date,
        note: remarks || undefined
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
        还款登记 ({billMonth} 账单)
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info" sx={{ mb: 1 }}>
            应还总额：¥{totalAmount.toLocaleString()}
          </Alert>

          <TextField
            fullWidth
            label="还款金额"
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
            }}
          />

          <TextField
            fullWidth
            label="还款日期"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            fullWidth
            label="备注"
            multiline
            rows={2}
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="例如：微信支付、工行卡转账"
          />

          {billId && (
            <>
              <Divider />
              <BillAttachments billId={billId} onChanged={onAttachmentChanged} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} color="inherit">取消</Button>
        <Button 
          variant="contained" 
          onClick={handleSubmit} 
          disabled={submitting || !amount || !date}
        >
          {submitting ? '登记中...' : '确认还款'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
