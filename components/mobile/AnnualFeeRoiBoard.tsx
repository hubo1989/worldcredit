'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons/WcIcon'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { Modal, Toast } from '@/components/obsidian/overlays'
import { useAuth } from '@/lib/auth'
import { getHolders } from '@/lib/api/holders'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { currencySymbol } from '@/lib/fx'
import { formatCardTail } from '@/lib/utils'
import type { CardHolder } from '@/lib/types'
import {
  getFamilyAnnualFeeRoi,
  updateOpportunityValuation,
} from '@/lib/recommendations-ui/rpc'
import {
  formatCurrencyAmount,
  formatPct1,
  parseAmountToMinor,
} from '@/lib/recommendations-ui/helpers'
import {
  ROI_DECISION_META,
  type CardAnnualFeeRoiDetail,
  type FamilyAnnualFeeRoiBoard,
  type RoiDecisionTag,
} from '@/lib/recommendations-ui/types'

type SortMode = 'net_value_desc' | 'net_value_asc' | 'roi_pct_desc' | 'due_soon'

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'net_value_desc', label: '净收益从高到低' },
  { value: 'net_value_asc', label: '净收益从低到高' },
  { value: 'roi_pct_desc', label: 'ROI 从高到低' },
  { value: 'due_soon', label: '临近年费日优先' },
]

