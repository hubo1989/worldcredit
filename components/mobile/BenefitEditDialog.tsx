'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  MenuItem,
  Select,
  FormControl,
  InputLabel
} from '@mui/material'
import type { Benefit } from '@/lib/types'

interface BenefitEditDialogProps {
  open: boolean
  cardProductId: string
  benefit?: Benefit | null
  onClose: () => void
  onSaved: () => void
  onSave: (data: Omit<Benefit, 'id' | 'created_at'>) => Promise<void>
}

export function BenefitEditDialog({
  open,
  cardProductId,
  benefit,
  onClose,
  onSaved,
  onSave
}: BenefitEditDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quota, setQuota] = useState(1)
  const [period, setPeriod] = useState<'yearly' | 'monthly' | 'one_time'>('yearly')
  const [resetMonth, setResetMonth] = useState<number>(1)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (benefit) {
      setName(benefit.name || '')
      setDescription(benefit.description || '')
      setQuota(benefit.quota || 1)
      setPeriod(benefit.period || 'yearly')
      setResetMonth(benefit.reset_month || 1)
    } else {
      setName('')
      setDescription('')
      setQuota(1)
      setPeriod('yearly')
      setResetMonth(1)
    }
  }, [benefit, open])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSave({
        card_product_id: cardProductId,
        name: name.trim(),
        description: description.trim() || undefined,
        quota: Number(quota) || 1,
        period,
        reset_month: period === 'yearly' ? Number(resetMonth) : undefined
      })
      onSaved()
      onClose()
    } catch (err) {
      alert('保存权益失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{benefit ? '编辑卡片权益' : '新增专属权益'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="权益名称 *"
            placeholder="例如: 每年免费机场接送"
            fullWidth
            size="small"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <TextField
            label="权益描述说明"
            placeholder="例如: 境内指定机场接送机服务，每年2次"
            fullWidth
            multiline
            rows={2}
            size="small"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="享用额度(次数)"
              type="number"
              size="small"
              fullWidth
              value={quota}
              onChange={e => setQuota(Math.max(1, Number(e.target.value)))}
            />
            <FormControl fullWidth size="small">
              <InputLabel>周期类型</InputLabel>
              <Select
                value={period}
                label="周期类型"
                onChange={e => setPeriod(e.target.value as 'yearly' | 'monthly' | 'one_time')}
              >
                <MenuItem value="yearly">每年 (Yearly)</MenuItem>
                <MenuItem value="monthly">每月 (Monthly)</MenuItem>
                <MenuItem value="one_time">一次性 (One Time)</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {period === 'yearly' && (
            <FormControl fullWidth size="small">
              <InputLabel>年度重置月份</InputLabel>
              <Select
                value={resetMonth}
                label="年度重置月份"
                onChange={e => setResetMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <MenuItem key={m} value={m}>{m} 月重置</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || !name.trim()}>
          {submitting ? '保存中...' : '保存权益'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
