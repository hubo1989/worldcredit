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
import { clientDb } from '@/lib/client-db'
import { getBillDashboardItems, markBillAsPaid, markAllOverdueBillsAsPaid, type BillDashboardItem } from '@/lib/api/bills'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
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

/** 元转展示字符串（千分位）。隐私模式下由调用方决定是否脱敏。 */
function formatCNY(n: number): string {
  return `¥${(n || 0).toLocaleString('zh-CN')}`
}

/** 计算一组账单的六大指标 */
function computeMetrics(bills: BillDashboardItem[], futureDays: FutureRange) {
  // 只统计未还清的账单（§3.4）
  const unpaid = bills.filter(b => b.computed_status !== 'paid')

  const totalPending = unpaid.reduce((acc, b) => acc + (b.remaining_amount || 0), 0)

  // 已逾期：已过还款日且未还清（days_until_due < 0）
  const overdueBills = unpaid.filter(b => b.days_until_due < 0)
  const overdueAmount = overdueBills.reduce((acc, b) => acc + (b.remaining_amount || 0), 0)

  // 未来 N 天待还：还款日在 [0, N] 区间内
  const futureBills = unpaid.filter(b => b.days_until_due >= 0 && b.days_until_due <= futureDays)
  const futureAmount = futureBills.reduce((acc, b) => acc + (b.remaining_amount || 0), 0)

  // 总欠款：当前数据模型仅"普通未还"，分期/贷款暂未接入（§3.2）
  const plainOwed = totalPending

  return {
    totalPending,
    overdueAmount,
    overdueBills,
    futureAmount,
    plainOwed,
    unpaidCount: unpaid.length,
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
      // 并行：持卡人 / 账单；卡片依赖持卡人 id，随后用 in 查询
      const [holdersRes, allBills] = await Promise.all([
        clientDb
          .from('card_holders')
          .select('*')
          .eq('created_by', user.id)
          .order('created_at', { ascending: true }),
        getBillDashboardItems(200, user.id),
      ])
      if (holdersRes.error) throw holdersRes.error
      const holderList = (holdersRes.data as unknown as CardHolder[]) || []
      const holderIds = holderList.map(h => h.id)
      // PostgREST 风格的 card_holders!inner 在 SQLite 不可用，改为两段查询
      const cardsRes = holderIds.length > 0
        ? await clientDb.from('credit_cards').select('id, holder_id').in('holder_id', holderIds)
        : { data: [] as Array<{ id: string; holder_id: string }>, error: null }
      if (cardsRes.error) throw cardsRes.error

      setHolders(holderList)
      setCards((cardsRes.data || []).map((c: any) => ({ id: c.id, holder_id: c.holder_id })))
      setBills(allBills)
    } catch (err: any) {
      console.error('Dashboard load failed:', err)
      setError(err?.message || '加载失败，请下拉重试')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handlePaySingle = async (e: React.MouseEvent, bill: BillDashboardItem) => {
    e.stopPropagation()
    try {
      const amount = bill.remaining_amount > 0 ? bill.remaining_amount : Number(bill.bill_amount)
      await markBillAsPaid(bill.id, amount)
      setToast({
        open: true,
        message: `🎉 已成功结清 ${bill.card?.card_product?.bank_name || ''} 账单（¥${amount.toLocaleString()}）！`,
        severity: 'success'
      })
      loadData()
    } catch (err: any) {
      setToast({ open: true, message: '还款失败: ' + err.message, severity: 'error' })
    }
  }

  const handlePayAllOverdue = async () => {
    if (!user?.id) return
    setPaying(true)
    try {
      const res = await markAllOverdueBillsAsPaid(user.id, metrics.overdueBills)
      setPayAllOpen(false)
      setToast({
        open: true,
        message: `🎉 恭喜！已一键全额结清 ${res.count} 笔逾期账单（合计 ¥${res.totalAmount.toLocaleString()}）！`,
        severity: 'success'
      })
      await loadData()
    } catch (err: any) {
      setToast({ open: true, message: '一键还款失败: ' + err.message, severity: 'error' })
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
    () => computeMetrics(visibleBills, futureRange),
    [visibleBills, futureRange]
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
            sx={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            概览
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--text-secondary)', mt: 0.25 }}>
            管控信用卡资产与还款日程
          </Typography>
        </Box>
        <Tooltip title={privacyOn ? '显示金额' : '隐匿金额'} placement="left">
          <IconButton
            onClick={togglePrivacyMode}
            aria-label={privacyOn ? '显示金额' : '隐匿金额'}
            size="small"
            sx={{
              bgcolor: 'var(--paper)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
              color: 'var(--navy-600)',
              '&:hover': { bgcolor: 'var(--paper)' },
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
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all var(--dur-fast) var(--ease-out)',
                bgcolor: active ? 'var(--navy-600)' : 'rgba(10,31,68,0.05)',
                color: active ? '#FFFFFF' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: active ? 'var(--navy-600)' : 'transparent',
                userSelect: 'none',
                '&:hover': active ? {} : { bgcolor: 'rgba(10,31,68,0.08)' },
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
          borderRadius: 'var(--radius-card)',
          background: 'linear-gradient(135deg, #0A1F44 0%, #1E3A8A 100%)',
          color: '#FFFFFF',
          boxShadow: 'var(--shadow-dark)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Typography sx={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, mb: 1 }}>
          总待还款
        </Typography>
        <Typography
          className={amountClass}
          sx={{
            color: '#FFFFFF',
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.1,
            mb: 2,
            letterSpacing: 0,
          }}
        >
          {formatCNY(metrics.totalPending)}
        </Typography>

        {/* 子指标：逾期 + 未来 N 天 */}
        <Stack direction="row" spacing={3}>
          <Box>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, mb: 0.25 }}>
              含逾期
            </Typography>
            <Typography
              className={amountClass}
              sx={{
                color: metrics.overdueAmount > 0 ? '#FF8A8A' : 'rgba(255,255,255,0.9)',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {formatCNY(metrics.overdueAmount)}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, mb: 0.25 }}>
              未来 {futureRange} 天
            </Typography>
            <Typography
              className={amountClass}
              sx={{ color: 'var(--warn)', fontSize: 14, fontWeight: 600 }}
            >
              {formatCNY(metrics.futureAmount)}
            </Typography>
          </Box>
        </Stack>
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
            borderRadius: 'var(--radius-card)',
            bgcolor: 'var(--paper)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            transition: 'box-shadow var(--dur-fast) var(--ease-out)',
            '&:hover': { boxShadow: 'var(--shadow-hover)' },
          }}
        >
          <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)', mb: 0.5 }}>
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
            {formatCNY(metrics.overdueAmount)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.5 }}>
            {metrics.overdueAmount > 0 ? `${metrics.overdueBills.length} 笔待处理` : '暂无逾期'}
          </Typography>
        </Paper>

        {/* 2. 未来 N 天待还（带 7/14/30 切换） */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 'var(--radius-card)',
            bgcolor: 'var(--paper)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 0.5,
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              未来待还
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.25 }}>
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
                      fontSize: 10.5,
                      fontWeight: 600,
                      borderRadius: 'var(--radius-pill)',
                      cursor: 'pointer',
                      bgcolor: active ? 'rgba(201,162,39,0.15)' : 'transparent',
                      color: active ? 'var(--gold-700)' : 'var(--text-disabled)',
                      transition: 'all var(--dur-fast) var(--ease-out)',
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
              color: 'var(--gold-500)',
              lineHeight: 1.2,
            }}
          >
            {formatCNY(metrics.futureAmount)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.5 }}>
            {futureRange} 天内到期合计
          </Typography>
        </Paper>

        {/* 3. 总欠款（可展开） */}
        <Paper
          elevation={0}
          onClick={() => setDebtExpanded(v => !v)}
          sx={{
            p: 2,
            borderRadius: 'var(--radius-card)',
            bgcolor: 'var(--paper)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            transition: 'all var(--dur-fast) var(--ease-out)',
            '&:hover': { boxShadow: 'var(--shadow-hover)' },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)' }}>总欠款</Typography>
            <ChevronDownIcon
              size={16}
              style={{
                transition: 'transform var(--dur-fast) var(--ease-out)',
                transform: debtExpanded ? 'rotate(180deg)' : 'none',
                color: 'var(--text-secondary)',
              }}
            />
          </Box>
          <Typography
            className={amountClass}
            sx={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
              mt: 0.5,
            }}
          >
            {formatCNY(metrics.plainOwed)}
          </Typography>

          {debtExpanded && (
            <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid var(--divider)' }}>
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    分期剩余本金
                  </Typography>
                  <Typography
                    className="num-tabular"
                    sx={{ fontSize: 11.5, color: 'var(--text-disabled)' }}
                  >
                    暂未接入
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    贷款剩余本息
                  </Typography>
                  <Typography
                    className="num-tabular"
                    sx={{ fontSize: 11.5, color: 'var(--text-disabled)' }}
                  >
                    暂未接入
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    普通未还
                  </Typography>
                  <Typography
                    className={amountClass}
                    sx={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}
                  >
                    {formatCNY(metrics.plainOwed)}
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
            borderRadius: 'var(--radius-card)',
            bgcolor: 'var(--paper)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)' }}>未出账单</Typography>
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
          <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.5 }}>
            邮件解析待接入
          </Typography>
        </Paper>
      </Box>

      {/* 账户数 chips */}
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', mb: 1 }}
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
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              bgcolor:
                holderFilter === 'all' ? 'rgba(10,31,68,0.08)' : 'rgba(10,31,68,0.03)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
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
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                bgcolor:
                  holderFilter === h.id ? 'rgba(10,31,68,0.08)' : 'rgba(10,31,68,0.03)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
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
              borderRadius: 'var(--radius-card)',
              cursor: 'pointer',
              color: 'var(--navy-600)',
              transition: 'background var(--dur-fast) var(--ease-out)',
              '&:hover': { bgcolor: 'rgba(10,31,68,0.04)' },
              '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: 2 },
              // 触控区域 ≥ 64pt（minHeight 64 + 内边距）
              minHeight: 76,
            }}
          >
            {a.icon}
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
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
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
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
                fontSize: 11.5,
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
                color: 'var(--navy-600)',
                fontSize: 12,
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
            borderRadius: 'var(--radius-card)',
            bgcolor: 'rgba(22,163,74,0.06)',
            border: '1px solid rgba(22,163,74,0.20)',
            textAlign: 'center',
          }}
        >
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>
            本月无逾期
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)', mt: 0.5 }}>
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
              const tail = bill.card?.card_number_last4
                ? `尾号 ${bill.card.card_number_last4}`
                : '未记录尾号'
              const overdueDays = Math.abs(bill.days_until_due)
              const remaining = bill.remaining_amount > 0 ? bill.remaining_amount : Number(bill.bill_amount)

              return (
                <Paper
                  key={bill.id}
                  elevation={0}
                  onClick={() => router.push('/bills')}
                  sx={{
                    p: 2,
                    borderRadius: 'var(--radius-card)',
                    bgcolor: 'var(--paper)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-card)',
                    cursor: 'pointer',
                    transition: 'box-shadow var(--dur-fast) var(--ease-out)',
                    '&:hover': { boxShadow: 'var(--shadow-hover)' },
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
                          fontSize: 14,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                        noWrap
                      >
                        {product?.bank_name || '未知银行'} {product?.card_name || ''}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
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
                        color: 'var(--danger)',
                        fontSize: 11,
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
                      borderTop: '1px dashed #f1f5f9'
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)' }}>待还金额</Typography>
                      <Typography
                        className={amountClass}
                        sx={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: 'var(--danger)',
                        }}
                      >
                        {formatCNY(remaining)}
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
                        fontSize: 11.5,
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
        <DialogTitle sx={{ fontWeight: 800 }}>确认一键完成全部还款？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            系统将把当前 <strong>{metrics.overdueBills.length} 笔</strong>逾期账单全部标记为已结清。
          </Typography>
          <Typography variant="subtitle1" fontWeight={800} color="error.main">
            合计结清金额：{formatCNY(metrics.overdueAmount)}
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
            sx={{ fontWeight: 700, borderRadius: 2 }}
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
        <Alert severity={toast.severity} sx={{ borderRadius: 3, fontWeight: 600 }}>
          {toast.message}
        </Alert>
      </Snackbar>

      {error && (
        <Box sx={{ mt: 3 }}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 'var(--radius-card)',
              bgcolor: 'rgba(207,46,46,0.06)',
              border: '1px solid rgba(207,46,46,0.20)',
              textAlign: 'center',
            }}
          >
            <Typography sx={{ fontSize: 13, color: 'var(--danger)', mb: 1 }}>{error}</Typography>
            <Box
              onClick={loadData}
              sx={{
                display: 'inline-block',
                px: 2,
                py: 0.5,
                borderRadius: 'var(--radius-pill)',
                bgcolor: 'var(--danger)',
                color: '#FFFFFF',
                fontSize: 12,
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
