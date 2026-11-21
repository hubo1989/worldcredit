'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buildAccountPools, type AccountPoolGroup } from '@/lib/account-pools'
import { getCreditAccounts } from '@/lib/api/accounts'
import { getCardsWithBillsSummary, type CardWithBillsSummary } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'
import {
  getRecurringPayables,
  payableCycleLabel,
  type PayableWithStatus,
} from '@/lib/api/payables'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { useAuth } from '@/lib/auth'
import { formatMoney } from '@/lib/dashboard-metrics'
import { fetchRates, sumByCurrency, type FxRates } from '@/lib/fx'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import type { CardHolder, CreditAccount, CreditCard } from '@/lib/types'
import {
  formatCardTail,
  getEffectiveAnnualFee,
  getEffectiveBillingDay,
  getEffectiveCardName,
  getEffectiveCreditLimit,
  isCreditLimitManuallySet,
} from '@/lib/utils'
import {
  BankIcon,
  CalendarIcon,
  CardIcon,
  ChevronRightIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  MergeIcon,
  PeopleIcon,
  PlusIcon,
} from '@/components/icons/WcIcon'
import { AccountMergeWizardModal } from '@/components/mobile/AccountMergeWizardModal'
import { CardCreateModal } from '@/components/mobile/CardCreateModal'
import { HolderCard } from '@/components/mobile/HolderCard'
import { PillBadge, StatusBadge } from '@/components/mobile/WcBadge'
import { WcEmptyState, WcErrorState, WcSkeleton } from '@/components/mobile/WcStates'
import { Button } from '@/components/obsidian/controls'
import { Alert, ProgressBar } from '@/components/obsidian/feedback'
import { Toast } from '@/components/obsidian/overlays'

type AccountSegment = 'credit' | 'loans' | 'holders'
type CreditViewMode = 'pool' | 'single'

