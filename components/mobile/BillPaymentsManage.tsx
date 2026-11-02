'use client'

import { useEffect, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { TrashIcon } from '@/components/icons/WcIcon'
import { updatePayment, deletePayment, type PaymentPatch } from '@/lib/api/bills'
import type { Payment } from '@/lib/types'
import { previewAfterPayments, STATUS_LABELS, isValidCalendarDate, type BillStatus } from './bill-editing-shared'

export interface BillPaymentsManageProps {
  open: boolean
  payments: Payment[]
  /** 生效账单金额（override 优先），预览累计/剩余的基数 */
  effectiveAmount: number
  currency: string
  onClose: () => void
  /** 任一改/删成功后回调（父组件重拉详情） */
  onChanged: () => void | Promise<void>
  /** 注入提交函数，测试替换；默认走 lib/api/bills 的 RPC 包装 */
  onUpdatePayment?: (paymentId: string, patch: PaymentPatch) => Promise<void>
  onDeletePaymentFn?: (paymentId: string) => Promise<void>
}

function toInputValues(p: Payment) {
  return {
    amount: String(p.amount),
    paid_at: p.paid_at ? p.paid_at.slice(0, 10) : '',
    note: p.note ?? '',
  }
}

/**
 * 还款记录管理（spec 画板 candidate.ios.bill-editing-payments / -payment-edit）。
 *
 * 汇总应还/已还/剩余；每笔可改（金额/日期/备注）可删；改删后预览
 * 累计/剩余/状态——预览口径 = previewAfterPayments（与服务端重算一致：
 * 已还 ≥ 生效金额 − 0.01 即 paid，允许回退）。
 */
export function BillPaymentsManage({
  open,
  payments,
  effectiveAmount,
  currency,
  onClose,
  onChanged,
  onUpdatePayment,
  onDeletePaymentFn,
}: BillPaymentsManageProps) {
  const doUpdate = onUpdatePayment ?? updatePayment
  const doDelete = onDeletePaymentFn ?? deletePayment

  // null = 列表态；Payment = 单笔编辑态
  const [editing, setEditing] = useState<Payment | null>(null)
  const [values, setValues] = useState({ amount: '', paid_at: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 弹窗每次打开重置到列表态；列表数据随父组件刷新
  useEffect(() => {
    if (!open) {
      setEditing(null)
      setDeleteTarget(null)
      setError(null)
    }
  }, [open])

  const startEdit = (p: Payment) => {
    setValues(toInputValues(p))
    setError(null)
    setEditing(p)
  }

  const handleUpdate = async () => {
    if (!editing) return
    const amount = Number(values.amount)
    if (!values.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('还款金额必须是大于 0 的数字')
      return
    }
    if (!isValidCalendarDate(values.paid_at)) {
      setError('还款日期必须是 YYYY-MM-DD 格式的真实日历日')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await doUpdate(editing.id, {
        amount,
        paid_at: values.paid_at,
        note: values.note.trim() || null,
      })
      setEditing(null)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await doDelete(deleteTarget.id)
      setDeleteTarget(null)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  const totalPaidNow = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const preview = editing
    ? previewAfterPayments(
        effectiveAmount,
        payments,
        editing.id,
        Number.isFinite(Number(values.amount)) ? Number(values.amount) : 0,
      )
    : previewAfterPayments(effectiveAmount, payments, null, 0)

  return (
    <>
      <Modal
        open={open}
        onClose={() => !submitting && !deleting && onClose()}
        dismissible={!submitting && !deleting}
        title={editing ? '编辑还款记录' : '还款记录'}
        maxWidth='md'
        footer={
          editing ? (
            <>
              <Button variant='ghost' onClick={() => setEditing(null)} disabled={submitting}>
                返回
              </Button>
              <Button onClick={handleUpdate} loading={submitting}>
                {submitting ? '保存中…' : '保存'}
              </Button>
            </>
          ) : (
            <Button variant='ghost' onClick={onClose}>
              关闭
            </Button>
          )
        }
      >
        {!editing && (
          <>
            {/* 汇总：应还 / 已还 / 剩余 */}
            <div className='mb-3 grid grid-cols-3 gap-1.5'>
              <div className='rounded-xl bg-d-subtle p-2.5 text-center'>
                <p className='text-[11px] leading-4 text-d-muted'>应还</p>
                <p className='num-tabular mt-0.5 text-[15px] font-bold text-d-text'>
                  {currency}
                  {effectiveAmount.toLocaleString()}
                </p>
              </div>
              <div className='rounded-xl bg-d-subtle p-2.5 text-center'>
                <p className='text-[11px] leading-4 text-d-muted'>已还</p>
                <p className='num-tabular mt-0.5 text-[15px] font-bold text-d-success-ink'>
                  {currency}
                  {totalPaidNow.toLocaleString()}
                </p>
              </div>
              <div className='rounded-xl bg-d-subtle p-2.5 text-center'>
                <p className='text-[11px] leading-4 text-d-muted'>剩余</p>
                <p className='num-tabular mt-0.5 text-[15px] font-bold text-d-danger-ink'>
                  {currency}
                  {Math.max(0, effectiveAmount - totalPaidNow).toLocaleString()}
                </p>
              </div>
            </div>

            {payments.length === 0 ? (
              <p className='py-4 text-center text-[13px] text-d-muted'>尚无还款记录</p>
            ) : (
              <div className='flex flex-col gap-1.5'>
                {payments.map(p => (
                  <div
                    key={p.id}
                    className='flex items-center justify-between gap-2 rounded-xl bg-d-subtle px-3 py-2.5'
                  >
                    <div className='min-w-0'>
                      <p className='num-tabular text-[14px] font-bold text-d-success-ink'>
                        +{currency}
                        {Number(p.amount).toLocaleString()}
                      </p>
                      <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
                        {p.paid_at ? p.paid_at.slice(0, 10) : '—'}
                        {p.channel ? ' · ' + p.channel : ''}
                        {p.note ? ' · ' + p.note : ''}
                      </p>
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                      <button
                        type='button'
                        onClick={() => startEdit(p)}
                        className='text-[13px] font-semibold text-d-accent-light underline underline-offset-2'
                      >
                        编辑
                      </button>
                      <button
                        type='button'
                        onClick={() => setDeleteTarget(p)}
                        aria-label='删除该笔还款'
                        className='text-d-danger-ink'
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className='mt-2 text-[11px] leading-4 text-d-muted'>
              删改后系统按已还总额自动重算账单状态，允许从已结清回退。
            </p>
            {/* 列表态也要有错误出口：删除失败回到列表态，Alert 若只在编辑态
                分支渲染，破坏性操作的失败原因就看不到 */}
            {error && <Alert severity='error'>{error}</Alert>}
          </>
        )}

        {editing && (
          <div className='flex flex-col gap-3'>
            <TextField
              label='还款金额'
              type='number'
              inputMode='decimal'
              min={0}
              step='0.01'
              value={values.amount}
              onChange={e => setValues(prev => ({ ...prev, amount: e.target.value }))}
              startAdornment={<span className='text-[14px]'>{currency}</span>}
            />
            <TextField
              label='还款日期'
              type='date'
              value={values.paid_at}
              onChange={e => setValues(prev => ({ ...prev, paid_at: e.target.value }))}
            />
            <TextField
              label='备注'
              type='text'
              value={values.note}
              onChange={e => setValues(prev => ({ ...prev, note: e.target.value }))}
              placeholder='可留空'
            />

            {/* 改后预览：累计 / 剩余 / 状态 */}
            <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
              <p className='text-[11px] leading-4 text-d-muted'>保存后预览</p>
              <div className='mt-1.5 flex items-center justify-between text-[13px]'>
                <span className='text-d-muted'>
                  累计已还
                  <span className='num-tabular ml-1.5 font-bold text-d-success-ink'>
                    {currency}
                    {preview.totalPaid.toLocaleString()}
                  </span>
                </span>
                <span className='text-d-muted'>
                  剩余
                  <span className='num-tabular ml-1.5 font-bold text-d-danger-ink'>
                    {currency}
                    {preview.remaining.toLocaleString()}
                  </span>
                </span>
                <span className='rounded-md bg-d-subtle px-2 py-0.5 text-[12px] font-semibold text-d-text'>
                  {STATUS_LABELS[preview.status as BillStatus]}
                </span>
              </div>
            </div>
            {error && <Alert severity='error'>{error}</Alert>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title='确认删除该笔还款？'
        onClose={() => !deleting && setDeleteTarget(null)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setDeleteTarget(null)}
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
          将删除{' '}
          <strong className='num-tabular text-d-text'>
            {currency}
            {deleteTarget ? Number(deleteTarget.amount).toLocaleString() : ''}
          </strong>{' '}
          的还款记录，账单状态将按剩余还款自动重算。
        </p>
      </ConfirmDialog>
    </>
  )
}
