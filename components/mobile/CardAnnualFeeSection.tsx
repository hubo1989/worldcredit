'use client'

import { useState } from 'react'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert, ProgressBar } from '@/components/obsidian/feedback'
import { ConfirmDialog, Modal, Toast } from '@/components/obsidian/overlays'
import { currencySymbol } from '@/lib/fx'
import { getLocalTodayString } from '@/lib/utils'
import {
  getCardCycleSpendEstimate,
  updateCardAnnualFeeFields,
} from '@/lib/recommendations-ui/rpc'
import {
  formatCurrencyAmount,
  parseAnnualFeeWaiverRules,
  parseWaiverProgress,
  resolveAnnualFeeCycleLocal,
} from '@/lib/recommendations-ui/helpers'
import {
  ANNUAL_FEE_CYCLE_LABELS,
  ANNUAL_FEE_STATUS_LABELS,
  ANNUAL_FEE_WAIVER_TYPE_LABELS,
  type AnnualFeeCycleType,
  type AnnualFeeStatus,
  type CardProductWithRules,
  type CreditCardWithAnnualFee,
  type WaiverProgressV1,
} from '@/lib/recommendations-ui/types'

interface Props {
  card: CreditCardWithAnnualFee
  product: CardProductWithRules | null | undefined
  onUpdated: () => void
}

