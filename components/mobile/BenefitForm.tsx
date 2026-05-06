// components/mobile/BenefitForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Typography,
} from '@mui/material'
import { format } from 'date-fns'
import type { Benefit } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Benefit, 'id' | 'created_at'>) => void
  initial?: Benefit
}

const PERIOD_OPTIONS = [
  { value: 'yearly', label: '按年' },
  { value: 'monthly', label: '按月' },
  { value: 'one_time', label: '一次性' },
]

export function BenefitForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quota, setQuota] = useState(1)
  const [period, setPeriod] = useState<Benefit['period']>('one_time')
  const [resetMonth, setResetMonth] = useState<number | undefined>(undefined)
  const [expiryDate, setExpiryDate] = useState('')

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setDescription(initial?.description ?? '')
      setQuota(initial?.quota ?? 1)
      setPeriod(initial?.period ?? 'one_time')
      setResetMonth(initial?.reset_month)
      setExpiryDate(initial?.expiry_date ?? '')
    }
  }, [open, initial])

  const isValid = () => {
    if (!name.trim()) return false
    if (quota <= 0) return false
    if (period === 'yearly' && (resetMonth === undefined || resetMonth < 1 || resetMonth > 12)) {
      return false
    }
    return true
  }

  const handleSubmit = () => {
    if (!isValid()) return
    onSubmit({
      card_id: initial?.card_id ?? '',
      name: name.trim(),
      description: description.trim() || undefined,
      quota,
      period,
      reset_month: period === 'yearly' ? resetMonth : undefined,
      expiry_date: expiryDate || undefined,
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑权益' : '添加权益'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="权益名称" margin="normal"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：机场贵宾厅、接送机"
          required
        />
        <TextField
          fullWidth label="权益说明" margin="normal"
          multiline rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="权益的具体说明"
        />
        <TextField
          fullWidth label="总额度" margin="normal"
          type="number"
          value={quota}
          onChange={e => setQuota(Math.max(1, Number(e.target.value)))}
          inputProps={{ min: 1, step: 1 }}
          required
        />
        <FormControl fullWidth margin="normal">
          <InputLabel>周期</InputLabel>
          <Select
            value={period}
            onChange={e => setPeriod(e.target.value as Benefit['period'])}
            label="周期"
          >
            {PERIOD_OPTIONS.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {period === 'yearly' && (
          <TextField
            fullWidth label="重置月份" margin="normal"
            type="number"
            value={resetMonth ?? ''}
            onChange={e => setResetMonth(e.target.value ? Number(e.target.value) : undefined)}
            inputProps={{ min: 1, max: 12 }}
            placeholder="1-12"
            required
          />
        )}
        <TextField
          fullWidth label="到期日" margin="normal"
          type="date"
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: format(new Date(), 'yyyy-MM-dd') }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}
