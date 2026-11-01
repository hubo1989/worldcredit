'use client'

import { useEffect, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { LockIcon, TrashIcon, ChevronDownIcon } from '@/components/icons/WcIcon'
import {
  updateBillFields,
  clearOverride,
  deleteBill,
  type BillEditableFields,
  type BillOverrideField,
} from '@/lib/api/bills'
import type { Bill } from '@/lib/types'
import {
  validateEditableFields,
  amountBelowPaidWarning,
  STATUS_LABELS,
  STATUS_DESCRIPTIONS,
  type BillStatus,
  type EditableFieldValues,
  type FieldErrors,
} from './bill-editing-shared'

const LOCK_CLS = 'text-[12px] leading-4 text-d-muted'

interface OverridePinProps {
  pinned: boolean
  onClear: () => void
  clearing: boolean
  label: string
}
/** 「已手动设定」钉住标：表达该字段当前走 *_override，可一键撤销回落导入值。 */
function OverridePin({ pinned, onClear, clearing, label }: OverridePinProps) {
  if (!pinned) return null
  return (
    <button
      type='button'
      onClick={onClear}
      disabled={clearing}
      className='inline-flex shrink-0 items-center gap-1 rounded-md bg-d-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-d-warn-ink disabled:opacity-50'
      aria-label={`撤销${label}的手动设定`}
    >
      <LockIcon size={10} />
      已手动设定 · 撤销
    </button>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 rounded-xl bg-d-subtle px-3 py-2.5'>
      <span className='shrink-0 text-[13px] font-semibold text-d-muted'>{label}</span>
      <div className='flex min-w-0 flex-wrap items-center justify-end gap-1.5'>{children}</div>
    </div>
  )
}

interface BillEditFormProps {
  open: boolean
  bill: Bill | null
  /** 卡名 + 持卡人 + 账期（身份锁定展示） */
  identityLabel: string
  /** 已还总额（用于金额低于已还的触发器边界警告） */
  totalPaid: number
  currency: string
  onClose: () => void
  /** 保存/撤销/删除任一成功后回调（父组件负责重拉详情） */
  onSaved: () => void | Promise<void>
  /** 删除成功后回调（父组件负责跳转离开详情页） */
  onDeleted: () => void | Promise<void>
  /** 服务端是否允许删除（admin = true）。member 隐藏删除入口。 */
  canDelete: boolean
  /** 注入提交函数，测试替换；默认走 lib/api/bills 的 RPC 包装 */
  onSubmitFields?: (billId: string, fields: BillEditableFields) => Promise<Bill>
  onClearOverrideField?: (billId: string, fields: BillOverrideField[]) => Promise<Bill>
  onDeleteBill?: (billId: string) => Promise<void>
}

function toValues(bill: Bill): EditableFieldValues {
  return {
    amount: bill.bill_amount != null ? String(bill.bill_amount) : '',
    min_payment: bill.min_payment != null ? String(bill.min_payment) : '',
    statement_date: bill.statement_date ?? '',
    due_date: bill.due_date ?? '',
    statement_start: bill.statement_start ?? '',
    statement_end: bill.statement_end ?? '',
  }
}

/**
 * 账单编辑表单（spec 13 §6 / 画板 candidate.ios.bill-editing）。
 *
 * - 身份锁定：卡 + 账期事实不可变（UNIQUE(card_id, bill_month)），只读展示。
 * - 金额/最低还款/账单日/到期日走 *_override（updateBillFields），账期首末日
 *   在「高级」折叠里直接 UPDATE（无自动化争抢）。
 * - 状态四态选择，说明文案声明「保存前按已还总额重算」。
 * - 金额低于已还总额时给警示，不让用户去撞 PAYMENT_EXCEEDS_REMAINING。
 */
export function BillEditForm({
  open,
  bill,
  identityLabel,
  totalPaid,
  currency,
  onClose,
  onSaved,
  onDeleted,
  canDelete,
  onSubmitFields,
  onClearOverrideField,
  onDeleteBill,
}: BillEditFormProps) {
  const submitFields = onSubmitFields ?? updateBillFields
  const clearField: (billId: string, fields: BillOverrideField[]) => Promise<unknown> =
    onClearOverrideField ?? clearOverride
  const doDelete = onDeleteBill ?? deleteBill

  const [values, setValues] = useState<EditableFieldValues>({
    amount: '', min_payment: '', statement_date: '', due_date: '', statement_start: '', statement_end: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [clearingField, setClearingField] = useState<BillOverrideField | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // loadedId 防止父组件 reload 换对象引用后把用户正在编辑的值冲掉
  const [loadedId, setLoadedId] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !bill || loadedId === bill.id) return
    setValues(toValues(bill))
    setErrors({})
    setSubmitError(null)
    setAdvancedOpen(false)
    setLoadedId(bill.id)
  }, [open, bill, loadedId])
  useEffect(() => {
    if (!open) setLoadedId(null)
  }, [open])

  if (!open || !bill) return null

  const pinned = {
    amount: bill.bill_amount_override != null,
    min_payment: false, // min_payment_override 列未落地前服务端不返回钉住态
    statement_date: false, // 同上
    due_date: false,
  }

  const newAmount = Number(values.amount)
  const warnBelowPaid =
    values.amount.trim() !== '' &&
    Number.isFinite(newAmount) &&
    amountBelowPaidWarning(newAmount, totalPaid)

  const setField = (field: keyof EditableFieldValues) => (value: string) => {
    setValues(prev => ({ ...prev, [field]: value }))
    setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const handleClear = async (field: BillOverrideField) => {
    setClearingField(field)
    setSubmitError(null)
    try {
      await clearField(bill.id, [field])
      await onSaved()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '撤销失败，请重试')
    } finally {
      setClearingField(null)
    }
  }

  const handleSubmit = async () => {
    const nextErrors = validateEditableFields(values)
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.values(nextErrors).some(Boolean)) return

    setSubmitting(true)
    try {
      const fields: BillEditableFields = {
        amount: Number(values.amount),
        min_payment: values.min_payment.trim() ? Number(values.min_payment) : undefined,
        statement_date: values.statement_date.trim() || undefined,
        due_date: values.due_date.trim() || undefined,
        statement_start: values.statement_start.trim() || undefined,
        statement_end: values.statement_end.trim() || undefined,
      }
      await submitFields(bill.id, fields)
      await onSaved()
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await doDelete(bill.id)
      setDeleteConfirmOpen(false)
      await onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => !submitting && !clearingField && onClose()}
        dismissible={!submitting && !clearingField}
        title='编辑账单'
        maxWidth='md'
        footer={
          <>
            <Button variant='ghost' onClick={onClose} disabled={submitting || !!clearingField}>
              放弃
            </Button>
            <Button onClick={handleSubmit} loading={submitting}>
              {submitting ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {/* 身份锁定卡：UNIQUE(card_id, bill_month)，换卡 = 删旧建新 */}
          <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
            <p className='text-[13px] font-semibold leading-5 text-d-text'>{identityLabel}</p>
            <p className='mt-0.5 inline-flex items-center gap-1 text-[11px] leading-4 text-d-muted'>
              <LockIcon size={11} />
              卡与账期为账单身份，不可修改；如需更换请删除后重新录入
            </p>
          </div>

          <FieldRow label='账单金额'>
            <span className='num-tabular text-[13px] text-d-text'>
              {currency}
              {bill.bill_amount?.toLocaleString?.() ?? bill.bill_amount}
            </span>
            <OverridePin
              pinned={pinned.amount}
              onClear={() => handleClear('amount')}
              clearing={clearingField === 'amount'}
              label='账单金额'
            />
          </FieldRow>
          <TextField
            label='账单金额'
            type='number'
            inputMode='decimal'
            min={0}
            step='0.01'
            value={values.amount}
            onChange={e => setField('amount')(e.target.value)}
            error={!!errors.amount}
            helperText={errors.amount}
            startAdornment={<span className='text-[14px]'>{currency}</span>}
          />
          {warnBelowPaid && (
            <Alert severity='warning'>
              新金额低于已还总额（{currency}
              {totalPaid.toLocaleString()}）。保存后已还将超过账单金额，后续新增还款会被拒绝。
            </Alert>
          )}

          <TextField
            label='最低还款额'
            type='number'
            inputMode='decimal'
            min={0}
            step='0.01'
            value={values.min_payment}
            onChange={e => setField('min_payment')(e.target.value)}
            error={!!errors.min_payment}
            helperText={errors.min_payment}
            placeholder='可留空'
            startAdornment={<span className='text-[14px]'>{currency}</span>}
          />

          <TextField
            label='账单日'
            type='date'
            value={values.statement_date}
            onChange={e => setField('statement_date')(e.target.value)}
            error={!!errors.statement_date}
            helperText={errors.statement_date}
          />
          <TextField
            label='还款到期日'
            type='date'
            required
            value={values.due_date}
            onChange={e => setField('due_date')(e.target.value)}
            error={!!errors.due_date}
            helperText={errors.due_date}
          />

          {/* 状态：改前按已还总额重算，允许从结清回退（updateBillStatusChecked） */}
          <div>
            <p className='mb-1.5 text-[13px] font-semibold leading-5 text-d-muted'>状态</p>
            <div className='grid grid-cols-2 gap-1.5'>
              {(['unpaid', 'partial', 'paid', 'overdue'] as BillStatus[]).map(s => (
                <div
                  key={s}
                  className={
                    'rounded-xl border px-2.5 py-2 ' +
                    (bill.status === s
                      ? 'border-d-accent bg-d-subtle'
                      : 'border-d-border bg-d-surface opacity-70')
                  }
                >
                  <p className='text-[13px] font-semibold leading-4 text-d-text'>{STATUS_LABELS[s]}</p>
                  <p className='mt-0.5 text-[10px] leading-4 text-d-muted'>{STATUS_DESCRIPTIONS[s]}</p>
                </div>
              ))}
            </div>
            <p className='mt-1.5 text-[11px] leading-4 text-d-muted'>
              保存时按已还总额重算：已还 ≥ 生效金额即视为结清，允许从已结清回退。
            </p>
          </div>

          {/* 高级折叠：账期首末日直接 UPDATE（无自动化争抢，spec §6.1） */}
          <div className='rounded-xl border border-d-border'>
            <button
              type='button'
              onClick={() => setAdvancedOpen(v => !v)}
              className='flex w-full items-center justify-between px-3 py-2.5 text-left'
              aria-expanded={advancedOpen}
            >
              <span className='text-[13px] font-semibold text-d-muted'>高级 · 账期首末日</span>
              <ChevronDownIcon
                size={16}
                className={'text-d-muted transition-transform ' + (advancedOpen ? 'rotate-180' : '')}
              />
            </button>
            {advancedOpen && (
              <div className='flex flex-col gap-2.5 px-3 pb-3'>
                <TextField
                  label='账期首日'
                  type='date'
                  value={values.statement_start}
                  onChange={e => setField('statement_start')(e.target.value)}
                  error={!!errors.statement_start}
                  helperText={errors.statement_start}
                />
                <TextField
                  label='账期末日'
                  type='date'
                  value={values.statement_end}
                  onChange={e => setField('statement_end')(e.target.value)}
                  error={!!errors.statement_end}
                  helperText={errors.statement_end}
                />
              </div>
            )}
          </div>

          {submitError && <Alert severity='error'>{submitError}</Alert>}

          {/* 删除入口：仅 admin（deleteBill 服务端 admin only；member 经 guard） */}
          {canDelete && (
            <button
              type='button'
              onClick={() => setDeleteConfirmOpen(true)}
              className='inline-flex items-center justify-center gap-1.5 rounded-xl border border-d-danger/50 px-4 py-2.5 text-[13px] font-semibold text-d-danger-ink'
            >
              <TrashIcon size={14} />
              删除账单
            </button>
          )}
          {!canDelete && (
            <p className={LOCK_CLS}>删除账单仅限管理员操作。</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title='确认删除该账单？'
        onClose={() => !deleting && setDeleteConfirmOpen(false)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleDelete}
              disabled={deleting}
              className='h-10 rounded-xl bg-d-danger px-5 text-sm font-bold text-white disabled:opacity-50'
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          将删除 {identityLabel} 的账单记录，
          {totalPaid > 0 && (
            <>
              名下 <strong className='text-d-text'>{totalPaid.toLocaleString()}</strong> 已还记录将一并删除，
            </>
          )}
          此操作不可恢复。
        </p>
        {deleteError && <Alert severity='error'>{deleteError}</Alert>}
      </ConfirmDialog>
    </>
  )
}
