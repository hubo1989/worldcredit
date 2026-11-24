'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import type { BillImportDraft } from '@/lib/api/billDrafts'
import {
  isPresent,
  isValidBillMonth,
  validateAmountText,
  validateDateText,
  validateMinPaymentText,
} from './bill-editing-shared'
import {
  formatDraftAmount,
  getDraftCurrencySymbol,
  type BillDraftPayload,
  type BillImportDraftOmnibus,
} from './omnibusApi'

/** 可编辑的 parsed_payload 字段（其余字段原样保留）。 */
export interface BillDraftFieldValues {
  bill_amount: string
  min_payment: string
  bill_month: string
  due_date: string
  statement_date: string
  currency?: string
}

type Errors = Partial<Record<keyof BillDraftFieldValues, string>>

function toInputValues(draft: BillImportDraft | BillImportDraftOmnibus): BillDraftFieldValues {
  const p = draft.parsed_payload as BillDraftPayload
  return {
    bill_amount: isPresent(p.bill_amount) ? String(p.bill_amount) : '',
    min_payment: isPresent(p.min_payment) ? String(p.min_payment) : '',
    bill_month: p.bill_month ?? '',
    due_date: p.due_date ?? '',
    statement_date: p.statement_date ?? '',
    currency: p.currency ?? 'CNY',
  }
}

/**
 * 表单校验。返回 errors，空对象即通过。
 * 必填项：bill_amount / bill_month / due_date —— 与 confirmBillImportDraft
 * 的「账单缺少必要字段」判定保持一致，避免改完仍不能确认。
 */
export function validateDraftFields(values: BillDraftFieldValues): Errors {
  const errors: Errors = {}

  const amountError = validateAmountText(values.bill_amount)
  if (amountError) errors.bill_amount = amountError
  const minPaymentError = validateMinPaymentText(values.min_payment)
  if (minPaymentError) errors.min_payment = minPaymentError

  const month = values.bill_month.trim()
  if (!month) {
    errors.bill_month = '请填写账单月份'
  } else if (!isValidBillMonth(month)) {
    errors.bill_month = '月份格式应为 YYYY-MM'
  }

  const dueError = validateDateText(values.due_date, true)
  if (dueError) errors.due_date = dueError
  const statementError = validateDateText(values.statement_date)
  if (statementError) errors.statement_date = statementError

  return errors
}

/** 表单值合并回 parsed_payload：只覆盖这几个字段，其余原样带回去。 */
export function mergeDraftPayload(
  draft: BillImportDraft | BillImportDraftOmnibus,
  values: BillDraftFieldValues,
): BillImportDraft['parsed_payload'] {
  const next = { ...draft.parsed_payload } as BillDraftPayload & BillImportDraft['parsed_payload']
  next.bill_amount = Number(values.bill_amount.trim())
  next.bill_month = values.bill_month.trim()
  next.due_date = values.due_date.trim()
  next.statement_date = values.statement_date.trim() || undefined
  const minPayment = values.min_payment.trim()
  next.min_payment = minPayment ? Number(minPayment) : undefined
  if (values.currency && values.currency !== (draft.parsed_payload as BillDraftPayload).currency) {
    next.currency = values.currency
  }
  return next
}

interface Props {
  open: boolean
  draft: BillImportDraft | BillImportDraftOmnibus | null
  /** 卡选项与列表里的选卡器同源 */
  cards: Array<{ id: string; label: string; currency?: string }>
  onClose: () => void
  /** 保存成功后的回调（父组件负责重新拉取草稿列表） */
  onSaved: () => void
  /** 实际写库动作，测试里可直接注入 mock */
  onSubmit: (draftId: string, values: BillDraftFieldValues) => Promise<void>
}