export function AnnualFeeRoiBoard() {
  const { user } = useAuth()
  const router = useRouter()
  const { displayConfig } = useUserPreferences()
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  const isAdmin = user?.role === 'admin'
  const currentYear = new Date().getFullYear()

  const [periodMode, setPeriodMode] = useState<'last_12m' | 'current_cycle' | 'year'>('last_12m')
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [holderId, setHolderId] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<'all' | RoiDecisionTag>('all')
  const [sortMode, setSortMode] = useState<SortMode>('net_value_desc')

  const [holders, setHolders] = useState<CardHolder[]>([])
  const [board, setBoard] = useState<FamilyAnnualFeeRoiBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 补填未估值权益弹窗
  const [valuationTarget, setValuationTarget] = useState<{
    card: CardAnnualFeeRoiDetail
    account_id: string | null
    definition_id: string | null
    title: string
    currency: string
  } | null>(null)
  const [unitValueInput, setUnitValueInput] = useState('')
  const [savingValuation, setSavingValuation] = useState(false)
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  useEffect(() => {
    if (!user?.id) return
    getHolders(user.id)
      .then((list) => {
        setHolders(list)
        if (user.role !== 'admin' && list.length === 1) {
          setHolderId(list[0].id)
        }
      })
      .catch(() => setHolders([]))
  }, [user?.id, user?.role])

  const boardReqSeqRef = useRef(0)

  const loadBoard = useCallback(async () => {
    if (!user?.id) return
    const reqSeq = ++boardReqSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const effectiveHolder =
        user.role === 'admin'
          ? holderId === 'all'
            ? null
            : holderId
          : holders[0]?.id ?? null
      const data = await getFamilyAnnualFeeRoi({
        holder_id: effectiveHolder,
        period_mode: periodMode,
        year: periodMode === 'year' ? selectedYear : undefined,
        display_currency: displayCurrency,
      })
      if (reqSeq !== boardReqSeqRef.current) return
      setBoard(data)
    } catch (err) {
      if (reqSeq !== boardReqSeqRef.current) return
      setError(err instanceof Error ? err.message : '加载年费 ROI 看板失败')
    } finally {
      if (reqSeq === boardReqSeqRef.current) {
        setLoading(false)
      }
    }
  }, [displayCurrency, holderId, holders, periodMode, selectedYear, user?.id, user?.role])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  const visibleCards = useMemo(() => {
    if (!board) return []
    const filtered =
      tagFilter === 'all'
        ? board.cards
        : board.cards.filter((c) => c.decision_tag === tagFilter)
    return [...filtered].sort((a, b) => {
      if (sortMode === 'net_value_desc') return b.net_value - a.net_value
      if (sortMode === 'net_value_asc') return a.net_value - b.net_value
      if (sortMode === 'roi_pct_desc') {
        const ra = a.roi_pct ?? (a.net_value > 0 ? Number.MAX_SAFE_INTEGER : -1)
        const rb = b.roi_pct ?? (b.net_value > 0 ? Number.MAX_SAFE_INTEGER : -1)
        return rb - ra
      }
      const da = a.days_until_annual_fee ?? 99999
      const db = b.days_until_annual_fee ?? 99999
      return da - db
    })
  }, [board, sortMode, tagFilter])

  const handleSaveValuation = async () => {
    if (!valuationTarget) return
    const targetKind = valuationTarget.account_id ? 'account' : 'definition'
    const targetId = valuationTarget.account_id ?? valuationTarget.definition_id
    if (!targetId) {
      setToast({ open: true, message: '缺少可更新的权益标识', severity: 'error' })
      return
    }
    const minor = parseAmountToMinor(unitValueInput)
    if (minor === null) {
      setToast({ open: true, message: '请输入大于等于 0 的单次估值金额', severity: 'error' })
      return
    }
    setSavingValuation(true)
    try {
      await updateOpportunityValuation({
        target_kind: targetKind,
        target_id: targetId,
        estimated_unit_value_minor: minor,
        estimated_value_currency: valuationTarget.currency,
      })
      setValuationTarget(null)
      setUnitValueInput('')
      setToast({ open: true, message: '已更新权益单次估值并重算 ROI', severity: 'success' })
      await loadBoard()
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

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 pb-24 pt-3 text-d-text sm:px-5'>
      {/* 顶栏 */}
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2.5'>
          <button
            type='button'
            onClick={() => router.back()}
            aria-label='返回'
            className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text'
          >
            <ChevronLeftIcon size={20} />
          </button>
          <div>
            <h1 className='text-[20px] font-bold leading-6 text-d-text'>单卡年费 ROI 复盘</h1>
            <p className='text-[12px] text-d-muted'>年费成本 vs 已核销权益估值 + 优惠返现</p>
          </div>
        </div>
        <Link
          href='/recommend'
          className='flex min-h-[44px] items-center rounded-full border border-d-border bg-d-surface px-3 text-[12px] font-semibold text-d-accent-light'
        >
          选卡助手 ›
        </Link>
      </div>

      {/* 筛选栏 */}
      <div className='mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <SelectField
          label='统计窗口'
          value={periodMode}
          onChange={(e) =>
            setPeriodMode(e.target.value as 'last_12m' | 'current_cycle' | 'year')
          }
          options={[
            { value: 'last_12m', label: '近 12 个月' },
            { value: 'current_cycle', label: '各卡当前周期' },
            { value: 'year', label: '按自然年' },
          ]}
        />

        {periodMode === 'year' && (
          <SelectField
            label='年份'
            value={String(selectedYear)}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            options={[currentYear, currentYear - 1, currentYear - 2].map((y) => ({
              value: String(y),
              label: `${y} 年`,
            }))}
          />
        )}

        {isAdmin && (
          <SelectField
            label='持卡人'
            value={holderId}
            onChange={(e) => setHolderId(e.target.value)}
            options={[
              { value: 'all', label: '全部家庭成员' },
              ...holders.map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
        )}

        <SelectField
          label='决策标签'
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value as 'all' | RoiDecisionTag)}
          options={[
            { value: 'all', label: '全部结论' },
            ...Object.entries(ROI_DECISION_META).map(([key, meta]) => ({
              value: key,
              label: meta.label,
            })),
          ]}
        />

        <SelectField
          label='排序方式'
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          options={SORT_OPTIONS}
        />
      </div>

      {error && (
        <div className='mb-4'>
          <Alert
            severity='error'
            action={
              <button
                type='button'
                onClick={() => void loadBoard()}
                className='h-9 rounded-full bg-d-danger px-3 text-[12px] font-semibold text-white'
              >
                重试
              </button>
            }
          >
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-36 w-full rounded-2xl' />
          <Skeleton className='h-28 w-full rounded-2xl' />
          <Skeleton className='h-28 w-full rounded-2xl' />
        </div>
      ) : (
        board &&
        (() => {
          const annualFeeCost = board.totals.annual_fee_cost.total
          const redeemedValue = board.totals.redeemed_benefits_value.total
          const promoAndManualValue =
            board.totals.promo_and_reward_value.total + board.totals.manual_reward_value.total
          const netValue = board.totals.net_value.total
          const pending30dCount = board.cards.filter(
            (c) =>
              c.days_until_annual_fee != null &&
              c.days_until_annual_fee >= 0 &&
              c.days_until_annual_fee <= 30
          ).length
          const overallRoiPct =
            annualFeeCost > 0
              ? Math.round((netValue / annualFeeCost) * 1000) / 10
              : null
          const isFullyConverted =
            board.fx_available && board.unconverted_currencies.length === 0

          return (
            <div className='flex flex-col gap-3'>
              {/* 缺汇率告警 */}
              {(!board.fx_available || board.unconverted_currencies.length > 0) && (
                <Alert severity='warning'>
                  未含汇率：{board.unconverted_currencies.join('、') || '外币'} 未计入合计（下方单卡仍精准展示原币 ROI）。
                </Alert>
              )}

              {board.warnings.length > 0 && (
                <Alert severity='info'>{board.warnings.join('；')}</Alert>
              )}

              {/* 全家汇总卡 */}
              <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
                <div className='flex items-center justify-between gap-2'>
                  <div>
                    <p className='text-[12px] text-d-muted'>
                      全家年费 ROI 汇总（折算 {board.display_currency} · 共 {board.cards.length} 张信用卡）
                    </p>
                    <p
                      className={
                        'num-tabular mt-1 text-[24px] font-bold leading-7 ' +
                        (netValue >= 0 ? 'text-d-success-ink' : 'text-d-danger-ink')
                      }
                    >
                      净收益 {formatCurrencyAmount(netValue, board.display_currency, true)}
                    </p>
                  </div>
                  <div className='text-right'>
                    {pending30dCount > 0 ? (
                      <span className='rounded-full bg-d-gold-soft px-2.5 py-1 text-[11px] font-semibold text-d-gold'>
                        30 天内待决策 {pending30dCount} 张
                      </span>
                    ) : (
                      <span className='rounded-full bg-d-subtle px-2.5 py-1 text-[11px] font-semibold text-d-muted'>
                        {board.window_start} ~ {board.window_end_exclusive}
                      </span>
                    )}
                    <p className='num-tabular mt-1.5 text-[12px] font-semibold text-d-muted'>
                      {overallRoiPct !== null
                        ? `${isFullyConverted ? '整体 ROI ' : '已折算 ROI '}${formatPct1(overallRoiPct, true)}`
                        : '整体零年费成本'}
                    </p>
                  </div>
                </div>

                <div className='mt-3 grid grid-cols-3 gap-2 rounded-xl bg-d-subtle p-3'>
                  <div>
                    <p className='text-[11px] text-d-muted'>年费总成本</p>
                    <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-text'>
                      {formatCurrencyAmount(annualFeeCost, board.display_currency)}
                    </p>
                  </div>
                  <div>
                    <p className='text-[11px] text-d-muted'>权益估值</p>
                    <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-accent-light'>
                      {formatCurrencyAmount(redeemedValue, board.display_currency)}
                    </p>
                  </div>
                  <div>
                    <p className='text-[11px] text-d-muted'>优惠与返现</p>
                    <p className='num-tabular mt-0.5 text-[14px] font-bold text-d-gold'>
                      {formatCurrencyAmount(promoAndManualValue, board.display_currency)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 单卡列表 */}
              {visibleCards.length === 0 ? (
                <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center text-[13px] text-d-muted'>
                  当前筛选下暂无信用卡记录
                </div>
              ) : (
                visibleCards.map((card) => {
                  const meta = ROI_DECISION_META[card.decision_tag]
                  const tail = formatCardTail(card.card_number_last4)
                  const firstUnvalued = card.unvalued_benefit_refs[0]
                  const cardRewardTotal = card.promo_and_reward_value + card.manual_reward_value
                  return (
                    <div
                      key={card.card_id}
                      className='rounded-2xl border border-d-border bg-d-surface p-4'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex flex-wrap items-center gap-1.5'>
                            <span
                              className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + meta.badgeClass}
                            >
                              {card.decision_label || meta.label}
                            </span>
                            {card.days_until_annual_fee != null &&
                              card.days_until_annual_fee >= 0 &&
                              card.days_until_annual_fee <= 30 && (
                                <span className='rounded-full bg-d-danger-soft px-2 py-0.5 text-[11px] font-semibold text-d-danger-ink'>
                                  距年费剩 {card.days_until_annual_fee} 天
                                </span>
                              )}
                          </div>
                          <Link
                            href={`/cards/${card.card_id}?section=roi`}
                            className='mt-1.5 flex items-center gap-1 text-[15px] font-bold text-d-text hover:text-d-accent-light'
                          >
                            <span className='truncate'>
                              {card.bank_name} · {card.card_name}
                              {tail ? ` (${tail})` : ''}
                            </span>
                            <ChevronRightIcon size={16} className='shrink-0 text-d-muted' />
                          </Link>
                          <p className='mt-0.5 text-[12px] text-d-muted'>
                            {card.holder_name} · {card.card_currency} · 窗口 {card.period_start} ~ {card.period_end_exclusive}
                          </p>
                        </div>

                        <div className='shrink-0 text-right'>
                          <p
                            className={
                              'num-tabular text-[16px] font-bold ' +
                              (card.net_value >= 0 ? 'text-d-success-ink' : 'text-d-danger-ink')
                            }
                          >
                            {formatCurrencyAmount(card.net_value, card.card_currency, true)}
                          </p>
                          <p className='num-tabular text-[11px] text-d-muted'>
                            {card.annual_fee_cost <= 0
                              ? card.cost_basis === 'waived'
                                ? '已免年费'
                                : '免年费'
                              : `ROI ${formatPct1(card.roi_pct, true)} · 覆盖 ${formatPct1(card.coverage_pct)}`}
                          </p>
                        </div>
                      </div>

                      <div className='mt-3 grid grid-cols-3 gap-2 rounded-xl bg-d-subtle px-3 py-2 text-[12px]'>
                        <div>
                          <p className='text-[11px] text-d-muted'>年费成本</p>
                          <p className='num-tabular font-semibold text-d-text'>
                            {formatCurrencyAmount(card.annual_fee_cost, card.card_currency)}
                          </p>
                        </div>
                        <div>
                          <p className='text-[11px] text-d-muted'>权益估值</p>
                          <p className='num-tabular font-semibold text-d-accent-light'>
                            {formatCurrencyAmount(card.redeemed_benefits_value, card.card_currency)}
                          </p>
                        </div>
                        <div>
                          <p className='text-[11px] text-d-muted'>优惠返现</p>
                          <p className='num-tabular font-semibold text-d-gold'>
                            {formatCurrencyAmount(cardRewardTotal, card.card_currency)}
                          </p>
                        </div>
                      </div>

                      {card.unvalued_benefit_count > 0 && (
                        <div className='mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[12px]'>
                          <span className='text-d-warn-ink'>
                            另有 {card.unvalued_benefit_count} 次已核销权益未设估值
                          </span>
                          {firstUnvalued && (
                            <button
                              type='button'
                              onClick={() => {
                                setValuationTarget({
                                  card,
                                  account_id: firstUnvalued.account_id,
                                  definition_id: firstUnvalued.definition_id,
                                  title: `已核销权益（${firstUnvalued.quantity} 次）`,
                                  currency: card.card_currency,
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
                    </div>
                  )
                })
              )}
            </div>
          )
        })()
      )}

      {/* 单次估值补填弹窗 */}
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
          <div className='flex flex-col gap-3'>
            <p className='text-[13px] text-d-muted'>
              权益项目：<span className='font-semibold text-d-text'>{valuationTarget.title}</span>
            </p>
            <TextField
              label={`单次自用估值（${valuationTarget.currency}）`}
              type='number'
              inputMode='decimal'
              min='0'
              step='1'
              placeholder='例如：150'
              value={unitValueInput}
              onChange={(e) => setUnitValueInput(e.target.value)}
              startAdornment={<span>{currencySymbol(valuationTarget.currency)}</span>}
              helperText='按个人真实自用价值填写；0 表示不计入收益估值'
            />
          </div>
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
