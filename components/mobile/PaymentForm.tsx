'use client'

import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, InputAdornment, Stack, Typography, CircularProgress
} from '@mui/material'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { amount: number; paid_at: string; note?: string }) => Promise<void>
  totalAmount: number
  billMonth?: string
  /** 调用方可选传入：账单 ID（预留附件场景，当前对话框未使用） */
  billId?: string
  /** 调用方可选传入：附件变更后的刷新回调（预留附件场景，当前未使用） */
  onAttachmentChanged?: () => Promise<void>
}

export function PaymentForm({ open, onClose, onSubmit, totalAmount, billMonth }: Props) {
  const [amount, setAmount] = useState(totalAmount.toString())
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const num = parseFloat(amount)
    if (!num || num <= 0) return

    setSubmitting(true)
    try {
      await onSubmit({
        amount: num,
        paid_at: paidAt,
        note: note.trim() || undefined
      })
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
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
        登记账单还款 {billMonth ? `(${billMonth})` : ''}
      </DialogTitle>
      <DialogContent>
        <Typography
          sx={{
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-line)',
            fontWeight: 'var(--type-body-weight)',
            letterSpacing: 'var(--type-body-tracking)',
            // 次要说明文字
            color: 'var(--muted)',
            mb: 2,
          }}
        >
          账单总额: ¥{totalAmount.toFixed(2)}
        </Typography>

        <Stack spacing={2}>
          <TextField
            fullWidth
            label="还款金额"
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
            }}
            required
          />

          <TextField
            fullWidth
            label="还款日期"
            type="date"
            value={paidAt}
            onChange={e => setPaidAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            required
          />

          <TextField
            fullWidth
            label="还款备注"
            placeholder="如: 支付宝还款 / 网银转账"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} color="inherit" sx={{ borderRadius: 'var(--radius-pill)' }}>取消</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !amount || parseFloat(amount) <= 0}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ borderRadius: 'var(--radius-pill)' }}
        >
          {submitting ? '登记中...' : '确认已还款'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