export function BillDraftEditForm({ open, draft, cards, onClose, onSaved, onSubmit }: Props) {
  const [values, setValues] = useState<BillDraftFieldValues>({
    bill_amount: '',
    min_payment: '',
    bill_month: '',
    due_date: '',
    statement_date: '',
    currency: 'CNY',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 打开时从草稿初始化；loadedId 防止父组件 reload 换了对象引用后把用户正在
  // 编辑的值冲掉——只有切换到另一份草稿或重新打开时才重置。
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const draftId = draft?.id ?? null

  useEffect(() => {
    if (!open || !draft || loadedId === draft.id) return
    setValues(toInputValues(draft))
    setErrors({})
    setSubmitError(null)
    setLoadedId(draft.id)
  }, [open, draft, loadedId])

  useEffect(() => {
    if (!open) setLoadedId(null)
  }, [open])

  const set = (field: keyof BillDraftFieldValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setValues(prev => ({ ...prev, [field]: value }))
    setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const handleSubmit = async () => {
    if (!draftId) return
    const nextErrors = validateDraftFields(values)
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.values(nextErrors).some(Boolean)) return

    setSubmitting(true)
    try {
      await onSubmit(draftId, values)
      onSaved()
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open || !draft) return null

  const hasErrors = Object.values(errors).some(Boolean)
  const matchedCard = cards.find(c => c.id === draft.card_id)
  const cardLabel = matchedCard?.label ?? (draft.card_id ? '未知卡片' : '未绑定卡片')
  const effectiveCurrency = values.currency || matchedCard?.currency || 'CNY'
  const currencySym = getDraftCurrencySymbol(effectiveCurrency)
  const subtotals = (draft.parsed_payload as BillDraftPayload).card_subtotals

  return (
    <Modal
      open={open}
      onClose={onClose}
      title='编辑草稿字段'
      dismissible={!submitting}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 px-5 pb-5'>
        <p className='text-[12px] leading-4 text-d-muted'>
          确认入库前可修正解析结果。换卡请在列表的选卡器里操作。
        </p>
        {submitError && <Alert severity='error'>{submitError}</Alert>}
        {hasErrors && <Alert severity='warning'>请先修正标红的字段再保存</Alert>}
        <SelectField
          label='绑定信用卡（列表里改）'
          value={draft.card_id ?? ''}
          onChange={() => {}}
          disabled
          options={[{ value: draft.card_id ?? '', label: cardLabel }]}
        />
        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='账单月份'
            required
            type='month'
            value={values.bill_month}
            onChange={set('bill_month')}
            error={Boolean(errors.bill_month)}
            helperText={errors.bill_month}
          />
          <SelectField
            label='币种'
            value={effectiveCurrency}
            onChange={e => setValues(prev => ({ ...prev, currency: e.target.value }))}
            options={[
              { value: 'CNY', label: '人民币 CNY' },
              { value: 'USD', label: '美元 USD' },
              { value: 'HKD', label: '港币 HKD' },
              { value: 'JPY', label: '日元 JPY' },
              { value: 'EUR', label: '欧元 EUR' },
              { value: 'GBP', label: '英镑 GBP' },
            ]}
          />
        </div>
        <TextField
          label='账单金额'
          required
          type='number'
          min={0}
          step={0.01}
          value={values.bill_amount}
          onChange={set('bill_amount')}
          error={Boolean(errors.bill_amount)}
          helperText={errors.bill_amount}
          startAdornment={<span>{currencySym}</span>}
        />
        <TextField
          label='最低还款额（选填）'
          type='number'
          min={0}
          step={0.01}
          value={values.min_payment}
          onChange={set('min_payment')}
          error={Boolean(errors.min_payment)}
          helperText={errors.min_payment}
          startAdornment={<span>{currencySym}</span>}
        />
        <TextField
          label='账单日（选填）'
          type='date'
          value={values.statement_date}
          onChange={set('statement_date')}
          error={Boolean(errors.statement_date)}
          helperText={errors.statement_date}
        />
        <TextField
          label='还款到期日'
          required
          type='date'
          value={values.due_date}
          onChange={set('due_date')}
          error={Boolean(errors.due_date)}
          helperText={errors.due_date}
        />
        {subtotals && subtotals.length > 0 && (
          <div className='rounded-xl border border-d-border bg-d-bg/60 p-3'>
            <p className='mb-1 text-[11px] font-semibold text-d-muted'>合并账户分卡小计（只读）</p>
            <div className='space-y-1'>
              {subtotals.map((sub, i) => (
                <div key={i} className='flex items-center justify-between text-[12px]'>
                  <span className='text-d-text'>
                    {sub.card_name || '卡'} · 尾号 {sub.card_last4}
                  </span>
                  <span className='num-tabular font-semibold text-d-text'>
                    {formatDraftAmount(sub.amount, sub.currency || effectiveCurrency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