export function CardAnnualFeeSection({ card, product, onUpdated }: Props) {
  const todayStr = getLocalTodayString()
  const cardCurrency = product?.currency || 'CNY'
  const cycleState = resolveAnnualFeeCycleLocal(card, product, todayStr)
  const waiverRule = parseAnnualFeeWaiverRules(product?.annual_fee_waiver_rules_json)
  const waiverProgress = parseWaiverProgress(card.waiver_progress_json)

  const [editOpen, setEditOpen] = useState(false)
  const [waiveConfirmOpen, setWaiveConfirmOpen] = useState(false)
  const [rolloverConfirmOpen, setRolloverConfirmOpen] = useState(false)

  // 编辑表单状态
  const [feeOverrideInput, setFeeOverrideInput] = useState('')
  const [cycleTypeInput, setCycleTypeInput] = useState<string>('')
  const [nextDueInput, setNextDueInput] = useState('')
  const [statusInput, setStatusInput] = useState<AnnualFeeStatus>('in_progress')
  const [actualPaidInput, setActualPaidInput] = useState('')
  const [progressAmountInput, setProgressAmountInput] = useState('')
  const [progressCountInput, setProgressCountInput] = useState('')
  const [progressSource, setProgressSource] = useState<WaiverProgressV1['source']>('manual')
  const [progressAsOf, setProgressAsOf] = useState(todayStr)
  const [progressNote, setProgressNote] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'info' | 'error'
  }>({ open: false, message: '', severity: 'success' })

  if (card.card_type === 'loan') return null

  const openEditModal = () => {
    setFormError(null)
    setFeeOverrideInput(
      card.annual_fee_override !== null && card.annual_fee_override !== undefined
        ? String(card.annual_fee_override)
        : ''
    )
    setCycleTypeInput(card.annual_fee_cycle_type ?? product?.annual_fee_cycle_type ?? '')
    setNextDueInput(card.next_annual_fee_date ?? '')
    setStatusInput(cycleState.status)
    setActualPaidInput(
      card.actual_fee_paid !== null && card.actual_fee_paid !== undefined
        ? String(card.actual_fee_paid)
        : ''
    )
    setProgressAmountInput(waiverProgress ? String(waiverProgress.amount) : '0')
    setProgressCountInput(waiverProgress ? String(waiverProgress.count) : '0')
    setProgressSource(waiverProgress?.source ?? 'manual')
    setProgressAsOf(waiverProgress?.as_of_on || todayStr)
    setProgressNote(waiverProgress?.note ?? '')
    setEditOpen(true)
  }

  const handlePrefillFromEstimate = async () => {
    setEstimating(true)
    setFormError(null)
    try {
      const est = await getCardCycleSpendEstimate(card.id)
      setProgressAmountInput(String(est.estimated_amount))
      setProgressCountInput(String(est.estimated_count))
      setProgressSource(est.source === 'none' ? 'manual' : est.source)
      setProgressAsOf(todayStr)
      setProgressNote(est.note)
      setToast({
        open: true,
        message: est.note || '已预填参考进度，请核对后保存',
        severity: 'info',
      })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '获取账单参考进度失败')
    } finally {
      setEstimating(false)
    }
  }

  const handleSaveEdit = async () => {
    setFormError(null)
    const trimmedFee = feeOverrideInput.trim()
    let annualFeeOverride: number | null = null
    if (trimmedFee) {
      const n = Number(trimmedFee)
      if (!Number.isFinite(n) || n < 0) {
        setFormError('年费覆盖金额必须为非负数')
        return
      }
      annualFeeOverride = n
    }

    const trimmedPaid = actualPaidInput.trim()
    let actualFeePaid: number | null = null
    if (trimmedPaid) {
      const n = Number(trimmedPaid)
      if (!Number.isFinite(n) || n < 0) {
        setFormError('实缴年费金额必须为非负数')
        return
      }
      actualFeePaid = n
    }

    const trimmedDue = nextDueInput.trim()
    if (trimmedDue && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
      setFormError('下次年费扣费日格式必须为 YYYY-MM-DD')
      return
    }

    const progAmt = Number(progressAmountInput.trim() || '0')
    const progCnt = Number(progressCountInput.trim() || '0')
    if (!Number.isFinite(progAmt) || progAmt < 0 || !Number.isFinite(progCnt) || progCnt < 0) {
      setFormError('免年费消费额与笔数必须为非负数')
      return
    }

    const nextProgress: WaiverProgressV1 = {
      schema_version: 1,
      cycle_due_date: trimmedDue || cycleState.nextDueDate || null,
      amount: progAmt,
      count: Math.trunc(progCnt),
      as_of_on: progressAsOf || todayStr,
      source: progressSource,
      note: progressNote.trim() || null,
    }

    setSaving(true)
    try {
      await updateCardAnnualFeeFields(card.id, {
        annual_fee_override: annualFeeOverride,
        annual_fee_cycle_type: (cycleTypeInput || null) as AnnualFeeCycleType | null,
        next_annual_fee_date: trimmedDue || null,
        annual_fee_status: statusInput,
        actual_fee_paid: statusInput === 'waived' ? 0 : actualFeePaid,
        waiver_progress_json: JSON.stringify(nextProgress),
      })
      setEditOpen(false)
      setToast({ open: true, message: '已保存年费周期与免年费进度', severity: 'success' })
      onUpdated()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存年费信息失败')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmWaived = async () => {
    setSaving(true)
    try {
      await updateCardAnnualFeeFields(card.id, {
        annual_fee_status: 'waived',
        actual_fee_paid: 0,
      })
      setWaiveConfirmOpen(false)
      setToast({ open: true, message: '已标记本周期免年费', severity: 'success' })
      onUpdated()
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '更新状态失败',
        severity: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmRollover = async () => {
    if (!cycleState.rolloverNextDueDate) return
    setSaving(true)
    try {
      const resetProgress: WaiverProgressV1 = {
        schema_version: 1,
        cycle_due_date: cycleState.rolloverNextDueDate,
        amount: 0,
        count: 0,
        as_of_on: todayStr,
        source: 'manual',
        note: '结转至新周期重置进度',
      }
      await updateCardAnnualFeeFields(card.id, {
        next_annual_fee_date: cycleState.rolloverNextDueDate,
        annual_fee_status: 'in_progress',
        actual_fee_paid: null,
        waiver_progress_json: JSON.stringify(resetProgress),
      })
      setRolloverConfirmOpen(false)
      setToast({ open: true, message: '已结转至下一周年并重置进度', severity: 'success' })
      onUpdated()
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '结转失败',
        severity: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const amountTarget = waiverRule?.target_amount ?? null
  const countTarget = waiverRule?.target_count ?? null
  const currAmount = waiverProgress?.amount ?? 0
  const currCount = waiverProgress?.count ?? 0
  const amountReached = amountTarget !== null && amountTarget > 0 && currAmount >= amountTarget
  const countReached = countTarget !== null && countTarget > 0 && currCount >= countTarget
  const waiverTargetReached =
    waiverRule?.waiver_type === 'spend_amount'
      ? amountReached
      : waiverRule?.waiver_type === 'spend_count'
        ? countReached
        : waiverRule?.waiver_type === 'spend_amount_or_count'
          ? amountReached || countReached
          : false

  return (
    <div className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>年费周期与免年费进度</p>
        <button
          type='button'
          onClick={openEditModal}
          className='min-h-[36px] rounded-lg bg-d-accent px-3 py-1 text-[12px] font-semibold text-white active:opacity-80'
        >
          编辑年费
        </button>
      </div>

      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <p className='text-[12px] text-d-muted'>当前有效年费</p>
            <p className='num-tabular text-[18px] font-bold text-d-text'>
              {cycleState.nominalFee > 0
                ? formatCurrencyAmount(cycleState.nominalFee, cardCurrency)
                : '免年费'}
            </p>
          </div>
          <span
            className={
              'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
              (cycleState.status === 'waived' || cycleState.status === 'not_applicable'
                ? 'bg-d-success-soft text-d-success-ink'
                : cycleState.status === 'paid'
                  ? 'bg-d-danger-soft text-d-danger-ink'
                  : 'bg-d-subtle text-d-accent-light')
            }
          >
            {ANNUAL_FEE_STATUS_LABELS[cycleState.status]}
          </span>
        </div>

        <div className='mt-3 flex flex-col gap-1.5 text-[12px]'>
          <div className='flex items-center justify-between'>
            <span className='text-d-muted'>年费周期</span>
            <span className='font-semibold text-d-text'>
              {cycleState.cycleType ? ANNUAL_FEE_CYCLE_LABELS[cycleState.cycleType] : '未配置'}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-d-muted'>下次扣费日</span>
            {cycleState.nextDueDate ? (
              <span className='num-tabular font-semibold text-d-text'>
                {cycleState.nextDueDate}
                {cycleState.daysUntilDue !== null && (
                  <span
                    className={
                      'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ' +
                      (cycleState.daysUntilDue <= 30 && cycleState.daysUntilDue >= 0
                        ? 'bg-d-danger-soft text-d-danger-ink'
                        : 'bg-d-subtle text-d-muted')
                    }
                  >
                    {cycleState.daysUntilDue > 0
                      ? `剩 ${cycleState.daysUntilDue} 天`
                      : cycleState.daysUntilDue === 0
                        ? '今日扣费'
                        : `已过 ${Math.abs(cycleState.daysUntilDue)} 天`}
                  </span>
                )}
              </span>
            ) : (
              <span className='font-semibold text-d-warn-ink'>未知</span>
            )}
          </div>
        </div>

        {/* WC-BEN-12 铁律提示：未知日期绝不编造，提示补充 */}
        {cycleState.nominalFee > 0 &&
          cycleState.cycleType !== 'none' &&
          !cycleState.nextDueDate && (
            <div className='mt-2.5'>
              <Alert
                severity='warning'
                action={
                  <button
                    type='button'
                    onClick={openEditModal}
                    className='h-8 rounded-full bg-d-accent px-3 text-[11px] font-semibold text-white'
                  >
                    去补充
                  </button>
                }
              >
                年费到期日未知，请补充发卡日或下次扣费日以开启年费前 30 天提醒。
              </Alert>
            </div>
          )}

        {/* 免年费政策与进度条 */}
        {(waiverRule || product?.annual_fee_waiver) && (
          <div className='mt-3 rounded-xl bg-d-subtle p-3'>
            <div className='flex items-center justify-between gap-2 text-[12px]'>
              <span className='font-semibold text-d-text'>
                {waiverRule
                  ? ANNUAL_FEE_WAIVER_TYPE_LABELS[waiverRule.waiver_type]
                  : '免年费条款参考'}
              </span>
              {waiverProgress?.as_of_on && (
                <span className='text-[11px] text-d-muted'>截至 {waiverProgress.as_of_on}</span>
              )}
            </div>

            {amountTarget !== null && amountTarget > 0 && (
              <div className='mt-2'>
                <div className='mb-1 flex justify-between text-[11px]'>
                  <span className='text-d-muted'>累计合格消费额</span>
                  <span className='num-tabular font-semibold text-d-text'>
                    {formatCurrencyAmount(
                      currAmount,
                      waiverRule?.target_currency || cardCurrency
                    )}{' '}
                    /{' '}
                    {formatCurrencyAmount(
                      amountTarget,
                      waiverRule?.target_currency || cardCurrency
                    )}
                  </span>
                </div>
                <ProgressBar value={Math.min(100, Math.round((currAmount / amountTarget) * 100))} />
              </div>
            )}

            {countTarget !== null && countTarget > 0 && (
              <div className='mt-2'>
                <div className='mb-1 flex justify-between text-[11px]'>
                  <span className='text-d-muted'>累计合格消费笔数</span>
                  <span className='num-tabular font-semibold text-d-text'>
                    {currCount} / {countTarget} 笔
                  </span>
                </div>
                <ProgressBar value={Math.min(100, Math.round((currCount / countTarget) * 100))} />
              </div>
            )}

            {(waiverRule?.notes || product?.annual_fee_waiver) && (
              <p className='mt-2 text-[11px] leading-4 text-d-muted'>
                {waiverRule?.notes || product?.annual_fee_waiver}
              </p>
            )}
          </div>
        )}

        {/* 快捷操作按钮 */}
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button size='sm' variant='secondary' className='min-h-[44px]' onClick={openEditModal}>
            更新进度
          </Button>
          {cycleState.nominalFee > 0 && cycleState.status !== 'waived' && (
            <Button
              size='sm'
              variant={waiverTargetReached ? 'primary' : 'secondary'}
              className='min-h-[44px]'
              onClick={() => setWaiveConfirmOpen(true)}
            >
              {waiverTargetReached ? '已达标 · 确认免年费' : '标记已免年费'}
            </Button>
          )}
          {cycleState.isOverdueDueDate && cycleState.rolloverNextDueDate && (
            <Button
              size='sm'
              variant='secondary'
              className='min-h-[44px]'
              onClick={() => setRolloverConfirmOpen(true)}
            >
              结转至下一周年 ({cycleState.rolloverNextDueDate})
            </Button>
          )}
        </div>
      </div>

      {/* 编辑年费周期与进度 Modal */}
      <Modal
        open={editOpen}
        title='编辑年费周期与免年费进度'
        onClose={() => !saving && setEditOpen(false)}
        maxWidth='md'
        footer={
          <>
            <Button variant='ghost' onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3.5'>
          {formError && <Alert severity='error'>{formError}</Alert>}

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <TextField
              label={`卡级年费覆盖（${cardCurrency}，留空用卡产品默认）`}
              type='number'
              inputMode='decimal'
              min='0'
              placeholder={
                product?.annual_fee != null ? `卡产品默认 ${product.annual_fee}` : '0'
              }
              value={feeOverrideInput}
              onChange={(e) => setFeeOverrideInput(e.target.value)}
              startAdornment={<span>{currencySymbol(cardCurrency)}</span>}
            />
            <SelectField
              label='年费周期类型'
              value={cycleTypeInput}
              onChange={(e) => setCycleTypeInput(e.target.value)}
              options={[
                { value: '', label: '沿用卡产品默认 / 未设置' },
                ...(Object.keys(ANNUAL_FEE_CYCLE_LABELS) as AnnualFeeCycleType[]).map((k) => ({
                  value: k,
                  label: ANNUAL_FEE_CYCLE_LABELS[k],
                })),
              ]}
            />
          </div>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <TextField
              label='下次年费扣费日'
              type='date'
              value={nextDueInput}
              onChange={(e) => setNextDueInput(e.target.value)}
              helperText='有确切日期时开启前 30 天提醒'
            />
            <SelectField
              label='本周期年费状态'
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value as AnnualFeeStatus)}
              options={(Object.keys(ANNUAL_FEE_STATUS_LABELS) as AnnualFeeStatus[]).map((k) => ({
                value: k,
                label: ANNUAL_FEE_STATUS_LABELS[k],
              }))}
            />
          </div>

          <TextField
            label={`本周期实缴年费（${cardCurrency}，选填）`}
            type='number'
            inputMode='decimal'
            min='0'
            placeholder='已免除填 0；未出账留空按标价估算'
            value={actualPaidInput}
            onChange={(e) => setActualPaidInput(e.target.value)}
            startAdornment={<span>{currencySymbol(cardCurrency)}</span>}
          />

          <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='text-[13px] font-semibold text-d-text'>免年费刷卡累计进度</p>
              <Button
                type='button'
                size='sm'
                variant='secondary'
                loading={estimating}
                onClick={handlePrefillFromEstimate}
              >
                按账单参考填充
              </Button>
            </div>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <TextField
                label={`已消费金额（${cardCurrency}）`}
                type='number'
                inputMode='decimal'
                min='0'
                value={progressAmountInput}
                onChange={(e) => {
                  setProgressAmountInput(e.target.value)
                  setProgressSource('manual')
                }}
                startAdornment={<span>{currencySymbol(cardCurrency)}</span>}
              />
              <TextField
                label='已消费笔数'
                type='number'
                inputMode='numeric'
                min='0'
                value={progressCountInput}
                onChange={(e) => {
                  setProgressCountInput(e.target.value)
                  setProgressSource('manual')
                }}
                endAdornment={<span>笔</span>}
              />
            </div>
            {progressNote && (
              <p className='mt-1.5 text-[11px] text-d-muted'>{progressNote}</p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={waiveConfirmOpen}
        title='确认标记本周期已免年费？'
        onClose={() => !saving && setWaiveConfirmOpen(false)}
        actions={
          <>
            <Button variant='ghost' onClick={() => setWaiveConfirmOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={handleConfirmWaived}>
              确认已豁免
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-d-muted'>
          标记为「已免除」后，本周期年费成本按 0 计入 ROI，并自动停止后续 7/1/0 天年费催促提醒。
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={rolloverConfirmOpen}
        title='结转至下一周年期？'
        onClose={() => !saving && setRolloverConfirmOpen(false)}
        actions={
          <>
            <Button variant='ghost' onClick={() => setRolloverConfirmOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={handleConfirmRollover}>
              确认结转
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-d-muted'>
          将下次年费扣费日推进至 {cycleState.rolloverNextDueDate}，并将本周期免年费进度归零重新统计。
        </p>
      </ConfirmDialog>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
