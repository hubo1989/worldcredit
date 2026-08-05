// components/mobile/CardForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, MenuItem, FormControl, InputLabel, Select
} from '@mui/material'
import type { CreditCard } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<CreditCard, 'id' | 'created_at'>) => void
  initial?: CreditCard
  holderId: string
}

export function CardForm({ open, onClose, onSubmit, initial, holderId }: Props) {
  const [bankName, setBankName] = useState(initial?.bank_name ?? '')
  const [cardName, setCardName] = useState(initial?.card_name ?? '')
  const [last4, setLast4] = useState(initial?.card_number_last4 ?? '')
  const [limit, setLimit] = useState(initial?.credit_limit ?? 0)
  const [currency, setCurrency] = useState(initial?.currency ?? 'CNY')
  const [billingDay, setBillingDay] = useState(initial?.billing_day ?? 1)
  const [dueType, setDueType] = useState(initial?.payment_due_type ?? 'after_billing')
  const [dueValue, setDueValue] = useState(initial?.payment_due_value ?? 20)
  const [annualFee, setAnnualFee] = useState(initial?.annual_fee ?? 0)
  const [annualFeeWaiver, setAnnualFeeWaiver] = useState(initial?.annual_fee_waiver ?? '')

  // 编辑模式下同步状态
  useEffect(() => {
    if (open) {
      setBankName(initial?.bank_name ?? '')
      setCardName(initial?.card_name ?? '')
      setLast4(initial?.card_number_last4 ?? '')
      setLimit(initial?.credit_limit ?? 0)
      setCurrency(initial?.currency ?? 'CNY')
      setBillingDay(initial?.billing_day ?? 1)
      setDueType(initial?.payment_due_type ?? 'after_billing')
      setDueValue(initial?.payment_due_value ?? 20)
      setAnnualFee(initial?.annual_fee ?? 0)
      setAnnualFeeWaiver(initial?.annual_fee_waiver ?? '')
    }
  }, [open, initial])

  const isValid = () => {
    if (!bankName.trim()) return false
    if (!cardName.trim()) return false
    if (limit < 0) return false
    if (billingDay < 1 || billingDay > 31) return false
    if (last4 && last4.length !== 4) return false
    if (dueValue < 1) return false
    return true
  }

  const handleSubmit = () => {
    if (!isValid()) return
    onSubmit({
      holder_id: holderId,
      country: 'CN',
      bank_name: bankName.trim(),
      card_name: cardName.trim(),
      card_number_last4: last4 || undefined,
      credit_limit: limit,
      currency,
      billing_day: billingDay,
      payment_due_type: dueType,
      payment_due_value: dueValue,
      annual_fee: annualFee,
      annual_fee_waiver: annualFeeWaiver.trim() || undefined,
      status: initial?.status ?? 'active'
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑信用卡' : '添加信用卡'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="银行名称" margin="normal" value={bankName}
          onChange={e => setBankName(e.target.value)} required autoFocus
          error={!bankName.trim()} helperText={!bankName.trim() ? '必填' : ''}
        />
        <TextField
          fullWidth label="卡片名称" margin="normal" value={cardName}
          onChange={e => setCardName(e.target.value)} required
          error={!cardName.trim()} helperText={!cardName.trim() ? '必填' : ''}
        />
        <TextField
          fullWidth label="卡号后四位" margin="normal" value={last4}
          onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputProps={{ maxLength: 4, inputMode: 'numeric' }}
        />
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <TextField
            label="信用额度" type="number" value={limit}
            onChange={e => setLimit(Math.max(0, Number(e.target.value)))} required
            error={limit < 0}
          />
          <FormControl fullWidth>
            <InputLabel>币种</InputLabel>
            <Select value={currency} onChange={e => setCurrency(e.target.value)}>
              <MenuItem value="CNY">CNY</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
              <MenuItem value="HKD">HKD</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <TextField
          fullWidth label="账单日 (1-31)" type="number" margin="normal"
          value={billingDay}
          onChange={e => setBillingDay(Math.min(31, Math.max(1, Number(e.target.value))))}
          required
          error={billingDay < 1 || billingDay > 31}
          helperText={billingDay < 1 || billingDay > 31 ? '必须在 1-31 之间' : ''}
        />
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>还款日类型</InputLabel>
          <Select value={dueType} onChange={e => setDueType(e.target.value as 'fixed' | 'after_billing')}>
            <MenuItem value="after_billing">账单日后天数</MenuItem>
            <MenuItem value="fixed">每月固定日期</MenuItem>
          </Select>
        </FormControl>
        <TextField
          fullWidth label={dueType === 'after_billing' ? '天数' : '日期 (1-31)'}
          type="number" margin="normal" value={dueValue}
          onChange={e => setDueValue(Math.max(1, Number(e.target.value)))} required
        />
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <TextField
            label="年费" type="number" value={annualFee}
            onChange={e => setAnnualFee(Math.max(0, Number(e.target.value)))}
          />
          <TextField
            label="免年费条件" value={annualFeeWaiver} fullWidth
            onChange={e => setAnnualFeeWaiver(e.target.value)}
            placeholder="如：刷满6次免次年年费"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}

