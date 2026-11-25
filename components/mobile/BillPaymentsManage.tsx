'use client'

import { useEffect, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { TrashIcon } from '@/components/icons/WcIcon'
import { updatePayment, deletePayment, type PaymentPatch } from '@/lib/api/bills'
import { currencySymbol, normalizeCurrencyOrDefault, type FxRates } from '@/lib/fx'
import {
  computeLockedRate,
  computeSettledAmount,
  formatReferenceFxRate,
  validateFxLockInput,
} from '@/lib/direction3/pure'
import { updatePaymentWithFx } from '@/lib/direction3/rpc'
import type { PaymentFxLockFields, PaymentWithFx } from '@/lib/direction3/types'
import { previewAfterPayments, STATUS_LABELS, isValidCalendarDate, type BillStatus } from './bill-editing-shared'

const SETTLED_CURRENCIES = ['CNY', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'SGD']

/** 列表态按账面值预览；编辑态把正在编辑的那笔替换成输入值。 */
function computePreview(
  editing: PaymentWithFx | null,
  effectiveAmount: number,
  payments: PaymentWithFx[],
  amountText: string,
) {
  if (!editing) return previewAfterPayments(effectiveAmount, payments, null, 0)
  const parsed = Number(amountText)
  return previewAfterPayments(
    effectiveAmount,
    payments,
    editing.id,
    Number.isFinite(parsed) ? parsed : 0,
  )
}

export interface BillPaymentsManageProps {
  open: boolean
  payments: PaymentWithFx[]
  /** 生效账单金额（override 优先），预览累计/剩余的基数 */
  effectiveAmount: number
  /** 展示符号（兼容传 '¥' 或 'CNY'） */
  currency: string
  /** 账单原币 ISO 码（用于跨币种 FX 锁定判断） */
  billCurrency?: string
  /** 用户展示目标币种 */
  displayCurrency?: string
  /** 参考汇率缓存 */
  fxRates?: FxRates | null
  onClose: () => void
  /** 任一改/删成功后回调（父组件重拉详情） */
  onChanged: () => void | Promise<void>
  /** 注入提交函数，测试替换；默认走 lib/api/bills 的 RPC 包装 */
  onUpdatePayment?: (paymentId: string, patch: PaymentPatch & PaymentFxLockFields) => Promise<void>
  onDeletePaymentFn?: (paymentId: string) => Promise<void>
}

function toInputValues(p: PaymentWithFx, defaultSettledCurrency: string) {
  return {
    amount: String(p.amount),
    paid_at: p.paid_at ? p.paid_at.slice(0, 10) : '',
    note: p.note ?? '',
    settled_currency: p.settled_currency ?? defaultSettledCurrency,
    settled_amount: p.settled_amount != null ? String(p.settled_amount) : '',
    locked_fx_rate: p.locked_fx_rate != null ? String(p.locked_fx_rate) : '',
  }
}

function currencyFromSymbolOrCode(symbolOrCode: string): string {
  if (symbolOrCode === '$') return 'USD'
  if (symbolOrCode === 'HK$') return 'HKD'
  return normalizeCurrencyOrDefault(symbolOrCode, 'CNY')
}

/**
 * 还款记录管理（spec 画板 candidate.ios.bill-editing-payments / -payment-edit）。
 */
export function BillPaymentsManage({
  open,
  payments,
  effectiveAmount,
  currency,
  billCurrency,
  displayCurrency = 'CNY',
  fxRates = null,
  onClose,
  onChanged,
  onUpdatePayment,
  onDeletePaymentFn,
}: BillPaymentsManageProps) {
  const doDelete = onDeletePaymentFn ?? deletePayment
  const normalizedBillCur = billCurrency
    ? normalizeCurrencyOrDefault(billCurrency, 'CNY')
    : currencyFromSymbolOrCode(currency)
  const normalizedDisplayCur = normalizeCurrencyOrDefault(displayCurrency, 'CNY')
  const displaySym = /^[A-Z]{3}$/i.test(currency) ? currencySymbol(currency) : currency

  // null = 列表态；PaymentWithFx = 单笔编辑态
  const [editing, setEditing] = useState<PaymentWithFx | null>(null)
  const [values, setValues] = useState({
    amount: '',
    paid_at: '',
    note: '',
    settled_currency: normalizedDisplayCur,
    settled_amount: '',
    locked_fx_rate: '',
  })
  const [fxCleared, setFxCleared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PaymentWithFx | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setDeleteTarget(null)
      setError(null)
      setFxCleared(false)
    }
  }, [open])

  const startEdit = (p: PaymentWithFx) => {
    setValues(toInputValues(p, normalizedDisplayCur))
    setFxCleared(false)
    setError(null)
    setEditing(p)
  }

  const parsedAmount = Number(values.amount)
  const isCrossCurrency = normalizedBillCur !== normalizedDisplayCur || Boolean(editing?.settled_currency)
  const showFxLockInputs = isCrossCurrency && values.settled_currency !== normalizedBillCur
  const refRate = showFxLockInputs
    ? formatReferenceFxRate(normalizedBillCur, values.settled_currency, fxRates)
    : null

  const handleAmountChange = (nextVal: string) => {
    const numAmt = Number(nextVal)
    const rateNum = Number(values.locked_fx_rate)
    setValues((prev) => ({
      ...prev,
      amount: nextVal,
      settled_amount:
        Number.isFinite(numAmt) && numAmt > 0 && Number.isFinite(rateNum) && rateNum > 0
          ? computeSettledAmount(numAmt, rateNum).toFixed(2)
          : prev.settled_amount,
    }))
  }

  const handleSettledAmountChange = (nextVal: string) => {
    const settledNum = Number(nextVal)
    setValues((prev) => ({
      ...prev,
      settled_amount: nextVal,
      locked_fx_rate:
        Number.isFinite(parsedAmount) &&
        parsedAmount > 0 &&
        Number.isFinite(settledNum) &&
        settledNum > 0
          ? computeLockedRate(parsedAmount, settledNum).toFixed(4)
          : !nextVal.trim()
            ? ''
            : prev.locked_fx_rate,
    }))
  }

  const handleRateChange = (nextVal: string) => {
    const rateNum = Number(nextVal)
    setValues((prev) => ({
      ...prev,
      locked_fx_rate: nextVal,
      settled_amount:
        Number.isFinite(parsedAmount) &&
        parsedAmount > 0 &&
        Number.isFinite(rateNum) &&
        rateNum > 0
          ? computeSettledAmount(parsedAmount, rateNum).toFixed(2)
          : !nextVal.trim()
            ? ''
            : prev.settled_amount,
    }))
  }

  const handleClearFxLock = () => {
    setFxCleared(true)
    setValues((prev) => ({
      ...prev,
      settled_amount: '',
      locked_fx_rate: '',
    }))
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

    const patch: PaymentPatch & PaymentFxLockFields = {
      amount,
      paid_at: values.paid_at,
      note: values.note.trim() || null,
    }

    const hadFxLock = Boolean(editing.settled_currency || editing.settled_amount || editing.locked_fx_rate)
    const hasFxInput = Boolean(values.settled_amount.trim() || values.locked_fx_rate.trim())

    if (showFxLockInputs && hasFxInput) {
      const check = validateFxLockInput({
        amount,
        billCurrency: normalizedBillCur,
        settledCurrency: values.settled_currency,
        settledAmount: values.settled_amount.trim() ? Number(values.settled_amount) : null,
        lockedFxRate: values.locked_fx_rate.trim() ? Number(values.locked_fx_rate) : null,
      })
      if (!check.ok) {
        setError(check.error)
        return
      }
      patch.settled_currency = check.normalized.settled_currency
      patch.settled_amount = check.normalized.settled_amount
      patch.locked_fx_rate = check.normalized.locked_fx_rate
    } else if (fxCleared || (hadFxLock && !hasFxInput)) {
      patch.settled_currency = null
      patch.settled_amount = null
      patch.locked_fx_rate = null
    }

    setSubmitting(true)
    setError(null)
    try {
      if (onUpdatePayment) {
        await onUpdatePayment(editing.id, patch)
      } else if (
        patch.settled_currency !== undefined ||
        patch.settled_amount !== undefined ||
        patch.locked_fx_rate !== undefined
      ) {
        await updatePaymentWithFx(editing.id, patch)
      } else {
        await updatePayment(editing.id, patch)
      }
      setEditing(null)
      setError(null)
      try {
        await onChanged()
      } catch {
        /* 列表刷新失败留给下一次进入/下拉刷新，不误报保存失败 */
      }
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
      setError(null)
      try {
        await onChanged()
      } catch {
        /* 删除已成功，刷新失败不误报「删除失败」 */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  const totalPaidNow = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const preview = computePreview(editing, effectiveAmount, payments, values.amount)

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (submitting || deleting) return
          if (editing) {
            setEditing(null)
            return
          }
          onClose()
        }}
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
                  {displaySym}
                  {effectiveAmount.toLocaleString()}
                </p>
              </div>
              <div className='rounded-xl bg-d-subtle p-2.5 text-center'>
                <p className='text-[11px] leading-4 text-d-muted'>已还</p>
                <p className='num-tabular mt-0.5 text-[15px] font-bold text-d-success-ink'>
                  {displaySym}
                  {totalPaidNow.toLocaleString()}
                </p>
              </div>
              <div className='rounded-xl bg-d-subtle p-2.5 text-center'>
                <p className='text-[11px] leading-4 text-d-muted'>剩余</p>
                <p className='num-tabular mt-0.5 text-[15px] font-bold text-d-danger-ink'>
                  {displaySym}
                  {Math.max(0, effectiveAmount - totalPaidNow).toLocaleString()}
                </p>
              </div>
            </div>

            {payments.length === 0 ? (
              <p className='py-4 text-center text-[13px] text-d-muted'>尚无还款记录</p>
            ) : (
              <div className='flex flex-col gap-1.5'>
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className='flex items-center justify-between gap-2 rounded-xl bg-d-subtle px-3 py-2.5'
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='num-tabular text-[14px] font-bold text-d-success-ink'>
                        +{displaySym}
                        {Number(p.amount).toLocaleString()}
                      </p>
                      <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
                        {p.paid_at ? p.paid_at.slice(0, 10) : '—'}
                        {p.channel ? ' · ' + p.channel : ''}
                        {p.note ? ' · ' + p.note : ''}
                      </p>
                      {p.settled_currency && p.settled_amount != null && p.locked_fx_rate != null ? (
                        <p className='mt-0.5 inline-flex rounded bg-d-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-d-success-ink'>
                          已锁汇率 1 {normalizedBillCur} = {Number(p.locked_fx_rate).toFixed(4)} {p.settled_currency} · 实付 {currencySymbol(p.settled_currency)}{Number(p.settled_amount).toLocaleString()}
                        </p>
                      ) : normalizedBillCur !== normalizedDisplayCur ? (
                        <p className='mt-0.5 text-[10px] text-d-muted'>
                          参考汇率折算 · 点击编辑可锁定实际汇率
                        </p>
                      ) : null}
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                      <button
                        type='button'
                        onClick={() => startEdit(p)}
                        className='min-h-[44px] px-1 text-[13px] font-semibold text-d-accent-light underline underline-offset-2'
                      >
                        编辑
                      </button>
                      <button
                        type='button'
                        onClick={() => setDeleteTarget(p)}
                        aria-label='删除该笔还款'
                        className='flex min-h-[44px] min-w-[32px] items-center justify-center text-d-danger-ink'
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
              onChange={(e) => handleAmountChange(e.target.value)}
              startAdornment={<span className='text-[14px]'>{displaySym}</span>}
            />
            <TextField
              label='还款日期'
              type='date'
              value={values.paid_at}
              onChange={(e) => setValues((prev) => ({ ...prev, paid_at: e.target.value }))}
            />
            <TextField
              label='备注'
              type='text'
              value={values.note}
              onChange={(e) => setValues((prev) => ({ ...prev, note: e.target.value }))}
              placeholder='可留空'
            />

            {isCrossCurrency && (
              <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <p className='text-[12px] font-semibold text-d-text'>
                    实际购汇/扣款汇率锁定
                  </p>
                  <div className='flex items-center gap-2'>
                    {refRate && showFxLockInputs && (
                      <button
                        type='button'
                        onClick={() => {
                          setFxCleared(false)
                          setValues((prev) => ({
                            ...prev,
                            locked_fx_rate: refRate.toFixed(4),
                            settled_amount:
                              Number.isFinite(parsedAmount) && parsedAmount > 0
                                ? computeSettledAmount(parsedAmount, refRate).toFixed(2)
                                : prev.settled_amount,
                          }))
                        }}
                        className='min-h-[44px] px-1 text-[11px] font-semibold text-d-accent-light'
                      >
                        参考汇率 {refRate.toFixed(4)}
                      </button>
                    )}
                    {(values.settled_amount || values.locked_fx_rate) && (
                      <button
                        type='button'
                        onClick={handleClearFxLock}
                        className='min-h-[44px] px-1 text-[11px] font-semibold text-d-danger-ink'
                      >
                        清除锁定汇率
                      </button>
                    )}
                  </div>
                </div>

                <SelectField
                  label='实际结算币种'
                  value={values.settled_currency}
                  onChange={(e) => {
                    const nextCur = e.target.value
                    setValues((prev) => ({
                      ...prev,
                      settled_currency: nextCur,
                      settled_amount: '',
                      locked_fx_rate: '',
                    }))
                  }}
                  options={SETTLED_CURRENCIES.map((c) => ({
                    value: c,
                    label: c === normalizedBillCur ? `${c}（同账单原币，不锁定）` : c,
                  }))}
                />

                {showFxLockInputs && (
                  <div className='mt-2.5 grid grid-cols-2 gap-2'>
                    <TextField
                      label={`实付金额 (${values.settled_currency})`}
                      type='number'
                      inputMode='decimal'
                      step='0.01'
                      value={values.settled_amount}
                      onChange={(e) => handleSettledAmountChange(e.target.value)}
                      startAdornment={<span>{currencySymbol(values.settled_currency)}</span>}
                    />
                    <TextField
                      label={`锁定汇率 (1 ${normalizedBillCur}=)`}
                      type='number'
                      inputMode='decimal'
                      step='0.0001'
                      value={values.locked_fx_rate}
                      onChange={(e) => handleRateChange(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 改后预览：累计 / 剩余 / 状态 */}
            <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
              <p className='text-[11px] leading-4 text-d-muted'>保存后预览</p>
              <div className='mt-1.5 flex items-center justify-between text-[13px]'>
                <span className='text-d-muted'>
                  累计已还
                  <span className='num-tabular ml-1.5 font-bold text-d-success-ink'>
                    {displaySym}
                    {preview.totalPaid.toLocaleString()}
                  </span>
                </span>
                <span className='text-d-muted'>
                  剩余
                  <span className='num-tabular ml-1.5 font-bold text-d-danger-ink'>
                    {displaySym}
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
              className='h-11 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleDelete}
              disabled={deleting}
              className='h-11 rounded-xl bg-d-danger px-5 text-sm font-bold text-white disabled:opacity-50'
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          将删除{' '}
          <strong className='num-tabular text-d-text'>
            {displaySym}
            {deleteTarget ? Number(deleteTarget.amount).toLocaleString() : ''}
          </strong>{' '}
          的还款记录，账单状态将按剩余还款自动重算。
        </p>
      </ConfirmDialog>
    </>
  )
}
