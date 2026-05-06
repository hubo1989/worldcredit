// components/mobile/CardForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, MenuItem, Box, Stack
} from '@mui/material'
import { createCard, updateCard } from '@/lib/api/cards'
import type { CreditCard } from '@/lib/types'

const CURRENCIES = [
  { value: 'CNY', label: '人民币 (CNY)' },
  { value: 'USD', label: '美元 (USD)' },
  { value: 'HKD', label: '港币 (HKD)' },
  { value: 'EUR', label: '欧元 (EUR)' },
  { value: 'GBP', label: '英镑 (GBP)' },
  { value: 'JPY', label: '日元 (JPY)' },
]

const COUNTRIES = [
  { value: 'CN', label: '中国' },
  { value: 'US', label: '美国' },
  { value: 'HK', label: '香港' },
  { value: 'SG', label: '新加坡' },
  { value: 'JP', label: '日本' },
  { value: 'GB', label: '英国' },
]

const STATUSES = [
  { value: 'active', label: '正常' },
  { value: 'frozen', label: '冻结' },
  { value: 'cancelled', label: '已注销' },
]

interface Props {
  open: boolean
  onClose: () => void
  holderId: string
  onSaved: () => void
  initial?: CreditCard
}

export function CardForm({ open, onClose, holderId, onSaved, initial }: Props) {
  const [bankName, setBankName] = useState('')
  const [cardName, setCardName] = useState('')
  const [last4, setLast4] = useState('')
  const [limit, setLimit] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [country, setCountry] = useState('CN')
  const [billingDay, setBillingDay] = useState('1')
  const [dueType, setDueType] = useState<'fixed' | 'after_billing'>('after_billing')
  const [dueValue, setDueValue] = useState('20')
  const [annualFee, setAnnualFee] = useState('')
  const [feeWaiver, setFeeWaiver] = useState('')
  const [status, setStatus] = useState<'active' | 'frozen' | 'cancelled'>('active')

  useEffect(() => {
    if (open) {
      setBankName(initial?.bank_name ?? '')
      setCardName(initial?.card_name ?? '')
      setLast4(initial?.card_number_last4 ?? '')
      setLimit(initial ? String(initial.credit_limit) : '')
      setCurrency(initial?.currency ?? 'CNY')
      setCountry(initial?.country ?? 'CN')
      setBillingDay(initial ? String(initial.billing_day) : '1')
      setDueType(initial?.payment_due_type ?? 'after_billing')
      setDueValue(initial ? String(initial.payment_due_value) : '20')
      setAnnualFee(initial ? String(initial.annual_fee) : '')
      setFeeWaiver(initial?.annual_fee_waiver ?? '')
      setStatus(initial?.status ?? 'active')
    }
  }, [open, initial])

  const handleSubmit = async () => {
    if (!bankName.trim() || !cardName.trim() || !limit) return

    const cardData = {
      holder_id: holderId,
      country,
      bank_name: bankName.trim(),
      card_name: cardName.trim(),
      card_number_last4: last4.trim() || undefined,
      credit_limit: parseFloat(limit) || 0,
      currency,
      billing_day: parseInt(billingDay) || 1,
      payment_due_type: dueType,
      payment_due_value: parseInt(dueValue) || 20,
      annual_fee: parseFloat(annualFee) || 0,
      annual_fee_waiver: feeWaiver.trim() || undefined,
      status,
    }

    try {
      if (initial) {
        await updateCard(initial.id, cardData)
      } else {
        await createCard(cardData as any)
      }
      onSaved()
      onClose()
    } catch (err) {
      alert('保存失败：' + (err as any).message)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? '编辑信用卡' : '添加信用卡'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select label="发卡国家" value={country}
            onChange={e => setCountry(e.target.value)}
          >
            {COUNTRIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
          </TextField>
          <TextField
            label="发卡银行" required value={bankName}
            onChange={e => setBankName(e.target.value)}
            placeholder="如：招商银行"
          />
          <TextField
            label="卡种名称" required value={cardName}
            onChange={e => setCardName(e.target.value)}
            placeholder="如：经典白金卡"
          />
          <TextField
            label="卡号后四位" value={last4}
            onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputProps={{ maxLength: 4 }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="信用额度" required value={limit}
              onChange={e => setLimit(e.target.value)}
              type="number" fullWidth
              placeholder="0.00"
            />
            <TextField
              select label="币种" value={currency}
              onChange={e => setCurrency(e.target.value)} fullWidth
            >
              {CURRENCIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="账单日 (号)" value={billingDay}
              onChange={e => setBillingDay(e.target.value)}
              type="number" inputProps={{ min: 1, max: 31 }} fullWidth
            />
            <TextField
              select label="还款日类型" value={dueType}
              onChange={e => setDueType(e.target.value as any)} fullWidth
            >
              <MenuItem value="after_billing">账单日后 N 天</MenuItem>
              <MenuItem value="fixed">每月固定日期</MenuItem>
            </TextField>
          </Stack>
          <TextField
            label={dueType === 'fixed' ? '还款日 (号)' : '账单后天数'}
            value={dueValue}
            onChange={e => setDueValue(e.target.value)}
            type="number" inputProps={{ min: 1, max: 31 }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="年费" value={annualFee}
              onChange={e => setAnnualFee(e.target.value)}
              type="number" fullWidth
            />
            <TextField
              label="免年费条件" value={feeWaiver}
              onChange={e => setFeeWaiver(e.target.value)} fullWidth
              placeholder="如：刷6次免年费"
            />
          </Stack>
          <TextField
            select label="状态" value={status}
            onChange={e => setStatus(e.target.value as any)}
          >
            {STATUSES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}
