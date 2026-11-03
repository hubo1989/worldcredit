'use client'

import { useState, useEffect, useRef } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { format } from 'date-fns'
import {
  createBill,
  updateBillFields,
  getBillByCardMonth,
  type BillEditableFields,
} from '@/lib/api/bills'
import { getAllCardsWithProduct } from '@/lib/api/cards'
import {
  formatCardTail,
  billEffectiveMinPayment,
  billEffectiveStatementDate,
  billEffectiveDueDate,
  isValidCalendarDate,
} from '@/lib/utils'
import { isPresent } from './bill-editing-shared'
import type { CreditCard, CardProduct, Bill } from '@/lib/types'
import { AiFillBox } from '@/components/mobile/AiFillBox'

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

// 服务端 joinRowToCard 会把卡级别覆盖写进顶层 card_name，这里如实声明以便选卡器显示生效名称
type CardWithProduct = CreditCard & { card_product: CardProduct; card_name?: string }

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
    getAllCardsWithProduct()
      .then(rows => setCards(rows as CardWithProduct[]))
      .catch(() => setCards([]))
  }, [open])

  // 本次加载的初值：编辑时只提交真正改动过的字段
  const initialFormRef = useRef<BillFormData | null>(null)
  // 保存最新表单值，供异步回调构造快照（避免在 setState updater 里写 ref）
  const formRef = useRef<BillFormData>(form)
  useEffect(() => {
    formRef.current = form
  }, [form])
  // 初始化表单
  useEffect(() => {
    if (!open) return
    if (existingBill) {
      const effectiveMinPayment = billEffectiveMinPayment(existingBill)
      const effectiveStatementDate = billEffectiveStatementDate(existingBill)
      const initial: BillFormData = {
        card_id: existingBill.card_id,
        bill_month: existingBill.bill_month,
        bill_amount: String(existingBill.bill_amount),
        min_payment: isPresent(effectiveMinPayment) ? String(effectiveMinPayment) : '',
        statement_date: effectiveStatementDate ?? existingBill.statement_end ?? format(new Date(), 'yyyy-MM-dd'),
        due_date: billEffectiveDueDate(existingBill),
      }
      initialFormRef.current = initial
      setForm(initial)
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
    getBillByCardMonth(form.card_id, form.bill_month)
      .then(data => {
        if (data) {
          // 服务端已按 override 优先合成生效值，无需前端再断言字段
          const effectiveMinPayment = billEffectiveMinPayment(data)
          const effectiveStatementDate = billEffectiveStatementDate(data)
          setExistingBillId(data.id)
          // 用最新表单值 + 覆盖字段生成快照；不写进 setState updater（保持 updater 纯函数）
          const snapshot: BillFormData = {
            ...formRef.current,
            bill_amount: String(data.bill_amount ?? ''),
            min_payment: isPresent(effectiveMinPayment) ? String(effectiveMinPayment) : '',
            statement_date: effectiveStatementDate ?? formRef.current.statement_date,
            due_date: billEffectiveDueDate(data) || formRef.current.due_date,
          }
          initialFormRef.current = snapshot
          setForm(snapshot)
        } else {
          initialFormRef.current = null
          setExistingBillId(null)
        }
      })
      .catch(() => {})
  }, [form.card_id, form.bill_month, existingBill])

  const set = (field: keyof BillFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async () => {
    setError(null)
    if (!form.card_id || !form.bill_month || !form.bill_amount || !form.due_date) {
      setError('请填写必填字段：信用卡、账单月份、账单金额、到期日')
      return
    }

    const billAmt = Number(form.bill_amount.trim())
    const trimmedMinPay = form.min_payment.trim()
    const minPay = trimmedMinPay ? Number(trimmedMinPay) : undefined
    const trimmedStatementDate = form.statement_date.trim()
    const trimmedDueDate = form.due_date.trim()

    if (!Number.isFinite(billAmt) || billAmt < 0) {
      setError('账单金额必须是有效数字')
      return
    }
    if (minPay !== undefined && (!Number.isFinite(minPay) || minPay < 0)) {
      setError('最低还款额必须是不小于 0 的数字')
      return
    }
    if (!isValidCalendarDate(trimmedDueDate)) {
      setError('到期日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }
    if (trimmedStatementDate && !isValidCalendarDate(trimmedStatementDate)) {
      setError('账单日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }

    setSubmitting(true)
    try {
      if (existingBillId) {
        // 统一走单个 updateBillFields RPC，且只提交真正改动过的字段：
        // 未改动字段不进 patch，服务端就不会把它们钉成 override。
        const initial = initialFormRef.current
        const patch: BillEditableFields = {}
        if (!initial || form.bill_amount !== initial.bill_amount) patch.amount = billAmt
        if (!initial || form.min_payment !== initial.min_payment) patch.min_payment = minPay ?? null
        if (!initial || form.statement_date !== initial.statement_date) {
          patch.statement_date = trimmedStatementDate || null
        }
        if (!initial || form.due_date !== initial.due_date) patch.due_date = trimmedDueDate
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        await updateBillFields(existingBillId, patch)
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
          statement_date: trimmedStatementDate || undefined,
          bill_amount: billAmt,
          min_payment: minPay,
          due_date: trimmedDueDate,
          status: 'unpaid',
        })
      }

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const cardLabel = (c: CardWithProduct) => {
    const tail = formatCardTail(c.card_number_last4)
    // 修改内容优先：getAllCardsWithProduct 已把卡级别覆盖写进 card.card_name，
    // 否则两张同名产品卡在选卡器里无法区分
    const name = c.card_name || c.card_product.card_name
    return `${c.card_product.bank_name} ${name}${tail ? ` (${tail})` : ''}`
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existingBillId ? '更新账单' : '录入账单'}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {submitting ? '提交中...' : existingBillId ? '更新' : '录入'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {error && <Alert severity="error">{error}</Alert>}
        <AiFillBox mode="bill" onFill={(data) => {
          setForm(prev => ({
            ...prev,
            ...(isPresent(data.bill_amount) ? { bill_amount: String(data.bill_amount).replace(/[,¥元\s]/g, '') } : {}),
            ...(isPresent(data.min_payment) ? { min_payment: String(data.min_payment).replace(/[,¥元\s]/g, '') } : {}),
            ...(data.due_date ? { due_date: String(data.due_date).slice(0, 10) } : {}),
            ...(data.statement_date ? { statement_date: String(data.statement_date).slice(0, 10) } : {}),
            ...(data.bill_month ? { bill_month: String(data.bill_month).slice(0, 7) } : {}),
          }))
        }} />

        {existingBillId && !existingBill && (
          <Alert severity="info">当月账单已存在，将更新金额</Alert>
        )}

        {/* 信用卡 */}
        <SelectField
          label="信用卡"
          required
          value={form.card_id}
          onChange={e => setForm(prev => ({ ...prev, card_id: e.target.value }))}
          disabled={!!existingBill}
          placeholder="暂无信用卡"
          options={cards.map(c => ({ value: c.id, label: cardLabel(c) }))}
        />

        {/* 账单月份 */}
        <TextField
          label="账单月份"
          required
          type="month"
          value={form.bill_month}
          onChange={set('bill_month')}
          disabled={!!existingBill}
        />

        {/* 账单金额 */}
        <TextField
          label="账单金额"
          required
          type="number"
          min={0}
          step={0.01}
          value={form.bill_amount}
          onChange={set('bill_amount')}
          startAdornment={<span>¥</span>}
        />

        {/* 最低还款额 */}
        <TextField
          label="最低还款额（选填）"
          type="number"
          min={0}
          step={0.01}
          value={form.min_payment}
          onChange={set('min_payment')}
          startAdornment={<span>¥</span>}
        />

        {/* 账单日 */}
        <TextField
          label="账单日（选填）"
          type="date"
          value={form.statement_date}
          onChange={set('statement_date')}
        />

        {/* 到期日 */}
        <TextField
          label="还款到期日"
          required
          type="date"
          value={form.due_date}
          onChange={set('due_date')}
        />
      </div>
    </Modal>
  )
}
