'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Card, CardContent, Chip, IconButton,
  Button, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, LinearProgress, Tabs, Tab, Stack, Divider,
  Alert, Snackbar, List, ListItem, ListItemText,
  alpha, Checkbox, FormControlLabel
} from '@mui/material'
import PaidIcon from '@mui/icons-material/CheckCircle'
import UnpaidIcon from '@mui/icons-material/Pending'
import PartialIcon from '@mui/icons-material/Warning'
import PayIcon from '@mui/icons-material/Payment'
import FilterIcon from '@mui/icons-material/FilterList'
import RefreshIcon from '@mui/icons-material/Refresh'
import CloseIcon from '@mui/icons-material/Close'
import LedgerIcon from '@mui/icons-material/Receipt'
import DateIcon from '@mui/icons-material/CalendarMonth'
import AmountIcon from '@mui/icons-material/Payments'
import ReceiptIcon from '@mui/icons-material/ReceiptLong'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import { getGmailLedgerEntries, getGmailLedgerSummary, markPayment, updateLedgerAmount, getGmailLedgerBanks } from '@/lib/api/gmail-ledger'
import type { GmailLedgerEntry } from '@/lib/api/gmail-ledger'
import { formatCardTail } from '@/lib/utils'

// ─── Bank Logo ─────────────────────────────────────────
// 所有 logo 已缓存在 /public/banks/，无需每次请求外部服务
const BANK_LOGO: Record<string, string> = {
  '中国民生银行': '/banks/中国民生银行.png',
  '中国民生银行/CMBC': '/banks/中国民生银行.png',
  '中国建设银行': '/banks/中国建设银行.png',
  '中国建设银行/CCB': '/banks/中国建设银行.png',
  '中国邮政储蓄银行': '/banks/中国邮政储蓄银行.png',
  '中国农业银行': '/banks/中国农业银行.png',
  '招商银行': '/banks/招商银行.png',
  '中信银行': '/banks/中信银行.png',
  '中信银行/CITIC': '/banks/中信银行.png',
  '上海银行': '/banks/上海银行.png',
  '上海银行/BOSC': '/banks/上海银行.png',
  '北京银行': '/banks/北京银行.png',
  '民泰银行': '/banks/民泰银行.png',
  '浙商银行': '/banks/浙商银行.png',
  '浙江民泰商业银行': '/banks/民泰银行.png',
  '中国银行': '/banks/中国银行.png',
  '中国银行上海分行': '/banks/中国银行.png',
  '广发银行': '/banks/广发银行.png',
  'Capital One': '/banks/Capital-One.png',
  'Chase': '/banks/Chase.png',
  'HSBC': '/banks/HSBC.png',
  'HSBC/汇丰': '/banks/HSBC.png',
  'BEA': '/banks/BEA.png',
  'CNCBI': '/banks/CNCBI.png',
  '中银香港': '/banks/HSBC.png',
  'BOA': '/banks/BOA.png',
  'Amex': '/banks/Amex.png',
  'Discover': '/banks/Discover.png',
}

function BankLogo({ bank, size = 24 }: { bank: string; size?: number }) {
  const src = BANK_LOGO[bank] || '/banks/Chase.png' // fallback
  return (
    <img
      src={src}
      alt={bank.split('/')[0]}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ borderRadius: size * 0.25, flexShrink: 0, objectFit: 'cover' }}
    />
  )
}

type TabValue = 'all' | 'unpaid' | 'partial' | 'paid' | 'needsAmount'

