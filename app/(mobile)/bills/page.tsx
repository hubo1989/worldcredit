'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Container, Typography, Box, Stack, IconButton,
  Fab, Snackbar, Alert, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, Collapse, Divider, Paper,
} from '@mui/material'
import {
  Add as AddIcon,
  CheckCircleOutline as CheckIcon,
  WarningAmber as WarningIcon,
  KeyboardArrowDown as ArrowDownIcon,
  KeyboardArrowUp as ArrowUpIcon,
  CreditCard as CardIcon,
  History as HistoryIcon,
} from '@mui/icons-material'
import {
  getCardsWithBillsSummary,
  createPayment,
  updateBillStatus,
  markAllOverdueBillsAsPaid,
  type CardWithBillsSummary,
  type BillDashboardItem,
} from '@/lib/api/bills'
import { syncGmailLedgerToCardsAndBills } from '@/lib/api/sync-gmail'
import { getHolders } from '@/lib/api/holders'
import { clientDb } from '@/lib/client-db'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { BillForm } from '@/components/mobile/BillForm'
import { format } from 'date-fns'
import { WcSkeleton, WcEmptyState, WcErrorState } from '@/components/mobile/WcStates'
import {
  SyncIcon, BankIcon, UserIcon,
} from '@/components/icons/WcIcon'
import { useAuth } from '@/lib/auth'

type Dimension = 'holder' | 'bank'
type SortMode = 'grace' | 'due'
type ViewFilter = 'all' | 'unpaid' | 'cleared'

// 通用分段 / 标签 / 排序 pill
function Pill({
  selected, onClick, children, sx,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  sx?: object
}) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        border: '1px solid',
        borderColor: selected ? 'var(--navy-800)' : 'var(--border)',
        bgcolor: selected ? 'var(--navy-800)' : 'transparent',
        color: selected ? '#fff' : 'var(--navy-800)',
        borderRadius: 'var(--radius-pill)',
        px: 1.75,
        py: 0.5,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.4,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 150ms ease',
        '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: 1 },
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

