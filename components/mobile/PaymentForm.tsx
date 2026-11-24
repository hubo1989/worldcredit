'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { currencySymbol, normalizeCurrencyOrDefault, type FxRates } from '@/lib/fx'
import {
  computeLockedRate,
  computeSettledAmount,
  formatReferenceFxRate,
  validateFxLockInput,
} from '@/lib/direction3/pure'
import type { PaymentFxLockFields } from '@/lib/direction3/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (
    data: { amount: number; paid_at: string; note?: string } & PaymentFxLockFields,
  ) => Promise<void>
  totalAmount: number
  billMonth?: string
  /** 账单卡片原币种（默认 CNY） */
  billCurrency?: string
  /** 用户展示目标币种（默认 CNY） */
  displayCurrency?: string
  /** 当前参考汇率缓存 */
  fxRates?: FxRates | null
  /** 调用方可选传入：账单 ID（预留附件场景，当前对话框未使用） */
  billId?: string
  /** 调用方可选传入：附件变更后的刷新回调（预留附件场景，当前未使用） */
  onAttachmentChanged?: () => Promise<void>
}

const SETTLED_CURRENCIES = ['CNY', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'SGD']

export function PaymentForm({
  open,
  onClose,
  onSubmit,
  totalAmount,
  billMonth,
  billCurrency = 'CNY',
  displayCurrency = 'CNY',
  fxRates = null,
}: Props) {
  const normalizedBillCur = normalizeCurrencyOrDefault(billCurrency, 'CNY')
  const normalizedDisplayCur = normalizeCurrencyOrDefault(displayCurrency, 'CNY')
  const billSym = currencySymbol(normalizedBillCur)

  const [amount, setAmount] = useState(totalAmount.toString())
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [settledCurrency, setSettledCurrency] = useState(normalizedDisplayCur)
  const [settledAmountText, setSettledAmountText] = useState('')
  const [lockedRateText, setLockedRateText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount(totalAmount > 0 ? totalAmount.toString() : '')
      setPaidAt(new Date().toISOString().slice(0, 10))
      setNote('')
      setSettledCurrency(normalizedDisplayCur)
      setSettledAmountText('')
      setLockedRateText('')
      setError(null)
    }
  }, [open, totalAmount, normalizedDisplayCur])

  const parsedAmount = parseFloat(amount)
  const showFxLock = normalizedBillCur !== settledCurrency
  const refRate = showFxLock
    ? formatReferenceFxRate(normalizedBillCur, settledCurrency, fxRates)
    : null

  const handleAmountChange = (nextVal: string) => {
    setAmount(nextVal)
    const numAmt = parseFloat(nextVal)
    const rateNum = parseFloat(lockedRateText)
    if (Number.isFinite(numAmt) && numAmt > 0 && Number.isFinite(rateNum) && rateNum > 0) {
      setSettledAmountText(computeSettledAmount(numAmt, rateNum).toFixed(2))
    }
  }

  const handleSettledAmountChange = (nextVal: string) => {
    setSettledAmountText(nextVal)
    const settledNum = parseFloat(nextVal)
    if (
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      Number.isFinite(settledNum) &&
      settledNum > 0
    ) {
      setLockedRateText(computeLockedRate(parsedAmount, settledNum).toFixed(4))
    } else if (!nextVal.trim()) {
      setLockedRateText('')
    }
  }

  const handleRateChange = (nextVal: string) => {
    setLockedRateText(nextVal)
    const rateNum = parseFloat(nextVal)
    if (
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      Number.isFinite(rateNum) &&
      rateNum > 0
    ) {
      setSettledAmountText(computeSettledAmount(parsedAmount, rateNum).toFixed(2))
    } else if (!nextVal.trim()) {
      setSettledAmountText('')
    }
  }

  const handleApplyRefRate = () => {
    if (!refRate || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    setLockedRateText(refRate.toFixed(4))
    setSettledAmountText(computeSettledAmount(parsedAmount, refRate).toFixed(2))
  }

  const handleSubmit = async () => {
    setError(null)
    const num = parseFloat(amount)
    if (!num || num <= 0) return

    let fxFields: PaymentFxLockFields = {}
    if (showFxLock && (settledAmountText.trim() || lockedRateText.trim())) {
      const check = validateFxLockInput({
        amount: num,
        billCurrency: normalizedBillCur,
        settledCurrency,
        settledAmount: settledAmountText.trim() ? Number(settledAmountText) : null,
        lockedFxRate: lockedRateText.trim() ? Number(lockedRateText) : null,
      })
      if (!check.ok) {
        setError(check.error)
        return
      }
      fxFields = check.normalized
    }

    setSubmitting(true)
    try {
      await onSubmit({
        amount: num,
        paid_at: paidAt,
        note: note.trim() || undefined,
        ...fxFields,
      })
      onClose()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : '还款登记失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!submitting}
      title={`登记账单还款${billMonth ? ` (${billMonth})` : ''}`}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!amount || parseFloat(amount) <= 0}
          >
            {submitting ? '登记中...' : '确认已还款'}
          </Button>
        </>
      }
    >
      <p className='mb-4 text-[14px] leading-5 text-d-muted'>
        账单总额: {billSym}
        {totalAmount.toFixed(2)}（{normalizedBillCur}）
      </p>

      {error && (
        <div className='mb-3'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      <div className='flex flex-col gap-4'>
        <TextField
          label={`还款金额 (${normalizedBillCur})`}
          type='number'
          inputMode='decimal'
          step='0.01'
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          startAdornment={<span>{billSym}</span>}
          required
        />

        <TextField
          label='还款日期'
          type='date'
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
          required
        />

        {normalizedBillCur !== normalizedDisplayCur && (
          <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='text-[13px] font-semibold text-d-text'>
                实际购汇/扣款汇率锁定（选填）
              </p>
              <button
                type='button'
                disabled={!refRate || !Number.isFinite(parsedAmount) || parsedAmount <= 0}
                onClick={handleApplyRefRate}
                className='min-h-[44px] px-1.5 text-[12px] font-semibold text-d-accent-light disabled:opacity-40'
              >
                {refRate ? `按参考汇率 ${refRate.toFixed(4)} 锁定` : '参考汇率暂不可用'}
              </button>
            </div>

            <div className='flex flex-col gap-2.5'>
              <SelectField
                label='实际结算币种'
                value={settledCurrency}
                onChange={(e) => {
                  const nextCur = e.target.value
                  setSettledCurrency(nextCur)
                  if (nextCur === normalizedBillCur) {
                    setSettledAmountText('')
                    setLockedRateText('')
                  }
                }}
                options={SETTLED_CURRENCIES.map((c) => ({
                  value: c,
                  label: c === normalizedBillCur ? `${c}（同账单原币，不锁定）` : c,
                }))}
              />

              {showFxLock && (
                <div className='grid grid-cols-2 gap-2'>
                  <TextField
                    label={`实付金额 (${settledCurrency})`}
                    type='number'
                    inputMode='decimal'
                    step='0.01'
                    value={settledAmountText}
                    onChange={(e) => handleSettledAmountChange(e.target.value)}
                    startAdornment={<span>{currencySymbol(settledCurrency)}</span>}
                    placeholder='选填'
                  />
                  <TextField
                    label={`锁定汇率 (1 ${normalizedBillCur}=)`}
                    type='number'
                    inputMode='decimal'
                    step='0.0001'
                    value={lockedRateText}
                    onChange={(e) => handleRateChange(e.target.value)}
                    placeholder='如 7.2500'
                  />
                </div>
              )}
            </div>

            {!refRate && showFxLock && (
              <p className='mt-1.5 text-[11px] text-d-muted'>
                参考汇率暂不可用，可手动输入实付金额或汇率，也可留空
              </p>
            )}
          </div>
        )}

        <TextField
          label='还款备注'
          placeholder='如: 支付宝还款 / 网银转账'
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  )
}
