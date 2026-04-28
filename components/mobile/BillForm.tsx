'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, MenuItem, Stack, InputAdornment, Alert,
  CircularProgress
} from '@mui/material'
import { format } from 'date-fns'
import { insforge } from '@/lib/insforge'
import { createBill, updateBill } from '@/lib/api/bills'
import type { CreditCard, CardProduct, Bill } from '@/lib/types'

interface BillFormData {
  card_id: string
  bill_month: string        // 'YYYY-MM'
  bill_amount: string
  min_payment: string
  statement_date: string    // 账单日 'YYYY-MM-DD'
  due_date: string          // 到期日 'YYYY-MM-DD'
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  /** 如果传入，则为编辑模式 */
  existingBill?: Bill | null
}

type CardWithProduct = CreditCard & { card_product: CardProduct }

const EMPTY: BillFormData = {
  card_id: '',
  bill_month: format(new Date(), 'yyyy-MM'),
  bill_amount: '',
  min_payment: '',
  statement_date: format(new Date(), 'yyyy-MM-dd'),
  due_date: '',
}

export function BillForm({ open, onClose, onSuccess, existingBill }: Props) {
  const [cards, setCards] = useState<CardWithProduct[]>([])
  const [form, setForm] = useState<BillFormData>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingBillId, setExistingBillId] = useState<string | null>(null)

  // 加载所有信用卡
  useEffect(() => {
    if (!open) return
    insforge.database
      .from('credit_cards')
      .select('*, card_product:card_products(*)')
      .then(({ data, error: e }) => {
        if (!e && data) setCards(data as CardWithProduct[])
      })
  }, [open])

  // 初始化表单
  useEffect(() => {
    if (!open) return
    if (existingBill) {
      setForm({
        card_id: existingBill.card_id,
        bill_month: existingBill.bill_month,
        bill_amount: String(existingBill.bill_amount),
        min_payment: existingBill.min_payment != null ? String(existingBill.min_payment) : '',
        statement_date: existingBill.statement_date ?? existingBill.statement_end ?? format(new Date(), 'yyyy-MM-dd'),
        due_date: existingBill.due_date,
      })
      setExistingBillId(existingBill.id)
    } else {
      setForm(EMPTY)
      setExistingBillId(null)
    }
    setError(null)
  }, [open, existingBill])

  // 当选择信用卡或账单月份变化时，检查当月账单是否已存在
  useEffect(() => {
    if (!form.card_id || !form.bill_month || existingBill) return
    insforge.database
      .from('bills')
      .select('id, bill_amount, min_payment, statement_date, due_date')
      .eq('card_id', form.card_id)
      .eq('bill_month', form.bill_month)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExistingBillId(data.id)
          setForm(prev => ({
            ...prev,
            bill_amount: String(data.bill_amount ?? ''),
            min_payment: data.min_payment != null ? String(data.min_payment) : '',
            statement_date: data.statement_date ?? prev.statement_date,
            due_date: data.due_date ?? prev.due_date,
          }))
        } else {
          setExistingBillId(null)
        }
      })
  }, [form.card_id, form.bill_month, existingBill])

  const set = (field: keyof BillFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async () => {
    setError(null)
    if (!form.card_id || !form.bill_month || !form.bill_amount || !form.due_date) {
      setError('请填写必填字段：信用卡、账单月份、账单金额、到期日')
      return
    }

    const billAmt = parseFloat(form.bill_amount)
    const minPay = form.min_payment ? parseFloat(form.min_payment) : undefined

    if (isNaN(billAmt) || billAmt < 0) {
      setError('账单金额必须是有效数字')
      return
    }

    setSubmitting(true)
    try {
      if (existingBillId) {
        // 更新已有账单
        await updateBill(existingBillId, {
          bill_amount: billAmt,
          min_payment: minPay,
          statement_date: form.statement_date || undefined,
          due_date: form.due_date,
          status: 'unpaid', // 重置为未还
        })
      } else {
        // 创建新账单（补充账期首末日）
        const [year, month] = form.bill_month.split('-').map(Number)
        const firstDay = format(new Date(year, month - 1, 1), 'yyyy-MM-dd')
        const lastDay = format(new Date(year, month, 0), 'yyyy-MM-dd')

        await createBill({
          card_id: form.card_id,
          bill_month: form.bill_month,
          statement_start: firstDay,
          statement_end: lastDay,
          statement_date: form.statement_date || undefined,
          bill_amount: billAmt,
          min_payment: minPay,
          due_date: form.due_date,
          status: 'unpaid',
        })
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const cardLabel = (c: CardWithProduct) =>
    `${c.card_product.bank_name} ${c.card_product.card_name}${c.card_number_last4 ? ` (${c.card_number_last4})` : ''}`

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle fontWeight={700}>
        {existingBillId ? '更新账单' : '录入账单'}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {existingBillId && !existingBill && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              当月账单已存在，将更新金额
            </Alert>
          )}

          {/* 信用卡 */}
          <TextField
            select
            fullWidth
            label="信用卡 *"
            value={form.card_id}
            onChange={set('card_id')}
            disabled={!!existingBill}
          >
            {cards.length === 0 && (
              <MenuItem value="" disabled>暂无信用卡</MenuItem>
            )}
            {cards.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {cardLabel(c)}
              </MenuItem>
            ))}
          </TextField>

          {/* 账单月份 */}
          <TextField
            fullWidth
            label="账单月份 *"
            type="month"
            value={form.bill_month}
            onChange={set('bill_month')}
            disabled={!!existingBill}
            InputLabelProps={{ shrink: true }}
          />

          {/* 账单金额 */}
          <TextField
            fullWidth
            label="账单金额 *"
            type="number"
            inputProps={{ min: 0, step: 0.01 }}
            value={form.bill_amount}
            onChange={set('bill_amount')}
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
            }}
          />

          {/* 最低还款额 */}
          <TextField
            fullWidth
            label="最低还款额（选填）"
            type="number"
            inputProps={{ min: 0, step: 0.01 }}
            value={form.min_payment}
            onChange={set('min_payment')}
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
            }}
          />

          {/* 账单日 */}
          <TextField
            fullWidth
            label="账单日（选填）"
            type="date"
            value={form.statement_date}
            onChange={set('statement_date')}
            InputLabelProps={{ shrink: true }}
          />

          {/* 到期日 */}
          <TextField
            fullWidth
            label="还款到期日 *"
            type="date"
            value={form.due_date}
            onChange={set('due_date')}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} color="inherit" disabled={submitting}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {submitting ? '提交中...' : existingBillId ? '更新' : '录入'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
