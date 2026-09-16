'use client'

import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, MenuItem, Stack, Alert, InputAdornment, Typography,
} from '@mui/material'
import { createRecurringPayable, updateRecurringPayable, PAYABLE_CATEGORIES, type PayableCategory, type PayableWithStatus } from '@/lib/api/payables'
import { getHolders } from '@/lib/api/holders'
import type { CardHolder } from '@/lib/types'
import { useAuth } from '@/lib/auth'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  /** 传入则为编辑模式 */
  existing?: PayableWithStatus | null
}

/**
 * 新增/编辑周期性固定支出（房租、贷款等按月应付）。
 *
 * 有意不复用 BillForm：账单的 card_id 是必填外键，房租没有卡。塞进信用卡账单
 * 会污染卡数、额度与免息期口径（见 migrations/d1/0009）。
 */
export function PayableForm({ open, onClose, onSuccess, existing }: Props) {
  const { user } = useAuth()
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [name, setName] = useState('')
  const [category, setCategory] = useState<PayableCategory>('rent')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [dueDay, setDueDay] = useState('')
  const [holderId, setHolderId] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    getHolders().then(setHolders).catch(() => setHolders([]))
  }, [open])

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existing) {
      setName(existing.name)
      setCategory(existing.category)
      setAmount(String(existing.amount))
      setCurrency(existing.currency)
      setDueDay(String(existing.due_day))
      setHolderId(existing.holder_id || '')
      setNote(existing.note || '')
    } else {
      setName('')
      setCategory('rent')
      setAmount('')
      setCurrency('CNY')
      setDueDay('')
      setHolderId('')
      setNote('')
    }
  }, [open, existing])

  const handleSubmit = async () => {
    setError(null)
    const parsedAmount = parseFloat(amount)
    const parsedDay = parseInt(dueDay, 10)
    if (!name.trim()) return setError('请填写名称')
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) return setError('金额必须是不小于 0 的数字')
    if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      return setError('每月应付日必须在 1–31 之间')
    }

    setSubmitting(true)
    try {
      const payload = {
        name: name.trim(),
        category,
        amount: parsedAmount,
        currency,
        due_day: parsedDay,
        holder_id: holderId || null,
        note: note.trim() || null,
      }
      if (existing) await updateRecurringPayable(existing.id, payload)
      // created_by 会在服务端按会话 cookie 覆盖，这里带上只是满足入参形状
      else await createRecurringPayable({ ...payload, created_by: user?.id ?? '' })
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
        {existing ? '编辑固定支出' : '添加固定支出'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            autoFocus
            fullWidth
            label="名称"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="如：房租、房贷"
          />
          <TextField
            select
            fullWidth
            label="类型"
            value={category}
            onChange={e => setCategory(e.target.value as PayableCategory)}
          >
            {PAYABLE_CATEGORIES.map(c => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1.5}>
            <TextField
              fullWidth
              type="number"
              label="每月金额"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start">{currency === 'USD' ? 'US$' : currency === 'HKD' ? 'HK$' : '¥'}</InputAdornment> }}
              inputProps={{ inputMode: 'decimal', min: 0, step: '0.01' }}
            />
            <TextField
              select
              label="币种"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              sx={{ minWidth: 96 }}
            >
              {['CNY', 'USD', 'HKD'].map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField
            fullWidth
            type="number"
            label="每月应付日"
            value={dueDay}
            onChange={e => setDueDay(e.target.value)}
            placeholder="1–31"
            helperText="超过当月天数时按月最后一天计算"
            inputProps={{ inputMode: 'numeric', min: 1, max: 31 }}
          />
          {holders.length > 0 && (
            <TextField
              select
              fullWidth
              label="归属（可选）"
              value={holderId}
              onChange={e => setHolderId(e.target.value)}
            >
              <MenuItem value="">不指定</MenuItem>
              {holders.map(h => <MenuItem key={h.id} value={h.id}>{h.name}</MenuItem>)}
            </TextField>
          )}
          <TextField
            fullWidth
            label="备注（可选）"
            value={note}
            onChange={e => setNote(e.target.value)}
            multiline
            minRows={2}
          />
          {/* 与卡账分开是刻意的，说清楚避免用户以为「没进账单就是没生效」 */}
          <Typography className="type-label">
            固定支出不占用信用卡额度，单独计入每月应付；与卡账分开统计。
          </Typography>
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
