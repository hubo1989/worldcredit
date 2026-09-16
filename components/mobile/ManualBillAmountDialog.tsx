'use client'

import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Stack, Typography, Alert, InputAdornment,
} from '@mui/material'
import { setCardManualBillAmount } from '@/lib/api/bills'
import { currencySymbol } from '@/lib/fx'
import { format } from 'date-fns'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  cardId: string | null
  /** 卡名 + 尾号，用于确认改的是哪张卡 */
  cardLabel: string
  currency: string
  /** 当前生效金额（手填值优先）；用于预填输入框 */
  currentAmount: number
  /** 是否已经手填过（决定按钮文案与文案提示） */
  isPinned: boolean
}

/**
 * 手动填写账单金额。
 *
 * 手填值优先于一切导入来源（邮件解析 / Gmail 同步 / LLM 抽取）——导入方只写
 * bills.bill_amount，手填写的是 bills.bill_amount_override，两者都保留，
 * 因此这里填完之后，下一封账单邮件不会把用户的数字改掉。
 */
export function ManualBillAmountDialog({
  open, onClose, onSuccess, cardId, cardLabel, currency, currentAmount, isPinned,
}: Props) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(currentAmount > 0 ? String(currentAmount) : '')
    setError(null)
  }, [open, currentAmount])

  const handleSubmit = async () => {
    if (!cardId) return
    setError(null)
    const amount = parseFloat(value)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('请输入不小于 0 的金额')
      return
    }
    setSubmitting(true)
    try {
      await setCardManualBillAmount(cardId, amount)
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 'var(--type-section-size)' }}>
        {isPinned ? '修改账单金额' : '填写账单金额'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography className="type-label">
            {cardLabel} · {format(new Date(), 'yyyy-MM')} 账期
          </Typography>
          <TextField
            autoFocus
            fullWidth
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder="0.00"
            InputProps={{
              startAdornment: <InputAdornment position="start">{currencySymbol(currency)}</InputAdornment>,
            }}
            inputProps={{ inputMode: 'decimal', min: 0, step: '0.01' }}
          />
          {/* 说清优先级，避免用户以为下次导入会覆盖它（或反过来以为它不会生效） */}
          <Alert severity="info" sx={{ borderRadius: 'var(--radius-depth-1)' }}>
            手动填写的金额优先级最高；邮件导入、Gmail 同步得到的金额不会覆盖它。
          </Alert>
          {error && <Alert severity="error" sx={{ borderRadius: 'var(--radius-depth-1)' }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={submitting}>取消</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          sx={{ fontWeight: 700, borderRadius: 'var(--radius-pill)', textTransform: 'none' }}
        >
          {submitting ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
