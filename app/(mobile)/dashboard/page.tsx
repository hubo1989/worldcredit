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
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { fetchRates, sumByCurrency, currencySymbol, type FxRates } from '@/lib/fx'
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

// ---- 类型与常量 ----

/** 持卡人分段值：'all' 或持卡人 id */
type HolderFilter = 'all' | string

/** 未来 N 天待还切换项 */
type FutureRange = 7 | 14 | 30

/** 金刚区项 */
interface QuickAction {
  key: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}

const FUTURE_RANGES: FutureRange[] = [7, 14, 30]

/**
 * 金额转展示字符串（币种符号 + 千分位）。隐私模式下由调用方决定是否脱敏。
 *
 * 币种必须由调用方传入：这个应用同时有 CNY / USD / HKD 的卡，写死 ¥ 会把外币
 * 账单显示成人民币。
 */
function formatMoney(n: number, currency: string): string {
  return `${currencySymbol(currency)}${(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

/** 账单所在币种：卡产品的币种就是账单币种。 */
function billCurrency(bill: BillDashboardItem, fallback: string): string {
  return bill.card?.card_product?.currency || fallback
}

/**
 * 计算一组账单的指标。
 *
 * 所有金额都先按币种分组、再折算到目标币种，绝不跨币种直接相加。返回的四个数字
 * 都是「折算后的真数」，同时附带 fx 元数据：汇率不可用时跨币种部分被排除在数字
 * 之外（而不是按 1:1 混进去），UI 通过 fx 标记向用户说明。
 */
function computeMetrics(
  bills: BillDashboardItem[],
  futureDays: FutureRange,
  targetCurrency: string,
  rates: FxRates | null
) {
  // 只统计未还清的账单（§3.4）
  const unpaid = bills.filter(b => b.computed_status !== 'paid')
  const pickAmount = (b: BillDashboardItem) => ({
    amount: b.remaining_amount || 0,
    currency: billCurrency(b, targetCurrency),
  })

  const pendingSum = sumByCurrency(unpaid, pickAmount, targetCurrency, rates)

  // 已逾期：已过还款日且未还清（days_until_due < 0）
  const overdueBills = unpaid.filter(b => b.days_until_due < 0)
  const overdueSum = sumByCurrency(overdueBills, pickAmount, targetCurrency, rates)

  // 未来 N 天待还：还款日在 [0, N] 区间内
  const futureBills = unpaid.filter(b => b.days_until_due >= 0 && b.days_until_due <= futureDays)
  const futureSum = sumByCurrency(futureBills, pickAmount, targetCurrency, rates)

  // 总欠款：当前数据模型仅"普通未还"，分期/贷款暂未接入（§3.2）
  const plainOwedSum = pendingSum

  return {
    totalPending: pendingSum.total,
    overdueAmount: overdueSum.total,
    overdueBills,
    futureAmount: futureSum.total,
    plainOwed: plainOwedSum.total,
    unpaidCount: unpaid.length,
    /** 汇率拿到没有：为 false 时下面的合计是不完整的，必须显式标注。 */
    ratesAvailable: rates !== null,
    /** 缺汇率因而未计入合计的币种（含未折算金额，供 UI 展示明细）。 */
    unconvertedCurrencies: Array.from(new Set([
      ...pendingSum.unconverted_currencies,
      ...overdueSum.unconverted_currencies,
      ...futureSum.unconverted_currencies,
    ])).sort(),
    fx: { pending: pendingSum, overdue: overdueSum, future: futureSum, plainOwed: plainOwedSum },
    /** 当前口径下是否出现多币种，用于决定要不要展示币种构成。 */
    mixed: pendingSum.mixed,
  }
}

/** 卡数统计：{ holderId: count } */
function countCardsByHolder(cards: Array<{ holder_id: string }>): Record<string, number> {
  const map: Record<string, number> = {}
  for (const c of cards) {
    const hid = c.holder_id
    if (!hid) continue
    map[hid] = (map[hid] || 0) + 1
  }
  return map
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
    <Container maxWidth="sm" sx={{ py: 3, pb: 10, px: 2 }}>
      {/* 顶部：标题 + 隐私切换 */}
      <Box
        sx={{
          mb: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontSize: 'var(--type-title-size)',
              lineHeight: 'var(--type-title-line)',
              fontWeight: 'var(--type-title-weight)',
              letterSpacing: 'var(--type-title-tracking)',
              color: 'var(--text)',
            }}
          >
            概览
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.25,
            }}
          >
            管控信用卡资产与还款日程
          </Typography>
        </Box>
        <Tooltip title={privacyOn ? '显示金额' : '隐匿金额'} placement="left">
          <IconButton
            onClick={togglePrivacyMode}
            aria-label={privacyOn ? '显示金额' : '隐匿金额'}
            sx={{
              width: 'var(--button-size)',
              height: 'var(--button-size)',
              background: 'var(--button-face)',
              color: 'var(--text-on-dark)',
              boxShadow: 'var(--button-shadow)',
              '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
              '&:active': { boxShadow: 'var(--button-shadow-press)' },
            }}
          >
            {privacyOn ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* 持卡人分段控件（pills） */}
      <Box sx={{ mb: 2.5, display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
        {holderPills.map(p => {
          const active = holderFilter === p.value
          return (
            <Box
              key={p.value}
              role="button"
              tabIndex={0}
              onClick={() => setHolderFilter(p.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setHolderFilter(p.value)
                }
              }}
              title={p.fullName || p.label}
              sx={{
                flex: '0 0 auto',
                px: 2.25,
                py: 0.75,
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out)',
                bgcolor: active ? 'var(--navy-600)' : 'var(--paper)',
                color: active ? 'var(--text-on-dark)' : 'var(--text)',
                border: 0,
                boxShadow: active ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
                userSelect: 'none',
                '&:hover': active ? {} : { boxShadow: 'var(--shadow-e2)' },
              }}
            >
              {p.label}
            </Box>
          )
        })}
      </Box>

      {/* 主指标卡：总待还款（深蓝渐变） */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 'var(--radius-depth-3)',
          background: 'linear-gradient(135deg, var(--navy-800) 0%, var(--navy-600) 100%)',
          color: 'var(--text-on-dark)',
          // 深蓝主指标卡：品牌暗影
          boxShadow: 'var(--shadow-dark)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.78)',
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-line)',
            letterSpacing: 'var(--type-body-tracking)',
            mb: 1,
          }}
        >
          总待还款
        </Typography>
        <Typography
          className={amountClass}
          sx={{
            color: 'var(--text-on-dark)',
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.1,
            mb: 2,
            letterSpacing: 0,
          }}
        >
          {formatMoney(metrics.totalPending, displayCurrency)}
        </Typography>

        {/* 子指标：逾期 + 未来 N 天 */}
        <Stack direction="row" spacing={3}>
          <Box>
            <Typography
              sx={{
                color: 'rgba(255,255,255,0.68)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                mb: 0.25,
              }}
            >
              含逾期
            </Typography>
            <Typography
              className={amountClass}
              sx={{
                // 暗底上的告警红：从 --danger 提亮派生（同 DESIGN.md sky-on-navy 的暗表面语义色约定）
                color: metrics.overdueAmount > 0
                  ? 'color-mix(in srgb, var(--danger) 56%, #FFFFFF)'
                  : 'rgba(255,255,255,0.9)',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {formatMoney(metrics.overdueAmount, displayCurrency)}
            </Typography>
          </Box>
          <Box>
            <Typography
              sx={{
                color: 'rgba(255,255,255,0.68)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                mb: 0.25,
              }}
            >
              未来 {futureRange} 天
            </Typography>
            <Typography
              className={amountClass}
              sx={{ color: 'var(--warn)', fontSize: 14, fontWeight: 600 }}
            >
              {formatMoney(metrics.futureAmount, displayCurrency)}
            </Typography>
          </Box>
        </Stack>
        {/* 汇率不可用时，明确告诉用户合计里缺了哪些外币，而不是给一个看着正常的假数 */}
        {metrics.unconvertedCurrencies.length > 0 && (
          <Typography sx={{ fontSize: 12, lineHeight: '16px', color: 'rgba(255,255,255,0.72)', mt: 1 }}>
            未含汇率：{metrics.unconvertedCurrencies.join('、')} 未计入合计
          </Typography>
        )}
      </Paper>

      {/* 指标网格 2×2 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1.5,
          mb: 3,
        }}
      >
        {/* 1. 已逾期 */}
        <Paper
          elevation={0}
          onClick={() => router.push('/bills')}
          sx={{
            p: 2,
            // 无边框：分层阴影表达层级
            borderRadius: 'var(--radius-depth-2)',
            bgcolor: 'var(--paper)',
            border: 0,
            boxShadow: 'var(--shadow-e1)',
            cursor: 'pointer',
            transition: 'box-shadow var(--dur-fast) var(--ease-out)',
            '&:hover': { boxShadow: 'var(--shadow-e3)' },
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mb: 0.5,
            }}
          >
            已逾期
          </Typography>
          <Typography
            className={amountClass}
            sx={{
              fontSize: 22,
              fontWeight: 700,
              color: metrics.overdueAmount > 0 ? 'var(--danger)' : 'var(--success)',
              lineHeight: 1.2,
            }}
          >
            {formatMoney(metrics.overdueAmount, displayCurrency)}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.5,
            }}
          >
            {metrics.overdueAmount > 0 ? `${metrics.overdueBills.length} 笔待处理` : '暂无逾期'}
          </Typography>
        </Paper>

        {/* 2. 未来 N 天待还（带 7/14/30 切换） */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 'var(--radius-depth-2)',
            bgcolor: 'var(--paper)',
            border: 0,
            boxShadow: 'var(--shadow-e1)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              // 2 列指标卡在 360 下内宽仅 126px：标签与 7/14/30 天胶囊放不下同一行，
              // 允许换行，避免两者被同时压成两行
              flexWrap: 'wrap',
              columnGap: 1,
              rowGap: 0.5,
              mb: 0.5,
            }}
          >
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
                whiteSpace: 'nowrap',
              }}
            >
              未来待还
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
              {FUTURE_RANGES.map(r => {
                const active = futureRange === r
                return (
                  <Box
                    key={r}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFutureRange(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setFutureRange(r)
                      }
                    }}
                    sx={{
                      px: 0.75,
                      py: 0.25,
                      // 计数级小胶囊：11px 数字在 17px 圆内，属既定尺寸约束
                      fontSize: 11,
                      lineHeight: 1.3,
                      fontWeight: 600,
                      borderRadius: 'var(--radius-pill)',
                      cursor: 'pointer',
                      // 「7 天」是原子语义单元，不允许在数字与单位之间折行
                      whiteSpace: 'nowrap',
                      bgcolor: active ? 'rgba(201,162,39,0.15)' : 'transparent',
                      color: active ? 'var(--gold-700)' : 'var(--text-disabled)',
                      transition: 'background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
                      '&:hover': { bgcolor: 'rgba(201,162,39,0.10)' },
                    }}
                  >
                    {r}天
                  </Box>
                )
              })}
            </Box>
          </Box>
          <Typography
            className={amountClass}
            sx={{
              fontSize: 22,
              fontWeight: 700,
              // 白卡上的金额是正文级信息，gold-500 只有 2.42:1（连 3:1 的大字号门槛都不到），
              // 用 gold-700（4.90:1）。gold-500 只留给深蓝底上的金色强调。
              color: 'var(--gold-700)',
              lineHeight: 1.2,
            }}
          >
            {formatMoney(metrics.futureAmount, displayCurrency)}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.5,
            }}
          >
            {futureRange} 天内到期合计
          </Typography>
        </Paper>

        {/* 3. 总欠款（可展开） */}
        <Paper
          elevation={0}
          onClick={() => setDebtExpanded(v => !v)}
          sx={{
            p: 2,
            borderRadius: 'var(--radius-depth-2)',
            bgcolor: 'var(--paper)',
            border: 0,
            boxShadow: 'var(--shadow-e1)',
            cursor: 'pointer',
            transition: 'box-shadow var(--dur-fast) var(--ease-out)',
            '&:hover': { boxShadow: 'var(--shadow-e3)' },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
              }}
            >
              总欠款
            </Typography>
            <ChevronDownIcon
              size={16}
              style={{
                transition: 'transform var(--dur-fast) var(--ease-out)',
                transform: debtExpanded ? 'rotate(180deg)' : 'none',
                color: 'var(--strong)',
              }}
            />
          </Box>
          <Typography
            className={amountClass}
            sx={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.2,
              mt: 0.5,
            }}
          >
            {formatMoney(metrics.plainOwed, displayCurrency)}
          </Typography>

          {debtExpanded && (
            <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid var(--track)' }}>
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                    分期剩余本金
                  </Typography>
                  <Typography
                    className="num-tabular"
                    sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--text-disabled)' }}
                  >
                    暂未接入
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                    贷款剩余本息
                  </Typography>
                  <Typography
                    className="num-tabular"
                    sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--text-disabled)' }}
                  >
                    暂未接入
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                    普通未还
                  </Typography>
                  <Typography
                    className={amountClass}
                    sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', fontWeight: 600, color: 'var(--text)' }}
                  >
                    {formatMoney(metrics.plainOwed, displayCurrency)}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          )}
        </Paper>

        {/* 4. 未出账单（占位） */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 'var(--radius-depth-2)',
            bgcolor: 'var(--paper)',
            border: 0,
            boxShadow: 'var(--shadow-e1)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
            }}
          >
            未出账单
          </Typography>
          <Typography
            sx={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text-disabled)',
              lineHeight: 1.2,
              mt: 0.5,
            }}
          >
            暂无数据
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.5,
            }}
          >
            邮件解析待接入
          </Typography>
        </Paper>
      </Box>

      {/* 账户数 chips */}
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
            mb: 1,
          }}
        >
          账户
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Box
            onClick={() => setHolderFilter('all')}
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
              cursor: 'pointer',
              bgcolor: holderFilter === 'all' ? 'var(--navy-600)' : 'var(--paper)',
              color: holderFilter === 'all' ? 'var(--text-on-dark)' : 'var(--text)',
              // 无边框：选中态用填充 + 分层阴影
              border: 0,
              boxShadow: holderFilter === 'all' ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
            }}
          >
            全部 {totalCardCount} 张
          </Box>
          {holders.map(h => (
            <Box
              key={h.id}
              onClick={() => setHolderFilter(h.id)}
              sx={{
                px: 1.5,
                py: 0.5,
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
                cursor: 'pointer',
                bgcolor: holderFilter === h.id ? 'var(--navy-600)' : 'var(--paper)',
                color: holderFilter === h.id ? 'var(--text-on-dark)' : 'var(--text)',
                border: 0,
                boxShadow: holderFilter === h.id ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
              }}
            >
              {h.name} {cardsByHolder[h.id] || 0} 张
            </Box>
          ))}
        </Box>
      </Box>

      {/* 金刚区 4 格 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1,
          mb: 3,
          px: 0.5,
        }}
      >
        {quickActions.map(a => (
          <Box
            key={a.key}
            role="button"
            tabIndex={0}
            onClick={a.onClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                a.onClick()
              }
            }}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              py: 1.5,
              borderRadius: 'var(--radius-depth-2)',
              cursor: 'pointer',
              color: 'var(--strong)',
              transition: 'box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out)',
              bgcolor: 'var(--paper)',
              boxShadow: 'var(--shadow-e1)',
              '&:hover': { boxShadow: 'var(--shadow-e2)' },
              '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: 2 },
              // 触控区域 ≥ 64pt（minHeight 64 + 内边距）
              minHeight: 76,
            }}
          >
            {a.icon}
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
                color: 'var(--text)',
              }}
            >
              {a.label}
            </Typography>
          </Box>
        ))}
      </Box>

      <QuickActionSheet open={quickSheetOpen} onClose={() => setQuickSheetOpen(false)} onChanged={loadData} />

      {/* 逾期明细 */}
      <Box
        sx={{
          mb: 1.5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          <AlertIcon size={18} style={{ color: metrics.overdueAmount > 0 ? 'var(--danger)' : 'var(--success)' }} />
          逾期明细
        </Typography>
        {metrics.overdueBills.length > 0 && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<CheckIcon fontSize="small" />}
              onClick={() => setPayAllOpen(true)}
              sx={{
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-body-size)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 700,
                py: 0.25,
                px: 1.25,
                whiteSpace: 'nowrap',
                textTransform: 'none',
                boxShadow: 'none',
              }}
            >
              一键全部还款
            </Button>
          <Box
            onClick={() => router.push('/bills')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              cursor: 'pointer',
              color: 'var(--strong)',
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
            }}
            >
              查看全部
              <ChevronRightIcon size={14} />
            </Box>
          </Stack>
        )}
      </Box>

      {metrics.overdueBills.length === 0 ? (
        // 无逾期：绿色"本月无逾期"空态
        <Paper
          elevation={0}
          sx={{
            p: 3,
            // 无逾期空态：语义成功色容器，保留 1px 语义描边
            borderRadius: 'var(--radius-depth-2)',
            bgcolor: 'color-mix(in srgb, var(--success) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
            textAlign: 'center',
          }}
        >
          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', fontWeight: 600, color: 'var(--success)' }}>
            本月无逾期
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.5,
            }}
          >
            所有账单都在按时还款
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {metrics.overdueBills
            .slice()
            .sort((a, b) => a.days_until_due - b.days_until_due)
            .map(bill => {
              const product = bill.card?.card_product
              const tailDigits = formatCardTail(bill.card?.card_number_last4)
              const tail = tailDigits ? `尾号 ${tailDigits}` : '未记录尾号'
              // 修改内容优先：卡级别名称覆盖 > 卡产品默认名称
              const cardDisplayName = bill.card ? getEffectiveCardName(bill.card, product) : ''
              const overdueDays = Math.abs(bill.days_until_due)
              const remaining = bill.remaining_amount > 0 ? bill.remaining_amount : Number(bill.bill_amount)

              return (
                <Paper
                  key={bill.id}
                  elevation={0}
                  onClick={() => router.push('/bills')}
                  sx={{
                    p: 2,
                    borderRadius: 'var(--radius-depth-2)',
                    bgcolor: 'var(--paper)',
                    border: 0,
                    boxShadow: 'var(--shadow-e1)',
                    cursor: 'pointer',
                    transition: 'box-shadow var(--dur-fast) var(--ease-out)',
                    '&:hover': { boxShadow: 'var(--shadow-e3)' },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      mb: 1,
                      gap: 1,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: 'var(--type-body-size)',
                          lineHeight: 'var(--type-body-line)',
                          letterSpacing: 'var(--type-body-tracking)',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                        noWrap
                      >
                        {product?.bank_name || '未知银行'} {cardDisplayName}
                      </Typography>
                      <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                        {tail} · {bill.bill_month || ''}
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        flexShrink: 0,
                        px: 1,
                        py: 0.25,
                        borderRadius: 'var(--radius-pill)',
                        bgcolor: 'rgba(207,46,46,0.10)',
                        color: 'var(--danger-ink)',
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        fontWeight: 700,
                      }}
                    >
                      逾期 {overdueDays} 天
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      pt: 0.5,
                      borderTop: '1px dashed var(--track)'
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>待还金额</Typography>
                      <Typography
                        className={amountClass}
                        sx={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: 'var(--danger-ink)',
                        }}
                      >
                        {formatMoney(remaining, billCurrency(bill, displayCurrency))}
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      startIcon={<CheckIcon fontSize="small" />}
                      onClick={(e) => handlePaySingle(e, bill)}
                      sx={{
                        borderRadius: 'var(--radius-pill)',
                        fontSize: 'var(--type-body-size)',
                        letterSpacing: 'var(--type-body-tracking)',
                        fontWeight: 700,
                        py: 0.35,
                        px: 1.5,
                        textTransform: 'none',
                      }}
                    >
                      全额结清
                    </Button>
                  </Box>
                </Paper>
              )
            })}
        </Stack>
      )}

      {/* 一键全部还款确认弹窗 */}
      <Dialog open={payAllOpen} onClose={() => !paying && setPayAllOpen(false)} maxWidth="xs" fullWidth>
        {/* Dialog 走 portal，在 .phone 之外：显式声明角色令牌 */}
        <DialogTitle
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
          }}
        >
          确认一键完成全部还款？
        </DialogTitle>
        <DialogContent>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              fontFamily: 'var(--font-body)',
              mb: 1,
            }}
          >
            系统将把当前 <strong>{metrics.overdueBills.length} 笔</strong>逾期账单全部标记为已结清。
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-section-size)',
              lineHeight: 'var(--type-section-line)',
              fontWeight: 'var(--type-section-weight)',
              letterSpacing: 'var(--type-section-tracking)',
              color: 'var(--danger)',
              fontFamily: 'var(--font-display)',
            }}
          >
            合计结清金额：{formatMoney(metrics.overdueAmount, displayCurrency)}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setPayAllOpen(false)} disabled={paying}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handlePayAllOverdue}
            disabled={paying}
            startIcon={paying ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ fontWeight: 700, borderRadius: 'var(--radius-pill)' }}
          >
            确认全部结清
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast 提示 */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3500}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} sx={{ borderRadius: 'var(--radius-depth-1)', fontWeight: 600 }}>
          {toast.message}
        </Alert>
      </Snackbar>

      {error && (
        <Box sx={{ mt: 3 }}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              // 错误态：语义危险色容器，保留 1px 语义描边
              borderRadius: 'var(--radius-depth-2)',
              bgcolor: 'rgba(207,46,46,0.06)',
              border: '1px solid rgba(207,46,46,0.20)',
              textAlign: 'center',
            }}
          >
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--danger)',
                mb: 1,
              }}
            >
              {error}
            </Typography>
            <Box
              onClick={loadData}
              sx={{
                display: 'inline-block',
                px: 2,
                py: 0.5,
                borderRadius: 'var(--radius-pill)',
                bgcolor: 'var(--danger)',
                color: 'var(--text-on-dark)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重试
            </Box>
          </Paper>
        </Box>
      )}
    </Container>
  )
}
