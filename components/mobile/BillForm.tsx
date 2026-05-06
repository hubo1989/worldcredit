// components/mobile/BillForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Box, Typography, IconButton, Divider, Stack, Alert,
} from '@mui/material'
import { AddCircleOutline, DeleteOutline, ContentPaste } from '@mui/icons-material'
import { format, startOfMonth, endOfMonth, parse } from 'date-fns'
import { getDueDate } from '@/lib/utils'
import { parseBillItemsFromText, validateBillItemDrafts, type ParsedBillItem } from '@/lib/billParser'
import type { Bill, CreditCard } from '@/lib/types'
import type { BillItemInput } from '@/lib/api/bills'

interface CardOption {
  id: string
  label: string
  card: CreditCard
}

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Bill, 'id' | 'created_at' | 'status'> & { items?: BillItemInput[] }) => void
  cards: CardOption[]
  initial?: Bill
}

type DraftBillItem = ParsedBillItem

const emptyItem = (): DraftBillItem => ({
  transaction_date: '',
  description: '',
  amount: 0,
  category: '',
  item_type: 'purchase',
  source: 'manual',
})

export function BillForm({ open, onClose, onSubmit, cards, initial }: Props) {
  const [cardId, setCardId] = useState(initial?.card_id ?? (cards[0]?.id ?? ''))
  const [billMonth, setBillMonth] = useState(initial?.bill_month ?? format(new Date(), 'yyyy-MM'))
  const [billAmount, setBillAmount] = useState(initial?.bill_amount ?? 0)
  const [minPayment, setMinPayment] = useState(initial?.min_payment ?? 0)
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [items, setItems] = useState<DraftBillItem[]>([])
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [parseWarnings, setParseWarnings] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setCardId(initial?.card_id ?? (cards[0]?.id ?? ''))
      setBillMonth(initial?.bill_month ?? format(new Date(), 'yyyy-MM'))
      setBillAmount(initial?.bill_amount ?? 0)
      setMinPayment(initial?.min_payment ?? 0)
      setItems([])
      setParseErrors([])
      setParseWarnings([])

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

  const handlePasteParse = () => {
    const parsed = parseBillItemsFromText(pasteText)
    const validation = validateBillItemDrafts(parsed)

    setParseErrors(validation.errors)
    setParseWarnings(validation.warnings)

    if (parsed.length > 0) {
      setItems(prev => [...prev, ...parsed])
      setPasteText('')
      setPasteDialogOpen(false)
    }
  }

  const isValid = () => {
    if (!cardId) return false
    if (!billMonth.match(/^\d{4}-\d{2}$/)) return false
    if (billAmount <= 0) return false
    if (!dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) return false
    return true
  }

  const updateItem = <K extends keyof DraftBillItem>(index: number, key: K, value: DraftBillItem[K]) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [key]: value } : item))
  }

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const normalizedItems: BillItemInput[] = items
    .filter(item => item.description.trim() && Number(item.amount) !== 0)
    .map(item => ({
      transaction_date: item.transaction_date || undefined,
      description: item.description.trim(),
      amount: Number(item.amount),
      category: item.category?.trim() || undefined,
      item_type: Number(item.amount) < 0 ? 'refund' : 'purchase',
      source: 'manual',
    }))

  const itemTotal = normalizedItems.reduce((sum, item) => sum + Number(item.amount), 0)

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
      items: normalizedItems,
    })
    onClose()
  }

  return (
    <>
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

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>账单明细</Typography>
              {normalizedItems.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  明细合计 ¥{itemTotal.toFixed(2)}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                startIcon={<ContentPaste />}
                onClick={() => setPasteDialogOpen(true)}
              >
                粘贴明细
              </Button>
              <Button
                size="small"
                startIcon={<AddCircleOutline />}
                onClick={() => setItems(prev => [...prev, emptyItem()])}
              >
                添加
              </Button>
            </Box>
          </Box>

          {normalizedItems.length > 0 && Math.abs(itemTotal - billAmount) > 0.01 && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              明细合计 (¥{itemTotal.toFixed(2)}) 与账单金额 (¥{billAmount.toFixed(2)}) 不一致，
              差额 ¥{Math.abs(itemTotal - billAmount).toFixed(2)}
            </Alert>
          )}

          {parseErrors.length > 0 && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {parseErrors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </Alert>
          )}

          {parseWarnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {parseWarnings.map((warn, i) => (
                <div key={i}>{warn}</div>
              ))}
            </Alert>
          )}

          <Stack spacing={1.5}>
            {items.map((item, index) => (
              <Box
                key={index}
                sx={{
                  border: '1px solid',
                  borderColor: item.error ? 'error.main' : 'divider',
                  borderRadius: 1,
                  p: 1.25,
                  bgcolor: item.error ? 'error.50' : 'background.paper',
                }}
              >
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    label="交易日期"
                    type="date"
                    size="small"
                    value={item.transaction_date}
                    onChange={e => updateItem(index, 'transaction_date', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1 }}
                  />
                  <IconButton size="small" onClick={() => removeItem(index)} aria-label="删除明细">
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Box>
                <TextField
                  fullWidth
                  label="商户或说明"
                  margin="dense"
                  size="small"
                  value={item.description}
                  onChange={e => updateItem(index, 'description', e.target.value)}
                  error={!!item.error}
                  helperText={item.error}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    label="金额"
                    type="number"
                    margin="dense"
                    size="small"
                    value={item.amount}
                    onChange={e => updateItem(index, 'amount', Number(e.target.value))}
                    inputProps={{ step: 0.01 }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="分类"
                    margin="dense"
                    size="small"
                    value={item.category || ''}
                    onChange={e => updateItem(index, 'category', e.target.value)}
                    sx={{ flex: 1 }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pasteDialogOpen} onClose={() => setPasteDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>粘贴账单明细</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            支持格式：YYYY-MM-DD 商户说明 金额 分类（每行一条）
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={10}
            placeholder="例如：
2026-04-01 星巴克 38.00 餐饮
2026-04-03 地铁 12.00 出行
2026-04-05 退款 -20.00 退款"
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handlePasteParse} disabled={!pasteText.trim()}>解析</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