export default function GmailLedgerPage() {
  const [entries, setEntries] = useState<GmailLedgerEntry[]>([])
  // 邮件正文里没有金额的条目（多为"账单已就绪/AutoPay 提醒"），单独放，供人工补录。
  const [pendingEntries, setPendingEntries] = useState<GmailLedgerEntry[]>([])
  const [summary, setSummary] = useState({ total: 0, unpaid: 0, partial: 0, paid: 0, totalAmount: 0, unpaidAmount: 0, needsAmount: 0 })
  const [tab, setTab] = useState<TabValue>('unpaid')
  const [loading, setLoading] = useState(true)
  const [selectedEntry, setSelectedEntry] = useState<GmailLedgerEntry | null>(null)
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'warning' | 'info' }>({ open: false, message: '', severity: 'success' })
  const [banks, setBanks] = useState<string[]>([])
  const [bankFilter, setBankFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [payForm, setPayForm] = useState({ amount: '', note: '' })
  // 补录金额弹窗
  const [amountDialogOpen, setAmountDialogOpen] = useState(false)
  const [amountSaving, setAmountSaving] = useState(false)
  const [amountForm, setAmountForm] = useState({ amount: '', minimum: '', dueDate: '' })

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [entriesData, pendingData, summaryData, banksData] = await Promise.all([
        getGmailLedgerEntries(),
        getGmailLedgerEntries({ needsAmount: true }),
        getGmailLedgerSummary(),
        getGmailLedgerBanks(),
      ])
      setEntries(entriesData)
      setPendingEntries(pendingData)
      setSummary(summaryData)
      // 银行筛选项要覆盖待补条目，否则它们的所属银行在下拉里会缺失。
      setBanks(Array.from(new Set([...banksData, ...pendingData.map(e => e.bank)])).sort())
    } catch (e) {
      setSnack({ open: true, message: `加载失败: ${e instanceof Error ? e.message : String(e)}`, severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // "待补金额" 走单独的集合；其余标签页只看有金额的条目。
  const activeEntries = tab === 'needsAmount' ? pendingEntries : entries

  const filtered = activeEntries.filter(e => {
    if (tab === 'needsAmount') return true
    if (tab === 'all') return true
    if (tab === 'unpaid') return e.payment_status === '未还款'
    if (tab === 'partial') return e.payment_status === '部分还款'
    if (tab === 'paid') return e.payment_status === '已还清'
    return true
  }).filter(e => bankFilter ? e.bank.includes(bankFilter) : true)

  const openAmountDialog = (entry: GmailLedgerEntry) => {
    setSelectedEntry(entry)
    setAmountForm({ amount: '', minimum: '', dueDate: entry.due_date || '' })
    setAmountDialogOpen(true)
  }

  const handleSaveAmount = async () => {
    if (!selectedEntry) return
    const amount = parseFloat(amountForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setSnack({ open: true, message: '请输入大于 0 的金额', severity: 'warning' })
      return
    }
    setAmountSaving(true)
    try {
      await updateLedgerAmount(selectedEntry.ledger_id, {
        statement_amount: amount,
        minimum_payment: amountForm.minimum ? parseFloat(amountForm.minimum) : null,
        due_date: amountForm.dueDate || null,
      })
      setSnack({ open: true, message: '金额已补录', severity: 'success' })
      setAmountDialogOpen(false)
      setSelectedEntry(null)
      fetchData()
    } catch (e) {
      setSnack({ open: true, message: '补录失败: ' + (e instanceof Error ? e.message : String(e)), severity: 'error' })
    } finally {
      setAmountSaving(false)
    }
  }

  const handleMarkPaid = async () => {
    if (!selectedEntry) return
    const amount = parseFloat(payForm.amount) || 0
    const newPaid = Number(selectedEntry.paid_amount || 0) + amount
    const total = Number(selectedEntry.statement_amount || 0)
    const remaining = Math.max(0, total - newPaid)

    try {
      await markPayment(selectedEntry.ledger_id, {
        paid_amount: newPaid,
        remaining_amount: remaining,
        completed: remaining <= 0,
        payment_status: remaining <= 0 ? '已还清' : (amount < total ? '部分还款' : '已还清'),
        payment_note: payForm.note || undefined,
        payment_date: new Date().toISOString().split('T')[0],
      })
      setSnack({ open: true, message: '还款标记成功', severity: 'success' })
      setPayDialogOpen(false)
      setSelectedEntry(null)
      setPayForm({ amount: '', note: '' })
      fetchData()
    } catch (e) {
      setSnack({ open: true, message: `操作失败: ${e instanceof Error ? e.message : String(e)}`, severity: 'error' })
    }
  }

  const handleQuickMarkAll = async (entry: GmailLedgerEntry, status: '部分还款' | '已还清') => {
    try {
      await markPayment(entry.ledger_id, {
        paid_amount: status === '已还清' ? Number(entry.statement_amount || 0) : Math.ceil(Number(entry.statement_amount || 0) * 0.3),
        remaining_amount: status === '已还清' ? 0 : Math.ceil(Number(entry.statement_amount || 0) * 0.7),
        completed: status === '已还清',
        payment_status: status,
        payment_date: new Date().toISOString().split('T')[0],
      })
      setSnack({ open: true, message: `${entry.bank} 已标记为${status}`, severity: 'success' })
      fetchData()
    } catch (e) {
      setSnack({ open: true, message: `操作失败: ${e instanceof Error ? e.message : String(e)}`, severity: 'error' })
    }
  }

  // ─── Batch selection ───
  const selectableEntries = filtered.filter(e => !e.completed)
  const allSelected = selectableEntries.length > 0 && selectableEntries.every(e => selectedIds.has(e.ledger_id))
  const someSelected = selectedIds.size > 0 && !allSelected

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableEntries.map(e => e.ledger_id)))
    }
  }

  const toggleSelect = (ledgerId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(ledgerId)) next.delete(ledgerId)
      else next.add(ledgerId)
      return next
    })
  }

  const handleBatchMarkPaid = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading(true)
    let ok = 0, fail = 0
    for (const ledgerId of selectedIds) {
      const entry = entries.find(e => e.ledger_id === ledgerId)
      if (!entry) continue
      try {
        await markPayment(ledgerId, {
          paid_amount: Number(entry.statement_amount || 0),
          remaining_amount: 0,
          completed: true,
          payment_status: '已还清',
          payment_date: new Date().toISOString().split('T')[0],
        })
        ok++
      } catch { fail++ }
    }
    setBatchLoading(false)
    setSelectedIds(new Set())
    setSnack({ open: true, message: `批量标记完成: ${ok} 成功${fail > 0 ? `, ${fail} 失败` : ''}`, severity: fail > 0 ? 'warning' : 'success' })
    fetchData()
  }

  const statusChip = (status: GmailLedgerEntry['payment_status']) => {
    const map = {
      '未还款': { color: 'error' as const, icon: <UnpaidIcon sx={{ fontSize: 16 }} /> },
      '部分还款': { color: 'warning' as const, icon: <PartialIcon sx={{ fontSize: 16 }} /> },
      '已还清': { color: 'success' as const, icon: <PaidIcon sx={{ fontSize: 16 }} /> },
    }
    const s = map[status] || map['未还款']
    return <Chip label={status} color={s.color} size="small" icon={s.icon} variant="outlined" />
  }

  const isOverdue = (dueDate: string | null) => {
    if (!dueDate) return false
    const due = new Date(dueDate)
    const today = new Date()
    return due.getFullYear() < today.getFullYear() || (due.getFullYear() === today.getFullYear() && (due.getMonth() < today.getMonth() || (due.getMonth() === today.getMonth() && due.getDate() < today.getDate())))
  }

  const isDueToday = (dueDate: string | null) => {
    if (!dueDate) return false
    const due = new Date(dueDate)
    const today = new Date()
    return due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() && due.getDate() === today.getDate()
  }

  const daysOverdue = (dueDate: string | null): number => {
    if (!dueDate) return 0
    const due = new Date(dueDate)
    const today = new Date()
    today.setHours(0,0,0,0); due.setHours(0,0,0,0)
    return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  }

  return (
    <Box sx={{ pb: 10, px: 2, pt: 1 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography
          variant="h6"
          sx={{
            fontSize: 'var(--type-title-size)',
            lineHeight: 'var(--type-title-line)',
            fontWeight: 'var(--type-title-weight)',
            letterSpacing: 'var(--type-title-tracking)',
            color: 'var(--text)',
          }}
        >
          <LedgerIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'var(--strong)' }} />
          邮箱账单流水
        </Typography>
        <IconButton
          aria-label="刷新"
          onClick={fetchData}
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
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Summary Cards */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto' }}>
        {[
          { label: '全部', value: summary.total, color: 'default' },
          { label: '未还', value: summary.unpaid, color: 'error' },
          { label: '部分', value: summary.partial, color: 'warning' },
          { label: '已清', value: summary.paid, color: 'success' },
        ].map(s => (
          <Box key={s.label} sx={{
            // 语义状态容器：彩色浅底 + 语义描边属于状态表达，保留
            minWidth: 72, p: 1.5, borderRadius: 'var(--radius-depth-1)', textAlign: 'center',
            bgcolor: alpha(s.color === 'default' ? '#1976d2' : s.color === 'error' ? '#d32f2f' : s.color === 'warning' ? '#ed6c02' : '#2e7d32', 0.08),
            border: `1px solid ${alpha(s.color === 'default' ? '#1976d2' : s.color === 'error' ? '#d32f2f' : s.color === 'warning' ? '#ed6c02' : '#2e7d32', 0.15)}`,
          }}>
            <Typography variant="h6" fontWeight={700} color={`${s.color}.main`}>{s.value}</Typography>
            <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
              {s.label}
            </Typography>
          </Box>
        ))}
      </Stack>

      {/* Total amount bar */}
      <Card elevation={0} sx={{ mb: 2, bgcolor: alpha('#1976d2', 0.04), border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>账单总额</Typography>
              <Typography variant="h6" fontWeight={700}>¥{summary.totalAmount.toLocaleString()}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>待还金额</Typography>
              <Typography variant="h6" fontWeight={700} color="error.main">¥{summary.unpaidAmount.toLocaleString()}</Typography>
            </Box>
          </Stack>
          {summary.unpaid > 0 && (
            <LinearProgress
              variant="determinate"
              value={(1 - summary.unpaidAmount / Math.max(summary.totalAmount, 1)) * 100}
              sx={{ mt: 1, height: 4, borderRadius: 'var(--radius-pill)' }}
            />
          )}
        </CardContent>
      </Card>

      {/* Tabs & Filter */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1 }}>
        <Tab label={`全部(${summary.total})`} value="all" />
        <Tab label={`未还(${summary.unpaid})`} value="unpaid" />
        <Tab label={`部分(${summary.partial})`} value="partial" />
        <Tab label={`已清(${summary.paid})`} value="paid" />
        <Tab
          label={`待补金额(${summary.needsAmount})`}
          value="needsAmount"
          sx={summary.needsAmount > 0 ? { color: 'warning.main', fontWeight: 700 } : undefined}
        />
      </Tabs>

      {banks.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
          <FilterIcon sx={{ fontSize: 18, color: 'var(--strong)' }} />
          <TextField
            select size="small" fullWidth variant="outlined"
            value={bankFilter} onChange={e => setBankFilter(e.target.value)}
            SelectProps={{ native: true }}
            sx={{ maxWidth: 200 }}
          >
            <option value="">全部银行</option>
            {banks.map(b => <option key={b} value={b}>{b.split('/')[0]}</option>)}
          </TextField>
          {bankFilter && (
            <IconButton
              aria-label="清除银行筛选"
              size="small"
              onClick={() => setBankFilter('')}
              sx={{ border: 0, color: 'var(--strong)', boxShadow: 'var(--shadow-e1)' }}
            >
              <CloseIcon />
            </IconButton>
          )}
        </Stack>
      )}

      {/* Batch select bar */}
      {!loading && filtered.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <FormControlLabel
            control={<Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} size="small" color="primary" />}
            label={
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                全选 ({selectableEntries.length} 条未还)
              </Typography>
            }
            sx={{ mr: 0 }}
          />
          {selectedIds.size > 0 && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<DoneAllIcon />}
              onClick={handleBatchMarkPaid}
              disabled={batchLoading}
              sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)' }}
            >
              {batchLoading ? '处理中...' : `标记 ${selectedIds.size} 条已还款`}
            </Button>
          )}
        </Stack>
      )}

      {/* Entry List */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><LinearProgress sx={{ width: '60%' }} /></Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, color: 'var(--muted)' }}>
          <ReceiptIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
            暂无数据
          </Typography>
        </Box>
      ) : (
        <List disablePadding>
          {filtered.map(entry => (
            <ListItem
              key={entry.id}
              disablePadding
              sx={{
                mb: 1,
                // 语义状态容器：逾期/今日到期/已完成的彩色描边属状态表达，保留
                borderRadius: 'var(--radius-depth-1)',
                overflow: 'hidden',
                border: '1px solid',
                // 语义状态描边（已完成/今日到期/逾期）；无状态时走唯一分隔线颜色
                borderColor: entry.completed ? alpha('#2e7d32', 0.15) : isDueToday(entry.due_date) ? alpha('#ed6c02', 0.25) : isOverdue(entry.due_date) ? alpha('#d32f2f', 0.2) : 'var(--track)',
                bgcolor: entry.completed ? alpha('#2e7d32', 0.03) : isDueToday(entry.due_date) ? alpha('#ed6c02', 0.04) : isOverdue(entry.due_date) ? alpha('#d32f2f', 0.03) : 'background.paper',
              }}
            >
              {!entry.completed && (
                <Checkbox
                  checked={selectedIds.has(entry.ledger_id)}
                  onChange={() => toggleSelect(entry.ledger_id)}
                  size="small"
                  sx={{ ml: 0.5, mr: -0.5 }}
                />
              )}
              {entry.completed && <Box sx={{ width: 34 }} />}
              <ListItemText
                primary={
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <BankLogo bank={entry.bank} />
                    <Box flex={1} minWidth={0}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            fontWeight: 600,
                            color: 'var(--text)',
                          }}
                        >
                          {entry.bank.split('/')[0]}
                        </Typography>
                        {formatCardTail(entry.account_tail) && (
                          // 尾号是同行唯一能区分「同银行多张卡」的识别信息，
                          // 宽度不够时让银行名省略，尾号始终完整保留。
                          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            ****{formatCardTail(entry.account_tail)}
                          </Typography>
                        )}
                      </Stack>
                      {entry.holder_name && (
                        <Typography
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            color: 'var(--strong)',
                            fontWeight: 500,
                            ml: 0.5,
                          }}
                        >
                          {entry.holder_name}
                        </Typography>
                      )}
                    </Box>
                    {statusChip(entry.payment_status)}
                  </Stack>
                }
                secondary={
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <AmountIcon sx={{ fontSize: 14, color: 'var(--strong)' }} />
                        {Number(entry.statement_amount || 0) > 0 ? (
                          <Typography
                            className="num-tabular"
                            sx={{
                              fontSize: 'var(--type-body-size)',
                              lineHeight: 'var(--type-body-line)',
                              letterSpacing: 'var(--type-body-tracking)',
                              fontWeight: 700,
                              color: isOverdue(entry.due_date) && !entry.completed ? 'var(--danger-ink)' : 'var(--text)',
                            }}
                          >
                            {entry.currency_symbol || '¥'}{Number(entry.statement_amount || 0).toLocaleString()}
                          </Typography>
                        ) : (
                          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', fontWeight: 700, color: 'var(--warning-ink)' }}>
                            金额待补录
                          </Typography>
                        )}
                        {entry.paid_amount > 0 && (
                          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--success-ink)' }}>
                            (已还{entry.currency_symbol || '¥'}{Number(entry.paid_amount).toLocaleString()})
                          </Typography>
                        )}
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <DateIcon sx={{ fontSize: 14, color: isDueToday(entry.due_date) ? 'var(--warning-ink)' : isOverdue(entry.due_date) ? 'var(--danger-ink)' : 'var(--strong)' }} />
                        <Typography
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            color: isDueToday(entry.due_date) && !entry.completed ? 'var(--warning-ink)' : isOverdue(entry.due_date) && !entry.completed ? 'var(--danger-ink)' : 'var(--muted)',
                          }}
                        >
                          {!entry.completed && isDueToday(entry.due_date)
                            ? '今天还款日'
                            : isOverdue(entry.due_date) && !entry.completed
                              ? `已逾期${daysOverdue(entry.due_date)}天`
                              : `到期: ${entry.due_date ?? '-'}`
                          }
                        </Typography>
                      </Stack>
                    </Stack>

                    {/* Quick actions */}
                    {!entry.completed && Number(entry.statement_amount || 0) > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<PayIcon />}
                          onClick={() => { setSelectedEntry(entry); setPayDialogOpen(true); setPayForm({ amount: '', note: '' }) }}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25 }}
                        >
                          标记还款
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          onClick={() => handleQuickMarkAll(entry, '已还清')}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25 }}
                        >
                          全额已还
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          onClick={() => handleQuickMarkAll(entry, '部分还款')}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25 }}
                        >
                          部分还款
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25, ml: 'auto' }}
                        >
                          详情
                        </Button>
                      </Stack>
                    )}

                    {entry.completed && (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                        sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0, mt: 0.5 }}
                      >
                        查看详情 →
                      </Button>
                    )}

                    {/* 无金额条目：邮件正文本身没写金额，提供一个补录入口 */}
                    {!entry.completed && Number(entry.statement_amount || 0) === 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }} alignItems="center">
                        <Button
                          size="small"
                          variant="contained"
                          color="warning"
                          startIcon={<AmountIcon />}
                          onClick={() => openAmountDialog(entry)}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25 }}
                        >
                          补录金额
                        </Button>
                        <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                          邮件里没有金额，补录后即可标记还款
                        </Typography>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                          sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', py: 0.25, ml: 'auto' }}
                        >
                          详情
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                }
                sx={{ px: 2, py: 1.5 }}
              />
            </ListItem>
          ))}
        </List>
      )}

      {/* 补录金额 Dialog：邮件正文没有金额时使用 */}
      <Dialog open={amountDialogOpen} onClose={() => setAmountDialogOpen(false)} fullWidth maxWidth="xs">
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
          补录金额 - {selectedEntry?.bank?.split('/')[0]}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              该邮件正文没有金额，请按实际账单填写。
            </Alert>
            {selectedEntry?.subject && (
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
                邮件主题：{selectedEntry.subject}
              </Typography>
            )}
            <TextField
              label="账单金额"
              type="number"
              fullWidth
              size="small"
              value={amountForm.amount}
              onChange={e => setAmountForm(f => ({ ...f, amount: e.target.value }))}
              InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>{selectedEntry?.currency_symbol || '¥'}</span> }}
            />
            <TextField
              label="最低还款（选填）"
              type="number"
              fullWidth
              size="small"
              value={amountForm.minimum}
              onChange={e => setAmountForm(f => ({ ...f, minimum: e.target.value }))}
              InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>{selectedEntry?.currency_symbol || '¥'}</span> }}
            />
            <TextField
              label="到期还款日（选填）"
              type="date"
              fullWidth
              size="small"
              value={amountForm.dueDate}
              onChange={e => setAmountForm(f => ({ ...f, dueDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setAmountDialogOpen(false)} color="inherit">取消</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleSaveAmount}
            disabled={amountSaving || !amountForm.amount}
          >
            {amountSaving ? '保存中...' : '保存金额'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={payDialogOpen} onClose={() => setPayDialogOpen(false)} fullWidth maxWidth="xs">
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
          标记还款 - {selectedEntry?.bank?.split('/')[0]}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>账单金额</Typography>
              <Typography className="num-tabular" variant="h6">{selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.statement_amount || 0).toLocaleString()}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>已还金额</Typography>
              <Typography className="num-tabular" sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--success-ink)' }}>{selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.paid_amount || 0).toLocaleString()}</Typography>
            </Box>
            <Divider sx={{ borderColor: 'var(--track)' }} />
            <TextField
              label="本次还款金额"
              type="number"
              fullWidth
              value={payForm.amount}
              onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
              placeholder={`最大: ${selectedEntry?.currency_symbol || '¥'}${Math.max(0, (Number(selectedEntry?.statement_amount || 0) - Number(selectedEntry?.paid_amount || 0))).toLocaleString()}`}
              InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>{selectedEntry?.currency_symbol || '¥'}</span> }}
            />
            <TextField
              label="备注（可选）"
              fullWidth multiline rows={2}
              value={payForm.note}
              onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
              placeholder="如：支付宝转账、银行代扣..."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleMarkPaid} disabled={!payForm.amount || parseFloat(payForm.amount) <= 0}>
            确认还款
          </Button>
        </DialogActions>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} fullWidth maxWidth="sm" scroll="paper">
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
          账单详情
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: 'var(--track)' }}>
          {selectedEntry && (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <BankLogo bank={selectedEntry.bank} size={32} />
                  <Typography fontWeight={600}>{selectedEntry.bank}</Typography>
                </Stack>
              </Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>卡尾号</Typography><Typography className="num-tabular">{formatCardTail(selectedEntry.account_tail) || '-'}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>类型</Typography><Typography>{selectedEntry.kind}</Typography></Stack>
              {selectedEntry.cardholder_name && (
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>持卡人</Typography><Typography fontWeight={600}>{selectedEntry.cardholder_name}</Typography></Stack>
              )}
              <Divider sx={{ borderColor: 'var(--track)' }} />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>账单金额</Typography><Typography className="num-tabular" fontWeight={700}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.statement_amount).toLocaleString()}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>最低还款</Typography><Typography className="num-tabular">{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.minimum_payment).toLocaleString()}</Typography></Stack>
              {selectedEntry.loan_monthly_payment && (
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>月供</Typography><Typography className="num-tabular" fontWeight={600} sx={{ color: 'var(--warning-ink)' }}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.loan_monthly_payment).toLocaleString()}</Typography></Stack>
              )}
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>到期日</Typography><Typography className="num-tabular" sx={{ color: isDueToday(selectedEntry.due_date) && !selectedEntry.completed ? 'var(--warning-ink)' : isOverdue(selectedEntry.due_date) && !selectedEntry.completed ? 'var(--danger-ink)' : 'var(--text)' }}>{selectedEntry.due_date}{!selectedEntry.completed && isDueToday(selectedEntry.due_date) ? ' (今天还款日)' : isOverdue(selectedEntry.due_date) && !selectedEntry.completed ? ` (已逾期${daysOverdue(selectedEntry.due_date)}天)` : ''}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>账单日</Typography><Typography className="num-tabular">{selectedEntry.statement_date}</Typography></Stack>
              <Divider sx={{ borderColor: 'var(--track)' }} />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>还款状态</Typography>{statusChip(selectedEntry.payment_status)}</Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>已还金额</Typography><Typography className="num-tabular" sx={{ color: 'var(--success-ink)' }}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.paid_amount).toLocaleString()}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>剩余金额</Typography><Typography className="num-tabular" sx={{ color: !selectedEntry.completed ? 'var(--warning-ink)' : 'var(--text)' }}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.remaining_amount).toLocaleString()}</Typography></Stack>
              {selectedEntry.payment_note && (
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ color: 'var(--muted)' }}>备注</Typography><Typography>{selectedEntry.payment_note}</Typography></Stack>
              )}
              <Divider sx={{ borderColor: 'var(--track)' }} />
              <Box>
                <Typography gutterBottom sx={{ fontSize: 'var(--type-section-size)', lineHeight: 'var(--type-section-line)', fontWeight: 'var(--type-section-weight)', letterSpacing: 'var(--type-section-tracking)', color: 'var(--text)' }}>邮件主题</Typography>
                <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--text)' }}>{selectedEntry.subject || '-'}</Typography>
              </Box>
              {selectedEntry.evidence && (
                <Box>
                  <Typography gutterBottom sx={{ fontSize: 'var(--type-section-size)', lineHeight: 'var(--type-section-line)', fontWeight: 'var(--type-section-weight)', letterSpacing: 'var(--type-section-tracking)', color: 'var(--text)' }}>证据摘录</Typography>
                  <Typography sx={{
                    maxHeight: 120, overflow: 'auto', p: 1, borderRadius: 'var(--radius-depth-1)',
                    bgcolor: 'var(--bg)', fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                  }}>{selectedEntry.evidence.slice(0, 500)}{selectedEntry.evidence.length > 500 ? '...' : ''}</Typography>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>关闭</Button>
          {!selectedEntry?.completed && (
            <Button
              variant="contained"
              startIcon={<PayIcon />}
              onClick={() => { setDetailOpen(false); setPayDialogOpen(true); setPayForm({ amount: '', note: '' }) }}
            >
              标记还款
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: 8 }}
      >
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