function StatGrid({
  items,
  blurClass,
  compact = false,
  className = '',
}: {
  items: { label: string; value: string; valueClass?: string }[]
  blurClass: string
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={`grid grid-cols-3 gap-2 rounded-xl bg-d-subtle ${
        compact ? 'px-3 py-2.5' : 'p-3'
      } ${className}`}
    >
      {items.map((item) => (
        <div key={item.label}>
          <p className='text-[11px] text-d-muted'>{item.label}</p>
          <p
            className={`num-tabular mt-0.5 ${
              compact ? 'text-[14px]' : 'text-[15px]'
            } font-bold ${item.valueClass ?? 'text-d-text'} ${blurClass}`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function AccountsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { displayConfig, togglePrivacyMode } = useUserPreferences()
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  const privacyOn = !!displayConfig.privacy_mode
  const blurClass = privacyOn ? 'privacy-blur' : 'privacy-clear'

  const [segment, setSegment] = useState<AccountSegment>('credit')
  const [creditView, setCreditView] = useState<CreditViewMode>('pool')
  const [selectedHolderId, setSelectedHolderId] = useState<string>('all')

  const [cardsSummary, setCardsSummary] = useState<CardWithBillsSummary[]>([])
  const [creditAccounts, setCreditAccounts] = useState<CreditAccount[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [payables, setPayables] = useState<PayableWithStatus[]>([])
  const [fxRates, setFxRates] = useState<FxRates | null>(null)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accountsDegraded, setAccountsDegraded] = useState(false)
  const [payablesDegraded, setPayablesDegraded] = useState(false)
  const loadSeqRef = useRef(0)
  const [cardCreateOpen, setCardCreateOpen] = useState(false)
  const [mergeWizardOpen, setMergeWizardOpen] = useState(false)
  const [toast, setToast] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'info' | 'error'
  }>({ open: false, message: '', severity: 'success' })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const tabParam = params.get('tab')
    if (tabParam === 'credit' || tabParam === 'loans' || tabParam === 'holders') {
      setSegment(tabParam)
    }
    const viewParam = params.get('view')
    if (viewParam === 'pool' || viewParam === 'single') {
      setCreditView(viewParam)
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!user?.id) return
    const seq = ++loadSeqRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const [summaryData, holderList, accountsResult, payablesResult] = await Promise.all([
        getCardsWithBillsSummary(user.id),
        getHolders(user.id),
        getCreditAccounts(user.id)
          .then((list) => ({ list, degraded: false }))
          .catch((err) => {
            console.warn('[accounts] Failed to load credit accounts:', err)
            return { list: [] as CreditAccount[], degraded: true }
          }),
        getRecurringPayables(user.id)
          .then((list) => ({ list, degraded: false }))
          .catch((err) => {
            console.warn('[accounts] Failed to load recurring payables:', err)
            return { list: [] as PayableWithStatus[], degraded: true }
          }),
      ])
      if (seq !== loadSeqRef.current) return
      setCardsSummary(summaryData)
      setHolders(holderList)
      setCreditAccounts(accountsResult.list)
      setAccountsDegraded(accountsResult.degraded)
      setPayables(payablesResult.list)
      setPayablesDegraded(payablesResult.degraded)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setLoadError(err instanceof Error ? err.message : '加载账户数据失败')
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [user?.id])

  // 持卡人列表刷新后若原选持卡人已不存在，复位为全部避免误显示空态
  useEffect(() => {
    if (!loading && selectedHolderId !== 'all' && !holders.some((h) => h.id === selectedHolderId)) {
      setSelectedHolderId('all')
    }
  }, [loading, holders, selectedHolderId])

  useEffect(() => {
    void loadData()
    return () => {
      loadSeqRef.current += 1
    }
  }, [loadData])

  useEffect(() => {
    let cancelled = false
    fetchRates()
      .then((rates) => {
        if (!cancelled) setFxRates(rates)
      })
      .catch(() => {
        if (!cancelled) setFxRates(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const holderMap = useMemo(() => {
    const map = new Map<string, CardHolder>()
    for (const h of holders) map.set(h.id, h)
    return map
  }, [holders])

  const accountsById = useMemo(() => {
    const map = new Map<string, CreditAccount>()
    for (const acc of creditAccounts) map.set(acc.id, acc)
    return map
  }, [creditAccounts])

  const allCreditCards = useMemo(
    () => cardsSummary.filter((item) => item.card.card_type !== 'loan'),
    [cardsSummary]
  )

  const filteredCreditCards = useMemo(() => {
    if (selectedHolderId === 'all') return allCreditCards
    return allCreditCards.filter((item) => item.holder_id === selectedHolderId)
  }, [allCreditCards, selectedHolderId])

  const accountPools = useMemo(
    () => buildAccountPools(filteredCreditCards, accountsById),
    [filteredCreditCards, accountsById]
  )

  const loanCards = useMemo(
    () => cardsSummary.filter((item) => item.card.card_type === 'loan'),
    [cardsSummary]
  )

  const loanPayables = useMemo(
    () => payables.filter((p) => p.category === 'loan'),
    [payables]
  )

  const cardCountsByHolder = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of cardsSummary) {
      counts[item.holder_id] = (counts[item.holder_id] ?? 0) + 1
    }
    return counts
  }, [cardsSummary])

  const mergeWizardCards = useMemo(
    () => allCreditCards.map((c) => ({ ...c.card, account: c.account })),
    [allCreditCards]
  )

  const creditTotals = useMemo(() => {
    const limitSum = sumByCurrency(
      accountPools,
      (pool) => (pool.poolLimit !== null ? { amount: pool.poolLimit, currency: pool.currency } : null),
      displayCurrency,
      fxRates
    )
    const unpaidSum = sumByCurrency(
      accountPools,
      (pool) => ({ amount: pool.poolUsed, currency: pool.currency }),
      displayCurrency,
      fxRates
    )
    const availableSum = sumByCurrency(
      accountPools,
      (pool) =>
        pool.poolAvailable !== null ? { amount: pool.poolAvailable, currency: pool.currency } : null,
      displayCurrency,
      fxRates
    )
    const knownLimitUnpaidSum = sumByCurrency(
      accountPools,
      (pool) => (pool.poolLimit !== null ? { amount: pool.poolUsed, currency: pool.currency } : null),
      displayCurrency,
      fxRates
    )
    const unconverted = Array.from(
      new Set([
        ...limitSum.unconverted_currencies,
        ...unpaidSum.unconverted_currencies,
        ...availableSum.unconverted_currencies,
      ])
    ).sort()
    const knownLimitPoolCount = accountPools.filter((pool) => pool.poolLimit !== null).length
    const hasKnownLimit = knownLimitPoolCount > 0

    return {
      limitTotal: hasKnownLimit ? limitSum.total : null,
      unpaidTotal: unpaidSum.total,
      knownLimitUnpaidTotal: knownLimitUnpaidSum.total,
      availableTotal: hasKnownLimit ? availableSum.total : null,
      unconverted,
      unknownLimitPoolCount: accountPools.length - knownLimitPoolCount,
    }
  }, [accountPools, displayCurrency, fxRates])

  const loanTotalCount = loanCards.length + loanPayables.length
  const showLast4 = displayConfig.show_card_last4 !== false
  const showAnnualFee = displayConfig.show_annual_fee !== false

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 pb-24 pt-4 text-d-text sm:px-5'>
      {/* 顶部标题栏 */}
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div>
          <h1 className='text-[22px] font-bold leading-7 tracking-tight text-d-text'>账户</h1>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            信用卡共享池、贷款概览与持卡人档案
          </p>
        </div>
        <button
          type='button'
          aria-label={privacyOn ? '显示金额' : '隐藏金额'}
          onClick={() => {
            void togglePrivacyMode()
          }}
          className='flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-d-border bg-d-surface px-3 text-d-muted transition-colors active:bg-d-subtle hover:text-d-text'
        >
          {privacyOn ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>

      {/* 顶部 3 分段：[ 信用卡 | 贷款 | 持卡人 ] */}
      <div
        role='tablist'
        aria-label='账户分类'
        className='mb-4 grid grid-cols-3 gap-1.5 rounded-2xl border border-d-border bg-d-surface p-1.5'
      >
        {(
          [
            { key: 'credit', label: '信用卡', count: allCreditCards.length },
            { key: 'loans', label: '贷款', count: loanTotalCount },
            { key: 'holders', label: '持卡人', count: holders.length },
          ] as const
        ).map((tab) => {
          const active = segment === tab.key
          return (
            <button
              key={tab.key}
              type='button'
              role='tab'
              aria-selected={active}
              onClick={() => setSegment(tab.key)}
              className={
                'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-[14px] font-semibold transition-colors ' +
                (active
                  ? 'bg-d-accent text-white shadow-sm'
                  : 'text-d-muted active:bg-d-subtle hover:text-d-text')
              }
            >
              <span>{tab.label}</span>
              <span
                className={
                  'num-tabular rounded-full px-1.5 py-0.5 text-[11px] leading-none ' +
                  (active ? 'bg-white/20 text-white' : 'bg-d-subtle text-d-muted')
                }
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <WcSkeleton height={110} count={3} radius={16} />
      ) : loadError ? (
        <WcErrorState message={loadError} onRetry={() => void loadData()} />
      ) : (
        <>
          {segment === 'credit' && (
            <div className='flex flex-col gap-3.5'>
              {/* 视图双切换 + 操作入口 */}
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div
                  role='group'
                  aria-label='信用卡视图切换'
                  className='inline-flex rounded-xl border border-d-border bg-d-surface p-1'
                >
                  <button
                    type='button'
                    onClick={() => setCreditView('pool')}
                    aria-pressed={creditView === 'pool'}
                    className={
                      'min-h-[44px] rounded-lg px-3 text-[13px] font-semibold transition-colors ' +
                      (creditView === 'pool'
                        ? 'bg-d-subtle text-d-accent-light'
                        : 'text-d-muted active:text-d-text')
                    }
                  >
                    账户共享池视图
                  </button>
                  <button
                    type='button'
                    onClick={() => setCreditView('single')}
                    aria-pressed={creditView === 'single'}
                    className={
                      'min-h-[44px] rounded-lg px-3 text-[13px] font-semibold transition-colors ' +
                      (creditView === 'single'
                        ? 'bg-d-subtle text-d-accent-light'
                        : 'text-d-muted active:text-d-text')
                    }
                  >
                    单卡视图
                  </button>
                </div>

                <div className='flex items-center gap-2'>
                  <Button
                    size='md'
                    variant='secondary'
                    className='min-h-[44px] px-3.5 text-[13px]'
                    onClick={() => setMergeWizardOpen(true)}
                    disabled={allCreditCards.length < 2}
                  >
                    <MergeIcon size={16} />
                    <span>合并账户</span>
                  </Button>
                  <Button
                    size='md'
                    variant='primary'
                    className='min-h-[44px] px-3.5 text-[13px]'
                    onClick={() => setCardCreateOpen(true)}
                  >
                    <PlusIcon size={16} />
                    <span>新增卡片</span>
                  </Button>
                </div>
              </div>

              {/* 多持卡人快捷筛选 */}
              {holders.length > 1 && (
                <div className='flex gap-1.5 overflow-x-auto pb-0.5'>
                  <button
                    type='button'
                    onClick={() => setSelectedHolderId('all')}
                    className={
                      'min-h-[44px] shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ' +
                      (selectedHolderId === 'all'
                        ? 'border-d-accent bg-d-accent/15 text-d-accent-light'
                        : 'border-d-border bg-d-surface text-d-muted')
                    }
                  >
                    全部持卡人
                  </button>
                  {holders.map((h) => {
                    const active = selectedHolderId === h.id
                    return (
                      <button
                        key={h.id}
                        type='button'
                        onClick={() => setSelectedHolderId(h.id)}
                        className={
                          'min-h-[44px] shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ' +
                          (active
                            ? 'border-d-accent bg-d-accent/15 text-d-accent-light'
                            : 'border-d-border bg-d-surface text-d-muted')
                        }
                      >
                        {h.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {accountsDegraded && (
                <Alert severity='warning'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-[12px] text-d-warn-ink'>
                      账户信息加载失败，共享额度与合并账单判定可能不准确
                    </span>
                    <button
                      type='button'
                      onClick={() => void loadData()}
                      className='min-h-[44px] shrink-0 rounded-lg border border-d-border px-3 text-[12px] font-semibold text-d-text'
                    >
                      重试
                    </button>
                  </div>
                </Alert>
              )}

              {/* 额度与账户总览卡 */}
              {filteredCreditCards.length > 0 && (
                <CreditSummaryCard
                  cardCount={filteredCreditCards.length}
                  poolCount={accountPools.length}
                  displayCurrency={displayCurrency}
                  limitTotal={creditTotals.limitTotal}
                  unpaidTotal={creditTotals.unpaidTotal}
                  knownLimitUnpaidTotal={creditTotals.knownLimitUnpaidTotal}
                  availableTotal={creditTotals.availableTotal}
                  unconverted={creditTotals.unconverted}
                  unknownLimitPoolCount={creditTotals.unknownLimitPoolCount}
                  blurClass={blurClass}
                />
              )}

              {filteredCreditCards.length === 0 ? (
                <div className='rounded-2xl border border-d-border bg-d-surface'>
                  <WcEmptyState
                    title='暂无信用卡'
                    description='添加你的第一张信用卡，即可按账户共享池或单卡维度追踪额度与账单'
                    actionLabel='新增卡片'
                    onAction={() => setCardCreateOpen(true)}
                    icon={<CardIcon size={32} />}
                  />
                </div>
              ) : creditView === 'pool' ? (
                <div className='flex flex-col gap-3'>
                  {accountPools.map((pool) => (
                    <AccountPoolCard
                      key={pool.key}
                      pool={pool}
                      holderName={holderMap.get(pool.holderId)?.name}
                      showLast4={showLast4}
                      blurClass={blurClass}
                    />
                  ))}
                </div>
              ) : (
                <div className='flex flex-col gap-2.5'>
                  {filteredCreditCards.map((item) => (
                    <SingleCardRow
                      key={item.card.id}
                      item={item}
                      holderName={holderMap.get(item.holder_id)?.name}
                      displayCurrency={displayCurrency}
                      showLast4={showLast4}
                      showAnnualFee={showAnnualFee}
                      blurClass={blurClass}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {segment === 'loans' && (
            <LoansSection
              loanCards={loanCards}
              loanPayables={loanPayables}
              payablesDegraded={payablesDegraded}
              onRetry={() => void loadData()}
              holderMap={holderMap}
              displayCurrency={displayCurrency}
              fxRates={fxRates}
              blurClass={blurClass}
            />
          )}

          {segment === 'holders' && (
            <HoldersSection
              holders={holders}
              cardCounts={cardCountsByHolder}
              onSelectHolder={(holderId) => router.push(`/holders/${holderId}`)}
              onManageHolders={() => router.push('/holders')}
            />
          )}
        </>
      )}

      <CardCreateModal
        open={cardCreateOpen}
        onClose={() => setCardCreateOpen(false)}
        onSuccess={() => {
          setToast({ open: true, message: '信用卡已添加', severity: 'success' })
          void loadData()
        }}
        initialHolderId={selectedHolderId !== 'all' ? selectedHolderId : undefined}
      />

      <AccountMergeWizardModal
        open={mergeWizardOpen}
        onClose={() => setMergeWizardOpen(false)}
        cards={mergeWizardCards}
        onSuccess={() => {
          setToast({ open: true, message: '已合并为统一账单账户', severity: 'success' })
          void loadData()
        }}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}

/** 卡片失效状态徽标：frozen -> 已冻结，cancelled -> 已注销 */
function CardStatusPill({ status }: { status: CreditCard['status'] }) {
  if (status === 'active') return null
  return (
    <PillBadge className='bg-d-danger-soft text-d-danger-ink'>
      {status === 'frozen' ? '已冻结' : '已注销'}
    </PillBadge>
  )
}

function CreditSummaryCard({
  cardCount,
  poolCount,
  displayCurrency,
  limitTotal,
  unpaidTotal,
  knownLimitUnpaidTotal,
  availableTotal,
  unconverted,
  unknownLimitPoolCount,
  blurClass,
}: {
  cardCount: number
  poolCount: number
  displayCurrency: string
  limitTotal: number | null
  unpaidTotal: number
  knownLimitUnpaidTotal: number
  availableTotal: number | null
  unconverted: string[]
  unknownLimitPoolCount: number
  blurClass: string
}) {
  // 已用占比分子/分母同口径限定于已知额度池，避免未设额度池的欠款把占比虚高钳到 100%
  const usagePct =
    limitTotal && limitTotal > 0
      ? Math.min(100, Math.round((knownLimitUnpaidTotal / limitTotal) * 100))
      : 0

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div>
          <p className='text-[12px] font-medium text-d-muted'>授信总览（按账户池去重汇总）</p>
          <p className='mt-0.5 text-[13px] font-semibold text-d-text'>
            {poolCount} 个账户池 · {cardCount} 张信用卡
          </p>
        </div>
        <PillBadge className='bg-d-subtle text-d-accent-light'>{displayCurrency}</PillBadge>
      </div>

      <StatGrid
        blurClass={blurClass}
        items={[
          {
            label: '总额度',
            value: limitTotal !== null ? formatMoney(limitTotal, displayCurrency) : '未设置',
            valueClass: 'text-d-text',
          },
          {
            label: '当前待还',
            value: formatMoney(unpaidTotal, displayCurrency),
            valueClass: 'text-d-gold',
          },
          {
            label: '估算可用',
            value: availableTotal !== null ? formatMoney(availableTotal, displayCurrency) : '—',
            valueClass: 'text-d-success-ink',
          },
        ]}
      />

      {limitTotal !== null && limitTotal > 0 && (
        <div className='mt-3'>
          <div className='mb-1 flex items-center justify-between text-[11px] text-d-muted'>
            <span>已用占比</span>
            <span className='num-tabular font-semibold text-d-text'>{usagePct}%</span>
          </div>
          <ProgressBar value={usagePct} />
        </div>
      )}

      {unknownLimitPoolCount > 0 && (
        <p className='mt-2 text-[11px] text-d-muted'>
          {unknownLimitPoolCount} 个账户暂未设置额度，总额度、可用与已用占比暂未包含
        </p>
      )}

      {unconverted.length > 0 && (
        <p className='mt-2 text-[11px] text-d-warn-ink'>
          汇率暂不可用，以上折算合计未含：{unconverted.join('、')}
        </p>
      )}
    </div>
  )
}

function AccountPoolCard({
  pool,
  holderName,
  showLast4,
  blurClass,
}: {
  pool: AccountPoolGroup
  holderName?: string
  showLast4: boolean
  blurClass: string
}) {
  const usagePct =
    pool.poolLimit && pool.poolLimit > 0
      ? Math.min(100, Math.round((pool.poolUsed / pool.poolLimit) * 100))
      : undefined

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      {/* 账户头 */}
      <div className='mb-3 flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <p className='truncate text-[16px] font-bold leading-5 text-d-text'>{pool.title}</p>
            {holderName && <PillBadge>{holderName}</PillBadge>}
          </div>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            <PillBadge
              className={
                pool.isSharedQuota
                  ? 'bg-d-subtle text-d-accent-light'
                  : 'bg-d-subtle text-d-muted'
              }
            >
              {pool.isSharedQuota ? '共享额度池' : '独立额度'}
            </PillBadge>
            <PillBadge
              className={
                pool.isMergedStatement
                  ? 'bg-d-gold-soft text-d-warn-ink'
                  : 'bg-d-subtle text-d-muted'
              }
            >
              {pool.isMergedStatement ? '合并账单' : '独立账单'}
            </PillBadge>
            <PillBadge>{pool.currency}</PillBadge>
          </div>
        </div>

        <span className='shrink-0 text-[12px] font-semibold text-d-muted'>
          {pool.cards.length} 张卡
        </span>
      </div>

      {/* 账户池额度行 */}
      <StatGrid
        compact
        className='mb-3'
        blurClass={blurClass}
        items={[
          {
            label: '账户额度',
            value: pool.poolLimit !== null ? formatMoney(pool.poolLimit, pool.currency) : '未获取',
            valueClass: 'text-d-text',
          },
          {
            label: '待还金额',
            value: formatMoney(pool.poolUsed, pool.currency),
            valueClass: 'text-d-gold',
          },
          {
            label: '可用额度',
            value: pool.poolAvailable !== null ? formatMoney(pool.poolAvailable, pool.currency) : '—',
            valueClass: 'text-d-success-ink',
          },
        ]}
      />

      {usagePct !== undefined && (
        <div className='mb-3'>
          <ProgressBar value={usagePct} />
        </div>
      )}

      {/* 成员卡列表 */}
      <div className='flex flex-col divide-y divide-d-border/60 rounded-xl border border-d-border/70 bg-d-bg/40'>
        {pool.cards.map((item) => {
          const cardName = getEffectiveCardName(item.card, item.card.card_product)
          const tail = showLast4 ? formatCardTail(item.card.card_number_last4) : ''
          const isPrimary =
            pool.cards.length > 1 && pool.account?.primary_card_id === item.card.id
          const billingDay = getEffectiveBillingDay(item.card)
          const effLimit = getEffectiveCreditLimit(item.card)

          return (
            <Link
              key={item.card.id}
              href={`/cards/${item.card.id}`}
              className='flex min-h-[48px] items-center justify-between gap-3 px-3 py-2.5 transition-colors active:bg-d-subtle'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='truncate text-[14px] font-semibold text-d-text'>
                    {cardName}
                  </span>
                  {tail && (
                    <span className='num-tabular text-[12px] text-d-muted'>····{tail}</span>
                  )}
                  {isPrimary && (
                    <PillBadge className='bg-d-accent/20 text-d-accent-light'>主卡</PillBadge>
                  )}
                  <CardStatusPill status={item.card.status} />
                </div>
                <div className='mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-d-muted'>
                  <span>账单日 {billingDay}日</span>
                  <span className='inline-flex items-center gap-0.5 text-d-gold'>
                    <ClockIcon size={11} />
                    免息 {item.graceDays}天
                  </span>
                  {!pool.isSharedQuota && effLimit !== null && (
                    <span className={`num-tabular ${blurClass}`}>
                      额度 {formatMoney(effLimit, pool.currency)}
                    </span>
                  )}
                </div>
              </div>

              <div className='flex shrink-0 items-center gap-1.5'>
                {item.isAnchorCard !== false ? (
                  <StatusBadge status={item.status} />
                ) : (
                  <PillBadge>合并入主卡</PillBadge>
                )}
                <ChevronRightIcon size={16} className='text-d-muted' />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function SingleCardRow({
  item,
  holderName,
  displayCurrency,
  showLast4,
  showAnnualFee,
  blurClass,
}: {
  item: CardWithBillsSummary
  holderName?: string
  displayCurrency: string
  showLast4: boolean
  showAnnualFee: boolean
  blurClass: string
}) {
  const product = item.card.card_product
  const bankName = product?.bank_name || '银行卡'
  const cardName = getEffectiveCardName(item.card, product)
  const tail = showLast4 ? formatCardTail(item.card.card_number_last4) : ''
  const currency = product?.currency || displayCurrency
  const effLimit = getEffectiveCreditLimit(item.card)
  const limitManual = isCreditLimitManuallySet(item.card)
  const billingDay = getEffectiveBillingDay(item.card)
  const annualFee = getEffectiveAnnualFee(item.card, product)
  const isNonAnchorMerged = item.account?.statement_mode === 'merged' && item.isAnchorCard === false

  return (
    <Link
      href={`/cards/${item.card.id}`}
      className='flex min-h-[72px] flex-col gap-2.5 rounded-2xl border border-d-border bg-d-surface p-3.5 transition-colors active:bg-d-subtle'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='text-[12px] font-medium text-d-muted'>{bankName}</span>
            {holderName && <PillBadge>{holderName}</PillBadge>}
            <CardStatusPill status={item.card.status} />
          </div>
          <p className='mt-0.5 truncate text-[15px] font-bold text-d-text'>
            {cardName}
            {tail ? ` ····${tail}` : ''}
          </p>
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          <StatusBadge status={item.status} />
          <ChevronRightIcon size={16} className='text-d-muted' />
        </div>
      </div>

      <div className='grid grid-cols-3 gap-2 rounded-xl bg-d-subtle px-3 py-2 text-[12px]'>
        <div>
          <p className='text-[11px] text-d-muted'>
            信用额度{limitManual ? ' · 已设' : ''}
          </p>
          <p className={`num-tabular mt-0.5 font-semibold text-d-text ${blurClass}`}>
            {effLimit !== null ? formatMoney(effLimit, currency) : '未获取'}
          </p>
        </div>
        <div>
          <p className='text-[11px] text-d-muted'>待还金额</p>
          <p className={`num-tabular mt-0.5 font-semibold text-d-gold ${blurClass}`}>
            {isNonAnchorMerged ? '合并账单' : formatMoney(item.unpaidAmount, currency)}
          </p>
        </div>
        <div>
          <p className='text-[11px] text-d-muted'>账单日 / 免息</p>
          <p className='num-tabular mt-0.5 font-semibold text-d-text'>
            {billingDay}日 · {item.graceDays}天
          </p>
        </div>
      </div>

      {showAnnualFee && annualFee !== null && (
        <div className='flex items-center justify-between text-[11px] text-d-muted'>
          <span>年费参考</span>
          <span className={`num-tabular font-semibold text-d-text ${blurClass}`}>
            {annualFee > 0 ? formatMoney(annualFee, currency) : '免年费'}
          </span>
        </div>
      )}
    </Link>
  )
}

function LoansSection({
  loanCards,
  loanPayables,
  payablesDegraded,
  onRetry,
  holderMap,
  displayCurrency,
  fxRates,
  blurClass,
}: {
  loanCards: CardWithBillsSummary[]
  loanPayables: PayableWithStatus[]
  payablesDegraded: boolean
  onRetry: () => void
  holderMap: Map<string, CardHolder>
  displayCurrency: string
  fxRates: FxRates | null
  blurClass: string
}) {
  const totalSummary = useMemo(() => {
    const items = [
      ...loanCards.map((c) => ({
        amount: c.unpaidAmount,
        currency: c.card.card_product?.currency || displayCurrency,
      })),
      ...loanPayables.map((p) => ({
        amount: p.status === 'paid' ? 0 : Math.max(0, p.amount - p.paid_amount),
        currency: p.currency || displayCurrency,
      })),
    ]
    return sumByCurrency(items, (x) => x, displayCurrency, fxRates)
  }, [loanCards, loanPayables, displayCurrency, fxRates])

  const isLoansEmpty = loanCards.length === 0 && loanPayables.length === 0

  return (
    <div className='flex flex-col gap-3.5'>
      <Alert severity='info'>
        <p className='font-semibold text-d-text'>Phase 3 独立贷款合同模块预告</p>
        <p className='mt-0.5 text-[12px] leading-5 text-d-muted'>
          独立贷款合同（房贷组合贷、LPR+BP 分段重算、等额本息/本金/先息后本期表与提前还款试算器）将于 Phase 3 上线；当前为已录入贷款卡与贷款固定支出的只读聚合视图。
        </p>
      </Alert>

      {payablesDegraded && (
        <Alert severity='warning'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-[12px] text-d-warn-ink'>
              贷款类固定支出加载失败，当前展示可能不完整
            </span>
            <button
              type='button'
              onClick={onRetry}
              className='min-h-[44px] shrink-0 rounded-lg border border-d-border px-3 text-[12px] font-semibold text-d-text'
            >
              重试
            </button>
          </div>
        </Alert>
      )}

      {(loanCards.length > 0 || loanPayables.length > 0) && (
        <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
          <div className='grid grid-cols-3 gap-2'>
            <div>
              <p className='text-[11px] text-d-muted'>贷款卡账户</p>
              <p className='num-tabular mt-0.5 text-[16px] font-bold text-d-text'>
                {loanCards.length} 笔
              </p>
            </div>
            <div>
              <p className='text-[11px] text-d-muted'>贷款固定支出</p>
              <p className='num-tabular mt-0.5 text-[16px] font-bold text-d-text'>
                {loanPayables.length} 项
              </p>
            </div>
            <div>
              <p className='text-[11px] text-d-muted'>当期待还合计</p>
              <p className={`num-tabular mt-0.5 text-[15px] font-bold text-d-gold ${blurClass}`}>
                {formatMoney(totalSummary.total, displayCurrency)}
              </p>
            </div>
          </div>
          {totalSummary.unconverted_currencies.length > 0 && (
            <p className='mt-2 text-[11px] text-d-warn-ink'>
              汇率暂不可用，以上折算合计未含：{totalSummary.unconverted_currencies.join('、')}
            </p>
          )}
        </div>
      )}

      {isLoansEmpty && !payablesDegraded && (
        <div className='rounded-2xl border border-d-border bg-d-surface'>
          <WcEmptyState
            title='暂无贷款记录'
            description='可在账单页添加贷款类固定支出，或等待 Phase 3 独立贷款合同上线后导入房贷/车贷计划'
            icon={<BankIcon size={32} />}
          />
        </div>
      )}

      {!isLoansEmpty && (
        <>
          {loanCards.length > 0 && (
            <div className='flex flex-col gap-2'>
              <p className='px-1 text-[12px] font-semibold text-d-muted'>
                贷款卡记录（card_type = loan）
              </p>
              {loanCards.map((item) => {
                const product = item.card.card_product
                const cardName = getEffectiveCardName(item.card, product)
                const currency = product?.currency || displayCurrency
                const holderName = holderMap.get(item.holder_id)?.name
                const dueDay = item.card.loan_due_day ?? null
                const effLimit = getEffectiveCreditLimit(item.card)

                return (
                  <Link
                    key={item.card.id}
                    href={`/cards/${item.card.id}`}
                    className='flex min-h-[68px] items-center justify-between gap-3 rounded-2xl border border-d-border bg-d-surface p-3.5 transition-colors active:bg-d-subtle'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <p className='truncate text-[15px] font-semibold text-d-text'>
                          {product?.bank_name ? `${product.bank_name} · ${cardName}` : cardName}
                        </p>
                        {holderName && <PillBadge>{holderName}</PillBadge>}
                        <PillBadge>只读概览</PillBadge>
                      </div>
                      <div className='mt-1 flex flex-wrap items-center gap-3 text-[12px] text-d-muted'>
                        <span className='inline-flex items-center gap-1'>
                          <CalendarIcon size={12} />
                          {dueDay ? `每月 ${dueDay} 日还款` : '还款日未设置'}
                        </span>
                        {effLimit !== null && (
                          <span className={`num-tabular ${blurClass}`}>
                            授信/本金 {formatMoney(effLimit, currency)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className='flex shrink-0 flex-col items-end gap-1'>
                      <span className={`num-tabular text-[14px] font-bold text-d-gold ${blurClass}`}>
                        {formatMoney(item.unpaidAmount, currency)}
                      </span>
                      <StatusBadge status={item.status} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {loanPayables.length > 0 && (
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between px-1'>
                <p className='text-[12px] font-semibold text-d-muted'>
                  贷款类固定支出（recurring_payables）
                </p>
                <Link
                  href='/bills'
                  className='inline-flex min-h-[44px] items-center text-[12px] font-semibold text-d-accent-light'
                >
                  去账单页处理 ›
                </Link>
              </div>
              {loanPayables.map((p) => {
                const holderName = p.holder_id ? holderMap.get(p.holder_id)?.name : undefined
                const remaining =
                  p.status === 'paid' ? 0 : Math.max(0, p.amount - p.paid_amount)
                return (
                  <Link
                    key={p.id}
                    href='/bills'
                    className='flex min-h-[68px] items-center justify-between gap-3 rounded-2xl border border-d-border bg-d-surface p-3.5 transition-colors active:bg-d-subtle'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <p className='truncate text-[15px] font-semibold text-d-text'>{p.name}</p>
                        {p.bank_name && <PillBadge>{p.bank_name}</PillBadge>}
                        {holderName && <PillBadge>{holderName}</PillBadge>}
                      </div>
                      <p className='mt-1 text-[12px] text-d-muted'>
                        {payableCycleLabel(p)} · 账期 {p.period} · 到期 {p.due_date}
                      </p>
                    </div>
                    <div className='flex shrink-0 flex-col items-end gap-1'>
                      <span className={`num-tabular text-[14px] font-bold text-d-text ${blurClass}`}>
                        {formatMoney(remaining, p.currency)}
                      </span>
                      {p.paid_amount > 0 && (
                        <span className={`num-tabular text-[11px] text-d-muted ${blurClass}`}>
                          总额 {formatMoney(p.amount, p.currency)}
                        </span>
                      )}
                      <StatusBadge status={p.status} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HoldersSection({
  holders,
  cardCounts,
  onSelectHolder,
  onManageHolders,
}: {
  holders: CardHolder[]
  cardCounts: Record<string, number>
  onSelectHolder: (holderId: string) => void
  onManageHolders: () => void
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between rounded-2xl border border-d-border bg-d-surface px-4 py-3'>
        <div>
          <p className='text-[14px] font-semibold text-d-text'>持卡人列表</p>
          <p className='text-[12px] text-d-muted'>点击持卡人可查看名下卡片详情，或进入完整管理页</p>
        </div>
        <Link
          href='/holders'
          className='inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-d-accent px-3 text-[12px] font-semibold text-d-accent-light transition-colors active:bg-d-subtle'
        >
          <span>持卡人管理</span>
          <ChevronRightIcon size={14} />
        </Link>
      </div>

      {holders.length === 0 ? (
        <div className='rounded-2xl border border-d-border bg-d-surface'>
          <WcEmptyState
            title='还没有持卡人'
            description='前往持卡人管理页面创建本人或家庭成员持卡人档案'
            actionLabel='前往持卡人管理'
            onAction={onManageHolders}
            icon={<PeopleIcon size={32} />}
          />
        </div>
      ) : (
        <div className='flex flex-col gap-2.5'>
          {holders.map((holder) => (
            <HolderCard
              key={holder.id}
              holder={holder}
              cardCount={cardCounts[holder.id] ?? 0}
              onClick={() => onSelectHolder(holder.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
