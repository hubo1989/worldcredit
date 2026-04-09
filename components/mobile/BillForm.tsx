// components/mobile/BillForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material'
import { format, startOfMonth, endOfMonth, parse } from 'date-fns'
import { getDueDate } from '@/lib/utils'
import type { Bill, CreditCard } from '@/lib/types'

interface CardOption {
  id: string
  label: string
  card: CreditCard
}

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Bill, 'id' | 'created_at' | 'status'>) => void
  cards: CardOption[]
  initial?: Bill
}

export function BillForm({ open, onClose, onSubmit, cards, initial }: Props) {
  const [cardId, setCardId] = useState(initial?.card_id ?? (cards[0]?.id ?? ''))
  const [billMonth, setBillMonth] = useState(initial?.bill_month ?? format(new Date(), 'yyyy-MM'))
  const [billAmount, setBillAmount] = useState(initial?.bill_amount ?? 0)
  const [minPayment, setMinPayment] = useState(initial?.min_payment ?? 0)
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')

  useEffect(() => {
    if (open) {
      setCardId(initial?.card_id ?? (cards[0]?.id ?? ''))
      setBillMonth(initial?.bill_month ?? format(new Date(), 'yyyy-MM'))
      setBillAmount(initial?.bill_amount ?? 0)
      setMinPayment(initial?.min_payment ?? 0)

      if (initial?.due_date) {
        setDueDate(initial.due_date)
      } else {
        autoCalcDueDate(cardId, billMonth)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const autoCalcDueDate = (cId: string, month: string) => {
    const cardOption = cards.find(c => c.id === cId)
    if (!cardOption) return
    try {
      const monthDate = parse(month, 'yyyy-MM', new Date())
      const due = getDueDate(cardOption.card, monthDate)
      setDueDate(format(due, 'yyyy-MM-dd'))
    } catch {
      // keep current dueDate
    }
  }

  const handleCardChange = (newCardId: string) => {
    setCardId(newCardId)
    autoCalcDueDate(newCardId, billMonth)
  }

  const handleMonthChange = (newMonth: string) => {
    setBillMonth(newMonth)
    autoCalcDueDate(cardId, newMonth)
  }

  const isValid = () => {
    if (!cardId) return false
    if (!billMonth.match(/^\d{4}-\d{2}$/)) return false
    if (billAmount <= 0) return false
    if (!dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) return false
    return true
  }

  const handleSubmit = () => {
    if (!isValid()) return
    const monthDate = parse(billMonth, 'yyyy-MM', new Date())
    onSubmit({
      card_id: cardId,
      bill_month: billMonth,
      statement_start: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
      statement_end: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
      statement_date: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
      bill_amount: billAmount,
      min_payment: minPayment,
      due_date: dueDate,
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑账单' : '添加账单'}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel>信用卡</InputLabel>
          <Select value={cardId} onChange={e => handleCardChange(e.target.value)} label="信用卡">
            {cards.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth label="账单月份" margin="normal"
          type="month" value={billMonth}
          onChange={e => handleMonthChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          fullWidth label="账单金额" margin="normal"
          type="number" value={billAmount}
          onChange={e => setBillAmount(Math.max(0, Number(e.target.value)))}
          inputProps={{ min: 0, step: 0.01 }}
        />
        <TextField
          fullWidth label="最低还款额" margin="normal"
          type="number" value={minPayment}
          onChange={e => setMinPayment(Math.max(0, Number(e.target.value)))}
          inputProps={{ min: 0, step: 0.01 }}
        />
        <TextField
          fullWidth label="还款截止日" margin="normal"
          type="date" value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}
