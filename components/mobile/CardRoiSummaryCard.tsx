'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert, ProgressBar, Skeleton } from '@/components/obsidian/feedback'
import { Modal, Toast } from '@/components/obsidian/overlays'
import { currencySymbol } from '@/lib/fx'
import {
  getCardAnnualFeeRoi,
  updateCardAnnualFeeFields,
  updateOpportunityValuation,
} from '@/lib/recommendations-ui/rpc'
import { formatCurrencyAmount, formatPct1 } from '@/lib/recommendations-ui/helpers'
import {
  ROI_DECISION_META,
  type CardAnnualFeeRoiDetail,
  type CardProductWithRules,
  type CreditCardWithAnnualFee,
} from '@/lib/recommendations-ui/types'

interface Props {
  card: CreditCardWithAnnualFee
  product: CardProductWithRules | null | undefined
  onUpdated: () => void
  highlighted?: boolean
}

export function CardRoiSummaryCard({ card, product, onUpdated, highlighted = false }: Props) {
  const cardCurrency = product?.currency || 'CNY'
  const [periodMode, setPeriodMode] = useState<'current_cycle' | 'last_12m' | 'year'>('current_cycle')
  const [roi, setRoi] = useState<CardAnnualFeeRoiDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualRewardInput, setManualRewardInput] = useState('')
  const [savingManual, setSavingManual] = useState(false)

  const [valuationTarget, setValuationTarget] = useState<{
    account_id: string | null
    definition_id: string | null
    title: string
  } | null>(null)
  const [unitValueInput, setUnitValueInput] = useState('')
  const [savingValuation, setSavingValuation] = useState(false)

  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const loadRoi = useCallback(async () => {
    if (card.card_type === 'loan') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await getCardAnnualFeeRoi(card.id, {
        period_mode: periodMode,
        year: periodMode === 'year' ? new Date().getFullYear() : undefined,
      })
      setRoi(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载单卡年费 ROI 失败')
    } finally {
      setLoading(false)
    }
  }, [card.card_type, card.id, periodMode])

  useEffect(() => {
    void loadRoi()
  }, [loadRoi])

  if (card.card_type === 'loan') return null

  const handleSaveManualReward = async () => {
    const trimmed = manualRewardInput.trim()
    const val = trimmed ? Number(trimmed) : 0
    if (!Number.isFinite(val) || val < 0) {
      setToast({ open: true, message: '返现/积分变现金额必须为非负数', severity: 'error' })
      return
    }
    setSavingManual(true)
    try {
      await updateCardAnnualFeeFields(card.id, { manual_reward_value: val })
      setManualModalOpen(false)
      setToast({ open: true, message: '已更新本周期返现/积分变现补录', severity: 'success' })
      await loadRoi()
      onUpdated()
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '保存失败',
        severity: 'error',
      })
    } finally {
      setSavingManual(false)
    }
  }

  const handleSaveValuation = async () => {
    if (!valuationTarget) return
    const targetKind = valuationTarget.account_id ? 'account' : 'definition'
    const targetId = valuationTarget.account_id ?? valuationTarget.definition_id
    if (!targetId) {
      setToast({ open: true, message: '缺少可更新的权益标识', severity: 'error' })
      return
    }
    const val = Number(unitValueInput.trim())
    if (!Number.isFinite(val) || val < 0) {
      setToast({ open: true, message: '请输入大于等于 0 的单次估值金额', severity: 'error' })
      return
    }
    setSavingValuation(true)
    try {
      await updateOpportunityValuation({
        target_kind: targetKind,
        target_id: targetId,
        estimated_unit_value_minor: Math.round(val * 100),
        estimated_value_currency: cardCurrency,
      })
      setValuationTarget(null)
      setUnitValueInput('')
      setToast({ open: true, message: '已补填权益单次估值并重算 ROI', severity: 'success' })
      await loadRoi()
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '保存估值失败',
        severity: 'error',
      })
    } finally {
      setSavingValuation(false)
    }
  }

  const meta = roi ? ROI_DECISION_META[roi.decision_tag] : null
  const firstUnvalued = roi?.unvalued_opportunities?.[0] ?? null

  return (
    <div id='roi-section' className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>年度年费 ROI 复盘</p>
        <Link href='/cards/roi' className='text-[12px] font-semibold text-d-accent-light'>
          全家看板 ›
        </Link>
      </div>

      <div
        className={
          'rounded-2xl border bg-d-surface p-3.5 ' +
          (highlighted ? 'border-d-gold' : 'border-d-border')
        }
      >
        {/* 周期切换 */}
        <div className='mb-3 grid grid-cols-3 gap-1 rounded-xl bg-d-subtle p-1'>
          {(
            [
              { key: 'current_cycle', label: '本年费周期' },
              { key: 'last_12m', label: '近 12 个月' },
              { key: 'year', label: '自然年' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type='button'
              onClick={() => setPeriodMode(tab.key)}
              className={
                'min-h-[36px] rounded-lg text-[12px] font-semibold transition-colors ' +
                (periodMode === tab.key
                  ? 'bg-d-surface text-d-text shadow-sm'
                  : 'text-d-muted')
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton className='h-28 w-full rounded-xl' />
        ) : error ? (
          <Alert
            severity='error'
            action={
              <button
                type='button'
                onClick={() => void loadRoi()}
                className='h-8 rounded-full bg-d-danger px-3 text-[11px] font-semibold text-white'
              >
                重试
              </button>
            }
          >
            {error}
          </Alert>
        ) : (
          roi &&
          meta && (
            <div className='flex flex-col gap-3'>
              <div className='flex items-start justify-between gap-2'>
                <div>
                  <span
                    className={
                      'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ' +
                      meta.badgeClass
                    }
                  >
                    {meta.label}
                  </span>
                  <p className='mt-1.5 text-[12px] text-d-muted'>{meta.advice}</p>
                </div>
                <div className='shrink-0 text-right'>
                  <p
                    className={
                      'num-tabular text-[18px] font-bold ' +
                      (roi.net_value >= 0 ? 'text-d-success-ink' : 'text-d-danger-ink')
                    }
                  >
                    {formatCurrencyAmount(roi.net_value, roi.card_currency, true)}
                  </p>
                  <p className='num-tabular text-[11px] text-d-muted'>
                    {roi.annual_fee_cost <= 0
                      ? roi.cost_basis === 'waived'
                        ? '已免年费'
                        : '免年费'
                      : `净 ROI ${formatPct1(roi.roi_pct, true)}`}
                  </p>
                </div>
              </div>

              {/* 三格对比 */}
              <div className='grid grid-cols-3 gap-2 rounded-xl bg-d-subtle p-3'>
                <div>
                  <p className='text-[11px] text-d-muted'>年费成本</p>
                  <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-text'>
                    {formatCurrencyAmount(roi.annual_fee_cost, roi.card_currency)}
                  </p>
                </div>
                <div>
                  <p className='text-[11px] text-d-muted'>权益估值</p>
                  <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-accent-light'>
                    {formatCurrencyAmount(roi.redeemed_benefits_value, roi.card_currency)}
                  </p>
                </div>
                <div>
                  <p className='text-[11px] text-d-muted'>优惠与返现</p>
                  <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-gold'>
                    {formatCurrencyAmount(roi.promo_and_reward_value, roi.card_currency)}
                  </p>
                </div>
              </div>

              {roi.annual_fee_cost > 0 && roi.coverage_pct !== null && (
                <div>
                  <div className='mb-1 flex justify-between text-[11px]'>
                    <span className='text-d-muted'>
                      年费覆盖率（总收益 {formatCurrencyAmount(roi.total_value, roi.card_currency)}）
                    </span>
                    <span className='num-tabular font-semibold text-d-text'>
                      {formatPct1(roi.coverage_pct)}
                    </span>
                  </div>
                  <ProgressBar value={Math.min(100, Math.round(roi.coverage_pct))} />
                </div>
              )}

              {roi.unvalued_benefit_count > 0 && (
                <div className='flex items-center justify-between gap-2 rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[12px]'>
                  <span className='text-d-warn-ink'>
                    另有 {roi.unvalued_benefit_count} 次已核销权益未设估值
                  </span>
                  {firstUnvalued && (
                    <button
                      type='button'
                      onClick={() => {
                        setValuationTarget({
                          account_id: firstUnvalued.account_id,
                          definition_id: firstUnvalued.definition_id,
                          title: firstUnvalued.title,
                        })
                        setUnitValueInput('')
                      }}
                      className='min-h-[36px] shrink-0 font-semibold text-d-accent-light'
                    >
                      [去补填]
                    </button>
                  )}
                </div>
              )}

              <div className='flex items-center justify-between gap-2 text-[11px] text-d-muted'>
                <span>
                  统计区间：{roi.window_start} ~ {roi.window_end_exclusive}
                </span>
                <button
                  type='button'
                  onClick={() => {
                    setManualRewardInput(
                      card.manual_reward_value != null ? String(card.manual_reward_value) : ''
                    )
                    setManualModalOpen(true)
                  }}
                  className='min-h-[36px] font-semibold text-d-accent-light'
                >
                  补录返现/积分变现
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* 手工补录返现/积分变现 Modal */}
      <Modal
        open={manualModalOpen}
        title='补录本周期返现 / 积分变现'
        onClose={() => !savingManual && setManualModalOpen(false)}
        footer={
          <>
            <Button variant='ghost' onClick={() => setManualModalOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveManualReward} loading={savingManual}>
              保存
            </Button>
          </>
        }
      >
        <TextField
          label={`累计已入账返现/积分兑换价值（${cardCurrency}）`}
          type='number'
          inputMode='decimal'
          min='0'
          placeholder='例如：1200'
          value={manualRewardInput}
          onChange={(e) => setManualRewardInput(e.target.value)}
          startAdornment={<span>{currencySymbol(cardCurrency)}</span>}
          helperText='如账单直接返现、里程兑换等未走活动台账的收益'
        />
      </Modal>

      {/* 单次权益估值 Modal */}
      <Modal
        open={valuationTarget !== null}
        title='补填权益单次自用估值'
        onClose={() => !savingValuation && setValuationTarget(null)}
        footer={
          <>
            <Button variant='ghost' onClick={() => setValuationTarget(null)}>
              取消
            </Button>
            <Button onClick={handleSaveValuation} loading={savingValuation}>
              保存估值
            </Button>
          </>
        }
      >
        {valuationTarget && (
          <TextField
            label={`${valuationTarget.title} 单次估值（${cardCurrency}）`}
            type='number'
            inputMode='decimal'
            min='0'
            placeholder='例如：150'
            value={unitValueInput}
            onChange={(e) => setUnitValueInput(e.target.value)}
            startAdornment={<span>{currencySymbol(cardCurrency)}</span>}
          />
        )}
      </Modal>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
