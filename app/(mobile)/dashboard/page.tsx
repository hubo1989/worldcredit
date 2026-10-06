'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Container, Typography, Box, Stack, Paper,
  IconButton, Tooltip, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, Snackbar, Alert,
  CircularProgress,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import { useRouter } from 'next/navigation'
import { getBillDashboardItems, markBillAsPaid, markAllOverdueBillsAsPaid, type BillDashboardItem } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'
import { getCardsBasicByHolders } from '@/lib/api/cards'
import { formatCardTail, getEffectiveCardName } from '@/lib/utils'
import {
  type HolderFilter,
  type FutureRange,
  FUTURE_RANGES,
  billCurrency,
  computeMetrics,
  countCardsByHolder,
  formatMoney,
} from '@/lib/dashboard-metrics'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { fetchRates, type FxRates } from '@/lib/fx'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { useAuth } from '@/lib/auth'
import { WcSkeleton } from '@/components/mobile/WcStates'
import { QuickActionSheet } from '@/components/mobile/QuickActionSheet'
import {
  EyeIcon, EyeOffIcon,
  NoteIcon, PromoIcon, BenefitIcon, ImportIcon,
  ChevronDownIcon, ChevronRightIcon,
  AlertIcon,
} from '@/components/icons/WcIcon'
import type { CardHolder } from '@/lib/types'

/** 金刚区项 */
interface QuickAction {
  key: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { displayConfig, togglePrivacyMode } = useUserPreferences()
  const router = useRouter()

  /** 折算目标币种：用户偏好 display_config.default_currency（缺省 CNY）。 */
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  /** 汇率状态：null 表示这次没取到，界面走「未含汇率」的降级展示。 */
  const [fxRates, setFxRates] = useState<FxRates | null>(null)

  // ---- 数据状态 ----
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [bills, setBills] = useState<BillDashboardItem[]>([])
  const [cards, setCards] = useState<Array<{ id: string; holder_id: string }>>([])

  // ---- 交互状态 ----
  const [holderFilter, setHolderFilter] = useState<HolderFilter>('all')
  const [futureRange, setFutureRange] = useState<FutureRange>(7)
  const [debtExpanded, setDebtExpanded] = useState(false)
  const [quickSheetOpen, setQuickSheetOpen] = useState(false)