// 单张信用卡聚合卡片（归并该卡下的所有账单 + 免息期计算）
function CardSummaryRow({
  item,
  holderName,
  onOpenPayment,
}: {
  item: CardWithBillsSummary
  holderName?: string
  onOpenPayment: (bill: BillDashboardItem) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const product = item.card.card_product
  const bankName = product?.bank_name || '银行卡'
  const cardName = product?.card_name || '信用卡'
  const tail = item.card.card_number_last4 ? ` (${item.card.card_number_last4})` : ''

  const isCleared = item.status === 'unissued' || item.unpaidAmount <= 0
  const isOverdue = item.status === 'overdue'

  // 状态徽章渲染
  let badgeBg = 'rgba(22, 163, 74, 0.12)'
  let badgeColor = 'var(--success)'
  let badgeText = '未出账单'

  if (isOverdue) {
    badgeBg = 'rgba(207, 46, 46, 0.12)'
    badgeColor = 'var(--danger)'
    badgeText = '逾期'
  } else if (item.status === 'partial') {
    badgeBg = 'rgba(217, 119, 6, 0.12)'
    badgeColor = 'var(--warning, #d97706)'
    badgeText = '部分还款'
  } else if (item.status === 'unpaid') {
    badgeBg = 'rgba(234, 88, 12, 0.12)'
    badgeColor = '#ea580c'
    badgeText = '待还款'
  } else {
    badgeBg = 'rgba(22, 163, 74, 0.12)'
    badgeColor = 'var(--success)'
    badgeText = item.historyBills.length > 0 ? '本期已结清' : '未出账单'
  }

  return (
    <Box
      sx={{
        bgcolor: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        p: 2,
        transition: 'box-shadow 200ms ease',
        '&:hover': { boxShadow: 'var(--shadow-hover)' },
      }}
    >
      {/* 头部：卡名 + 银行/持卡人标签 + 状态 */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.25 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-800)', lineHeight: 1.3 }} noWrap>
            {bankName} {cardName}{tail}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
            <Box
              component="span"
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.35,
                fontSize: 11, fontWeight: 600, color: 'var(--navy-600)',
                bgcolor: 'rgba(30,58,138,0.08)', borderRadius: 'var(--radius-pill)', px: 0.85, py: 0.2,
              }}
            >
              <BankIcon size={11} />
              {bankName}
            </Box>
            {holderName && (
              <Box
                component="span"
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.35,
                  fontSize: 11, fontWeight: 600, color: 'var(--navy-600)',
                  bgcolor: 'rgba(122,173,255,0.14)', borderRadius: 'var(--radius-pill)', px: 0.85, py: 0.2,
                }}
              >
                <UserIcon size={11} />
                {holderName}
              </Box>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            flexShrink: 0,
            px: 1.25,
            py: 0.35,
            borderRadius: 'var(--radius-pill)',
            bgcolor: badgeBg,
            color: badgeColor,
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          {badgeText}
        </Box>
      </Stack>

      {/* 金额与主要操作 */}
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Box>
          <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            {isCleared ? '本期待还' : '当前待还金额'}
          </Typography>
          <Typography
            className="num-tabular"
            sx={{
              fontSize: 20,
              fontWeight: 800,
              color: isCleared ? 'var(--success)' : 'var(--danger)',
              lineHeight: 1.2,
              mt: 0.25,
            }}
          >
            ¥{item.unpaidAmount.toLocaleString()}
          </Typography>
        </Box>

        {!isCleared && item.activeBill && (
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={() => onOpenPayment(item.activeBill!)}
            sx={{
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 700,
              py: 0.4,
              px: 1.75,
              textTransform: 'none',
            }}
          >
            登记还款
          </Button>
        )}
      </Stack>

      {/* 周期与免息期计算（正向计算今日刷卡免息天数） */}
      <Box
        sx={{
          bgcolor: isCleared ? 'rgba(234, 179, 8, 0.08)' : '#f8fafc',
          p: 1.25,
          borderRadius: 2,
          border: '1px solid',
          borderColor: isCleared ? 'rgba(234, 179, 8, 0.25)' : 'var(--border)',
          fontSize: 12,
          color: 'var(--navy-800)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <span>账单日 每月 <strong>{item.billingDay}</strong> 日</span>
          <span style={{ margin: '0 6px', color: '#cbd5e1' }}>·</span>
          <span>
            {isCleared
              ? `下期还款约 ${format(item.nextDueDate, 'MM-dd')}`
              : `本期还款日 ${item.activeBill?.due_date ? format(new Date(item.activeBill.due_date), 'MM-dd') : '—'}`}
          </span>
        </Box>
        <Box sx={{ color: 'var(--gold-700, #b45309)', fontWeight: 800 }}>
          {isCleared ? `✨ 今日刷卡免息 ${item.graceDays} 天` : `待结清`}
        </Box>
      </Box>

      {/* 折叠展开历史账单明细 */}
      {item.historyBills.length > 0 && (
        <Box sx={{ mt: 1.25, pt: 1, borderTop: '1px dashed var(--border)' }}>
          <Box
            onClick={() => setHistoryOpen(!historyOpen)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              color: 'var(--navy-600)',
              fontSize: 12,
              fontWeight: 600,
              py: 0.25,
            }}
          >
            <Stack direction="row" spacing={0.5} alignItems="center">
              <HistoryIcon fontSize="inherit" />
              <span>历史账单明细 ({item.historyBills.length} 期)</span>
            </Stack>
            {historyOpen ? <ArrowUpIcon fontSize="small" /> : <ArrowDownIcon fontSize="small" />}
          </Box>

          <Collapse in={historyOpen}>
            <Stack spacing={1} sx={{ mt: 1, pt: 0.5 }}>
              {item.historyBills.map(b => {
                const bPaid = b.computed_status === 'paid'
                const bMonth = b.bill_month || (b.due_date ? b.due_date.slice(0, 7) : '账单')
                return (
                  <Box
                    key={b.id}
                    onClick={() => !bPaid && onOpenPayment(b)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1,
                      px: 1.25,
                      borderRadius: 1.5,
                      bgcolor: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      fontSize: 12,
                      cursor: bPaid ? 'default' : 'pointer',
                      '&:hover': !bPaid ? { bgcolor: '#f1f5f9' } : {},
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy-800)' }}>
                        {bMonth} 期账单
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        到期日: {b.due_date ? format(new Date(b.due_date), 'yyyy-MM-dd') : '—'}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontSize: 13, fontWeight: 700 }} className="num-tabular">
                        ¥{Number(b.bill_amount).toLocaleString()}
                      </Typography>
                      <Box
                        sx={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          px: 0.75,
                          py: 0.15,
                          borderRadius: 'var(--radius-pill)',
                          bgcolor: bPaid ? 'rgba(22, 163, 74, 0.10)' : 'rgba(207, 46, 46, 0.10)',
                          color: bPaid ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        {bPaid ? '已结清' : '未结清'}
                      </Box>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}

export default function BillsPage() {
  const { user } = useAuth()
  const [cardsSummary, setCardsSummary] = useState<CardWithBillsSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<BillDashboardItem | null>(null)
  const [billFormOpen, setBillFormOpen] = useState(false)

  const [celebrationNotice, setCelebrationNotice] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })

  // 维度 / 标签 / 排序 / 状态过滤
  const [dimension, setDimension] = useState<Dimension>('holder')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('grace')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [payAllOpen, setPayAllOpen] = useState(false)
  const [paying, setPaying] = useState(false)

  // 持卡人 id → name 映射
  const [holderMap, setHolderMap] = useState<Record<string, string>>({})

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      setLoadError(null)
      const [summaryData, holders] = await Promise.all([
        getCardsWithBillsSummary(user.id),
        getHolders(user.id),
      ])
      setCardsSummary(summaryData)
      const map: Record<string, string> = {}
      for (const h of holders) map[h.id] = h.name
      setHolderMap(map)
    } catch (err: any) {
      console.error(err)
      setLoadError(err?.message || '加载账单与卡片失败')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 同步邮件账单
  const handleSync = async () => {
    if (!user) return
    setSyncing(true)
    try {
      const { syncedCardsCount, syncedBillsCount } = await syncGmailLedgerToCardsAndBills(user.id)
      await loadData()
      if (syncedCardsCount > 0 || syncedBillsCount > 0) {
        setCelebrationNotice({
          open: true,
          message: `邮件账单已归集同步：新增 ${syncedCardsCount} 张卡，更新 ${syncedBillsCount} 笔账单。`,
        })
      } else {
        setCelebrationNotice({ open: true, message: '所有邮件账单与卡包已是最新状态。' })
      }
    } catch (err: any) {
      setLoadError('同步失败：' + (err?.message || '未知错误'))
    } finally {
      setSyncing(false)
    }
  }

  // 维度切换时重置标签为「全部」
  useEffect(() => {
    setSelectedTag('all')
  }, [dimension])

  const handlePayment = async (data: { amount: number; paid_at: string; note?: string }) => {
    if (!selectedBill) return
    try {
      await createPayment({
        bill_id: selectedBill.id,
        amount: data.amount,
        paid_at: data.paid_at,
        channel: '手动还款',
        note: data.note,
      })

      const { data: allPayments } = await clientDb
        .from('payments')
        .select('amount')
        .eq('bill_id', selectedBill.id)

      const totalPaid = (allPayments || []).reduce(
        (sum, p) => sum + Number(p.amount), 0
      )
      const billAmount = Number(selectedBill.bill_amount)

      let isFullPaid = false
      if (totalPaid >= billAmount) {
        await updateBillStatus(selectedBill.id, 'paid')
        isFullPaid = true
      } else if (totalPaid > 0) {
        await updateBillStatus(selectedBill.id, 'partial')
      }

      await loadData()
      setCelebrationNotice({
        open: true,
        message: isFullPaid
          ? '恭喜！本期账单已全额结清，当前卡片已转为未出账单。'
          : '登记还款成功，已更新账单结余。',
      })
    } catch (err: any) {
      alert('登记还款失败: ' + err.message)
    }
  }

  // 所有逾期账单列表
  const allOverdueBills = useMemo(() => {
    const list: BillDashboardItem[] = []
    for (const card of cardsSummary) {
      for (const bill of card.historyBills) {
        if (bill.computed_status === 'overdue' || (bill.days_until_due < 0 && bill.computed_status !== 'paid')) {
          list.push(bill)
        }
      }
    }
    return list
  }, [cardsSummary])

  const totalOverdueAmount = useMemo(() => {
    return allOverdueBills.reduce((sum, b) => sum + (b.remaining_amount > 0 ? b.remaining_amount : Number(b.bill_amount || 0)), 0)
  }, [allOverdueBills])

  const handlePayAllOverdue = async () => {
    if (!user?.id) return
    setPaying(true)
    try {
      const res = await markAllOverdueBillsAsPaid(user.id, allOverdueBills)
      setPayAllOpen(false)
      setCelebrationNotice({
        open: true,
        message: `🎉 恭喜！已一键全额结清 ${res.count} 笔逾期账单（合计 ¥${res.totalAmount.toLocaleString()}）！`,
      })
      await loadData()
    } catch (err: any) {
      alert('一键还款失败: ' + err.message)
    } finally {
      setPaying(false)
    }
  }

  // 持卡人维度可选标签
  const holderTags = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const item of cardsSummary) {
      const hid = item.holder_id
      if (hid && !seen.has(hid)) {
        seen.add(hid)
        ids.push(hid)
      }
    }
    return ids.map(id => ({ id, name: holderMap[id] || '未知持卡人' }))
  }, [cardsSummary, holderMap])

  // 银行维度可选标签
  const bankTags = useMemo(() => {
    const names: string[] = []
    const seen = new Set<string>()
    for (const item of cardsSummary) {
      const n = item.card.card_product?.bank_name
      if (n && !seen.has(n)) {
        seen.add(n)
        names.push(n)
      }
    }
    return names
  }, [cardsSummary])

  // 过滤卡片列表
  const filteredCards = useMemo(() => {
    return cardsSummary.filter(item => {
      // 状态筛选
      if (viewFilter === 'unpaid' && (item.status === 'unissued' || item.unpaidAmount <= 0)) return false
      if (viewFilter === 'cleared' && item.unpaidAmount > 0) return false

      // 标签筛选
      if (selectedTag !== 'all') {
        if (dimension === 'holder' && item.holder_id !== selectedTag) return false
        if (dimension === 'bank' && item.card.card_product?.bank_name !== selectedTag) return false
      }
      return true
    })
  }, [cardsSummary, viewFilter, selectedTag, dimension])

  // 排序：免息期最长（优先推荐用卡） / 还款日近→远（优先待还）
  const sortedCards = useMemo(() => {
    const arr = [...filteredCards]
    if (sortMode === 'grace') {
      arr.sort((a, b) => b.graceDays - a.graceDays)
    } else {
      arr.sort((a, b) => {
        const ao = a.status === 'overdue' ? 0 : a.status === 'unpaid' ? 1 : 2
        const bo = b.status === 'overdue' ? 0 : b.status === 'unpaid' ? 1 : 2
        if (ao !== bo) return ao - bo
        return a.nextDueDate.getTime() - b.nextDueDate.getTime()
      })
    }
    return arr
  }, [filteredCards, sortMode])

  // 按银行分组（保持 sortedCards 顺序）
  const bankGroups = useMemo(() => {
    if (dimension !== 'bank') return []
    const groups: { bankName: string; cards: CardWithBillsSummary[] }[] = []
    const idx = new Map<string, number>()
    for (const item of sortedCards) {
      const bankName = item.card.card_product?.bank_name || '未知银行'
      if (!idx.has(bankName)) {
        idx.set(bankName, groups.length)
        groups.push({ bankName, cards: [] })
      }
      groups[idx.get(bankName)!].cards.push(item)
    }
    return groups
  }, [sortedCards, dimension])

  const openPaymentForBill = (bill: BillDashboardItem) => {
    setSelectedBill(bill)
    setPaymentOpen(true)
  }

  const unpaidCount = useMemo(() => cardsSummary.filter(c => c.unpaidAmount > 0).length, [cardsSummary])
  const clearedCount = useMemo(() => cardsSummary.filter(c => c.unpaidAmount <= 0).length, [cardsSummary])

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      {/* 顶部标题与同步按钮 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={800}>
          卡片与账单
        </Typography>
        <IconButton
          id="sync-bills-btn"
          color="primary"
          onClick={handleSync}
          disabled={syncing}
          sx={{ bgcolor: 'primary.light', opacity: 0.9 }}
        >
          <SyncIcon size={22} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </IconButton>
      </Box>

      {/* 顶部逾期警示横幅 */}
      {allOverdueBills.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 'var(--radius-card)',
            bgcolor: 'rgba(207,46,46,0.08)',
            border: '1px solid rgba(207,46,46,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <WarningIcon sx={{ color: 'var(--danger)', fontSize: 20, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }} noWrap>
                存在 {allOverdueBills.length} 笔历史逾期账单未结清
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
                待还合计：¥{totalOverdueAmount.toLocaleString()}
              </Typography>
            </Box>
          </Stack>
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={() => setPayAllOpen(true)}
            sx={{ fontSize: 11, fontWeight: 700, py: 0.25, px: 1.25, borderRadius: 'var(--radius-pill)', textTransform: 'none', boxShadow: 'none', flexShrink: 0 }}
          >
            一键还清
          </Button>
        </Paper>
      )}

      {/* 卡片状态筛选 Pills（全部 / 待还款 / 未出账单） */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, overflowX: 'auto', pb: 0.5 }}>
        <Pill selected={viewFilter === 'all'} onClick={() => setViewFilter('all')}>
          全部卡片 ({cardsSummary.length})
        </Pill>
        <Pill
          selected={viewFilter === 'unpaid'}
          onClick={() => setViewFilter('unpaid')}
          sx={unpaidCount > 0 && viewFilter !== 'unpaid' ? { borderColor: 'rgba(234,88,12,0.5)', color: '#ea580c' } : {}}
        >
          待还款卡片 ({unpaidCount})
        </Pill>
        <Pill selected={viewFilter === 'cleared'} onClick={() => setViewFilter('cleared')}>
          未出账单/已结清 ({clearedCount})
        </Pill>
      </Stack>

      {/* 维度切换（持卡人 / 银行） */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Pill selected={dimension === 'holder'} onClick={() => setDimension('holder')}>按持卡人</Pill>
        <Pill selected={dimension === 'bank'} onClick={() => setDimension('bank')}>按银行</Pill>
      </Stack>

      {/* 标签行：全部 + 维度对应标签 */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto', pb: 0.5 }}>
        <Pill selected={selectedTag === 'all'} onClick={() => setSelectedTag('all')}>
          {dimension === 'holder' ? '全部持卡人' : '全部银行'}
        </Pill>
        {dimension === 'holder'
          ? holderTags.map(t => (
              <Pill key={t.id} selected={selectedTag === t.id} onClick={() => setSelectedTag(t.id)}>
                {t.name}
              </Pill>
            ))
          : bankTags.map(name => (
              <Pill key={name} selected={selectedTag === name} onClick={() => setSelectedTag(name)}>
                {name}
              </Pill>
            ))}
      </Stack>

      {/* 排序方式（免息期最长优先 / 还款日近优先） */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Pill selected={sortMode === 'grace'} onClick={() => setSortMode('grace')}>
          ✨ 免息期最长 (刷卡推荐)
        </Pill>
        <Pill selected={sortMode === 'due'} onClick={() => setSortMode('due')}>
          📅 还款日近→远
        </Pill>
      </Stack>

      {loadError && (
        <Box sx={{ mb: 2 }}>
          <WcErrorState message={loadError} onRetry={() => loadData()} />
        </Box>
      )}

      {loading ? (
        <WcSkeleton height={140} count={3} />
      ) : sortedCards.length === 0 ? (
        <WcEmptyState
          title="没有找到卡片记录"
          description="可以手动录入卡片或导入邮箱账单"
          actionLabel="立即同步"
          onAction={handleSync}
        />
      ) : dimension === 'holder' ? (
        <Stack spacing={1.5}>
          {sortedCards.map(item => (
            <CardSummaryRow
              key={item.card.id}
              item={item}
              holderName={holderMap[item.holder_id]}
              onOpenPayment={openPaymentForBill}
            />
          ))}
        </Stack>
      ) : (
        <Stack spacing={2}>
          {bankGroups.map(group => {
            const unpaidTotal = group.cards.reduce((s, c) => s + c.unpaidAmount, 0)
            return (
              <Box key={group.bankName}>
                {/* 组头：银行 · 卡片数 · 待还合计 */}
                <Box
                  sx={{
                    bgcolor: 'var(--navy-800)',
                    color: '#fff',
                    borderRadius: 'var(--radius-card)',
                    px: 1.75,
                    py: 1,
                    mb: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <BankIcon size={16} />
                  <Typography sx={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>
                    {group.bankName} · {group.cards.length} 张卡
                  </Typography>
                  <Typography className="num-tabular" sx={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                    待还 ¥{unpaidTotal.toLocaleString()}
                  </Typography>
                </Box>
                <Stack spacing={1.5}>
                  {group.cards.map(item => (
                    <CardSummaryRow
                      key={item.card.id}
                      item={item}
                      holderName={holderMap[item.holder_id]}
                      onOpenPayment={openPaymentForBill}
                    />
                  ))}
                </Stack>
              </Box>
            )
          })}
        </Stack>
      )}

      {selectedBill && (
        <PaymentForm
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          onSubmit={handlePayment}
          totalAmount={Number(selectedBill.bill_amount)}
          billMonth={format(new Date(selectedBill.statement_end || selectedBill.due_date), 'MM月')}
          billId={selectedBill.id}
          onAttachmentChanged={loadData}
        />
      )}

      {/* 录入账单 FAB */}
      <Fab
        color="primary"
        aria-label="录入账单"
        onClick={() => setBillFormOpen(true)}
        sx={{ position: 'fixed', bottom: 80, right: 20, zIndex: 10 }}
      >
        <AddIcon />
      </Fab>

      <BillForm
        open={billFormOpen}
        onClose={() => setBillFormOpen(false)}
        onSuccess={loadData}
      />

      {/* 一键全部结清弹窗 */}
      <Dialog open={payAllOpen} onClose={() => !paying && setPayAllOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>确认一键完成全部还款？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            系统将把当前 <strong>{allOverdueBills.length} 笔</strong>逾期账单全部标记为已结清。
          </Typography>
          <Typography variant="subtitle1" fontWeight={800} color="error.main">
            合计结清金额：¥{totalOverdueAmount.toLocaleString()}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setPayAllOpen(false)} disabled={paying}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handlePayAllOverdue}
            disabled={paying}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            确认全部结清
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={celebrationNotice.open}
        autoHideDuration={4000}
        onClose={() => setCelebrationNotice(prev => ({ ...prev, open: false }))}
      >
        <Alert
          severity="success"
          icon={<CheckIcon fontSize="small" />}
          onClose={() => setCelebrationNotice(prev => ({ ...prev, open: false }))}
        >
          {celebrationNotice.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