  // 一键还款与 Toast 状态
  const [payAllOpen, setPayAllOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const privacyOn = !!displayConfig.privacy_mode
  const blurClass = privacyOn ? 'privacy-blur' : 'privacy-clear'

  // ---- 数据加载 ----
  const loadData = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setError(null)
    try {
      // 并行：持卡人 / 账单；卡片依赖持卡人 id，随后批量查询
      const [holderList, allBills] = await Promise.all([
        getHolders(user.id),
        getBillDashboardItems(200, user.id),
      ])
      holderList.sort((a, b) => a.created_at.localeCompare(b.created_at))
      const holderIds = holderList.map(h => h.id)
      const cardsRes = holderIds.length > 0 ? await getCardsBasicByHolders(holderIds) : []

      setHolders(holderList)
      setCards(cardsRes)
      setBills(allBills)
    } catch (err) {
      console.error('Dashboard load failed:', err)
      setError(err instanceof Error ? err.message : '加载失败，请下拉重试')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 汇率与业务数据解耦：拿不到也不该让整页失败，只是合计里少了外币部分。
  useEffect(() => {
    let cancelled = false
    fetchRates()
      .then(rates => { if (!cancelled) setFxRates(rates) })
      .catch(() => { if (!cancelled) setFxRates(null) })
    return () => { cancelled = true }
  }, [])

  const handlePaySingle = async (e: React.MouseEvent, bill: BillDashboardItem) => {
    e.stopPropagation()
    try {
      const amount = bill.remaining_amount > 0 ? bill.remaining_amount : Number(bill.bill_amount)
      await markBillAsPaid(bill.id, amount)
      // 单张账单金额用自己的币种展示，不能挂人民币符号
      setToast({
        open: true,
        message: `🎉 已成功结清 ${bill.card?.card_product?.bank_name || ''} 账单（${formatMoney(amount, billCurrency(bill, displayCurrency))}）！`,
        severity: 'success'
      })
      loadData()
    } catch (err) {
      setToast({ open: true, message: '还款失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    }
  }

  const handlePayAllOverdue = async () => {
    if (!user?.id) return
    setPaying(true)
    try {
      const res = await markAllOverdueBillsAsPaid(user.id, metrics.overdueBills)
      setPayAllOpen(false)
      // 展示口径用界面已折算好的 metrics.overdueAmount：服务端返回的 totalAmount
      // 仍是跨币种直接相加的老口径（那是 bills.server.ts，本次不改）。
      setToast({
        open: true,
        message: `🎉 恭喜！已一键全额结清 ${res.count} 笔逾期账单（合计 ${formatMoney(metrics.overdueAmount, displayCurrency)}）！`,
        severity: 'success'
      })
      await loadData()
    } catch (err) {
      setToast({ open: true, message: '一键还款失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    } finally {
      setPaying(false)
    }
  }

  // ---- 派生数据 ----

  // 当前选中持卡人下的账单
  const visibleBills = useMemo(() => {
    if (holderFilter === 'all') return bills
    return bills.filter(b => b.card?.holder_id === holderFilter)
  }, [bills, holderFilter])

  // 当前选中持卡人下的卡片
  const visibleCards = useMemo(() => {
    if (holderFilter === 'all') return cards
    return cards.filter(c => c.holder_id === holderFilter)
  }, [cards, holderFilter])

  const metrics = useMemo(
    () => computeMetrics(visibleBills, futureRange, displayCurrency, fxRates),
    [visibleBills, futureRange, displayCurrency, fxRates]
  )

  const cardsByHolder = useMemo(() => countCardsByHolder(cards), [cards])
  const totalCardCount = cards.length

  // 隐私脱敏：金额整体模糊
  const amountClass = `${blurClass} num-tabular`

  // ---- 渲染辅助 ----

  /** 持卡人分段标签：全部 + 各持卡人姓名首字 */
  const holderPills = useMemo(() => {
    const items: Array<{ value: HolderFilter; label: string; fullName?: string }> = [
      { value: 'all', label: '全部' },
    ]
    for (const h of holders) {
      const first = (h.name || '?').trim().charAt(0).toUpperCase()
      items.push({ value: h.id, label: first, fullName: h.name })
    }
    return items
  }, [holders])

  /** 金刚区 4 项 */
  const quickActions: QuickAction[] = [
    {
      key: 'note',
      label: '记一笔',
      icon: <NoteIcon size={26} />,
      onClick: () => setQuickSheetOpen(true),
    },
    {
      key: 'promo',
      label: '优惠',
      icon: <PromoIcon size={26} />,
      onClick: () => router.push('/promos'),
    },
    {
      key: 'benefit',
      label: '权益',
      icon: <BenefitIcon size={26} />,
      onClick: () => router.push('/benefits'),
    },
    {
      key: 'import',
      label: '邮箱账单',
      icon: <ImportIcon size={26} />,
      onClick: () => router.push('/gmail-ledger'),
    },
  ]

  // visibleCards 仅用于未来潜在展示，这里消费一下避免 lint 警告
  void visibleCards

  // ---- 加载态：骨架屏 ----
  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 3, pb: 10, px: 2 }}>
        <Box sx={{ mb: 3 }}>
          <WcSkeleton height={36} count={1} radius={8} />
          <WcSkeleton height={14} count={1} radius={4} />
        </Box>
        <Box sx={{ mb: 3 }}>
          <WcSkeleton height={40} count={1} radius={999} />
        </Box>
        <Box sx={{ mb: 3 }}>
          <WcSkeleton height={140} count={1} radius={12} />
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1.5,
            mb: 3,
          }}
        >
          <WcSkeleton height={96} count={1} radius={12} />
          <WcSkeleton height={96} count={1} radius={12} />
          <WcSkeleton height={96} count={1} radius={12} />
          <WcSkeleton height={96} count={1} radius={12} />
        </Box>
        <WcSkeleton height={72} count={2} radius={12} />
      </Container>
    )
  }

  return (
    <div className="min-h-dvh bg-d-bg pb-4 text-d-text">
      {/* 页头：问候 + 隐私开关 */}
      <div className="flex items-center gap-3 px-5 pt-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-d-accent text-sm font-bold text-white">呼</div>
        <div className="flex-1">
          <p className="text-[11px] leading-4 text-d-muted">概览</p>
          <p className="text-[15px] font-bold leading-5">呼博</p>
        </div>
        <button
          onClick={togglePrivacyMode}
          aria-label={privacyOn ? '显示金额' : '隐匿金额'}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-d-border bg-d-surface"
        >
          {privacyOn ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>

      {/* 居中大余额 */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <p className="text-xs text-d-muted">总待还款</p>
        <p className={amountClass + ' text-[34px] font-bold leading-none'}>
          {formatMoney(metrics.totalPending, displayCurrency)}
        </p>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-d-muted">含逾期</span>
            <span className={amountClass + ' text-[13px] font-semibold text-d-danger-ink'}>
              {formatMoney(metrics.overdueAmount, displayCurrency)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-d-muted">未来 {futureRange} 天</span>
            <span className={amountClass + ' text-[13px] font-semibold text-d-warn-ink'}>
              {formatMoney(metrics.futureAmount, displayCurrency)}
            </span>
          </div>
        </div>
        {metrics.unconvertedCurrencies.length > 0 && (
          <p className="text-[11px] text-d-muted">
            未含汇率：{metrics.unconvertedCurrencies.join('、')} 未计入合计
          </p>
        )}
      </div>

      {/* 逾期风险条 */}
      {metrics.overdueBills.length > 0 && (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-xl bg-d-danger-soft p-3">
          <span className="text-sm text-d-danger-ink">!</span>
          <div className="flex-1">
            <p className="text-xs font-bold text-d-danger-ink">{metrics.overdueBills.length} 笔账单已逾期</p>
            <p className="text-[11px] text-d-danger-ink">建议今日处理，避免逾期费用</p>
          </div>
          <button
            onClick={() => setPayAllOpen(true)}
            className="h-11 shrink-0 rounded-xl bg-d-danger px-4 text-xs font-semibold text-white"
          >
            一键全部还款
          </button>
        </div>
      )}

      {/* 当天需还款（B0-2 修订需求） */}
      {(() => {
        const dueToday = visibleBills.filter(b => b.days_until_due === 0)
        if (dueToday.length === 0) return null
        return (
          <div className="mx-5 mt-4 rounded-2xl border border-d-gold-deep bg-d-surface p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold">今天需还款</p>
              <p className="text-[11px] text-d-gold">{dueToday.length} 笔</p>
            </div>
            {dueToday.map(b => (
              <div key={b.id} className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold">
                    {b.card?.card_product?.bank_name || '信用卡'} · 尾号 {b.card?.card_number_last4 || '----'}
                  </p>
                  <p className="text-[11px] text-d-gold">今日到期 · {formatMoney(b.remaining_amount, billCurrency(b, displayCurrency))}</p>
                </div>
                <button
                  onClick={e => handlePaySingle(e, b)}
                  className="h-11 shrink-0 rounded-xl bg-d-gold px-4 text-xs font-semibold text-d-bg"
                >
                  立即还款
                </button>
              </div>
            ))}
          </div>
        )
      })()}

      {/* 今日可享优惠（B0-2 修订需求）：统计 + 入口 */}
      <button
        onClick={() => router.push('/promos')}
        className="mx-5 mt-4 flex w-[calc(100%-40px)] items-center gap-3 rounded-2xl border border-d-border bg-d-surface p-3.5 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-d-subtle text-d-gold">%</div>
        <div className="flex-1">
          <p className="text-[13px] font-bold">今日可享优惠</p>
          <p className="text-[11px] text-d-muted">
            {promoCount !== null ? promoCount + ' 项有效期内' : '查看名下卡片在有效期内的优惠'}
          </p>
        </div>
        <span className="text-d-muted">›</span>
      </button>

      {/* 持卡人筛选 */}
      <div className="mt-4 flex gap-2 overflow-x-auto px-5">
        {holderPills.map(p => {
          const active = holderFilter === p.value
          return (
            <button
              key={p.value}
              onClick={() => setHolderFilter(p.value)}
              title={p.fullName || p.label}
              className={
                'shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold ' +
                (active ? 'bg-d-accent text-white' : 'border border-d-border bg-d-surface text-d-muted')
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* 指标 2×2 */}
      <div className="mt-4 grid grid-cols-2 gap-3 px-5">
        <button onClick={() => router.push('/bills')} className="rounded-2xl border border-d-border bg-d-surface p-3.5 text-left">
          <p className="text-xs text-d-muted">已逾期</p>
          <p className={amountClass + ' mt-1 text-[22px] font-bold ' + (metrics.overdueAmount > 0 ? 'text-d-danger-ink' : 'text-d-success-ink')}>
            {formatMoney(metrics.overdueAmount, displayCurrency)}
          </p>
          <p className="mt-1 text-[11px] text-d-muted">
            {metrics.overdueAmount > 0 ? metrics.overdueBills.length + ' 笔待处理' : '暂无逾期'}
          </p>
        </button>
        <div className="rounded-2xl border border-d-border bg-d-surface p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="whitespace-nowrap text-xs text-d-muted">未来待还</p>
            <div className="flex gap-1">
              {FUTURE_RANGES.map(r => {
                const active = futureRange === r
                return (
                  <button
                    key={r}
                    onClick={() => setFutureRange(r)}
                    className={
                      'whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ' +
                      (active ? 'bg-d-gold-soft text-d-gold' : 'text-d-muted')
                    }
                  >
                    {r}天
                  </button>
                )
              })}
            </div>
          </div>
          <p className={amountClass + ' mt-1 text-[22px] font-bold'}>
            {formatMoney(metrics.futureAmount, displayCurrency)}
          </p>
          <p className="mt-1 text-[11px] text-d-muted">{futureRange} 天内到期合计</p>
        </div>
        <button
          onClick={() => setDebtExpanded(v => !v)}
          className="rounded-2xl border border-d-border bg-d-surface p-3.5 text-left"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-d-muted">总欠款</p>
            <span className="text-xs text-d-muted">{debtExpanded ? '收起' : '展开'}</span>
          </div>
          <p className={amountClass + ' mt-1 text-[22px] font-bold'}>
            {formatMoney(metrics.plainOwed, displayCurrency)}
          </p>
          {debtExpanded && (
            <div className="mt-2 space-y-1 border-t border-d-border pt-2 text-[11px] text-d-muted">
              <div className="flex justify-between"><span>分期剩余本金</span><span>暂未接入</span></div>
              <div className="flex justify-between"><span>贷款剩余本息</span><span>暂未接入</span></div>
              <div className="flex justify-between"><span>普通未还</span>
                <span className={amountClass + ' font-semibold'}>{formatMoney(metrics.plainOwed, displayCurrency)}</span>
              </div>
            </div>
          )}
        </button>
        <div className="rounded-2xl border border-d-border bg-d-surface p-3.5">
          <p className="text-xs text-d-muted">未出账单</p>
          <p className="mt-1 text-[22px] font-bold text-d-muted">暂无数据</p>
          <p className="mt-1 text-[11px] text-d-muted">邮件解析待接入</p>
        </div>
      </div>

      {/* 账户 chips */}
      <div className="mt-5 px-5">
        <p className="text-[15px] font-semibold">账户</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setHolderFilter('all')}
            className={
              'rounded-full px-3 py-1 text-xs font-semibold ' +
              (holderFilter === 'all' ? 'bg-d-accent text-white' : 'border border-d-border bg-d-surface text-d-text')
            }
          >
            全部 {totalCardCount} 张
          </button>
          {holders.map(h => (
            <button
              key={h.id}
              onClick={() => setHolderFilter(h.id)}
              className={
                'rounded-full px-3 py-1 text-xs font-semibold ' +
                (holderFilter === h.id ? 'bg-d-accent text-white' : 'border border-d-border bg-d-surface text-d-text')
              }
            >
              {h.name} {cardsByHolder[h.id] || 0} 张
            </button>
          ))}
        </div>
      </div>

      {/* 金刚区 */}
      <div className="mx-5 mt-4 grid grid-cols-4 gap-2">
        {quickActions.map(a => (
          <button
            key={a.key}
            onClick={a.onClick}
            className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-d-border bg-d-surface py-3"
          >
            {a.icon}
            <span className="text-xs font-semibold">{a.label}</span>
          </button>
        ))}
      </div>

    </div>
  )
}
