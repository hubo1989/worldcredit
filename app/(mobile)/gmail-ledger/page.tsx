'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Card, CardContent, Chip, IconButton,
  Button, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, LinearProgress, Tabs, Tab, Stack, Divider,
  Alert, Snackbar, Collapse, List, ListItem, ListItemText,
  Fab, Tooltip, Badge, alpha, Checkbox, FormControlLabel
} from '@mui/material'
import PaidIcon from '@mui/icons-material/CheckCircle'
import UnpaidIcon from '@mui/icons-material/Pending'
import PartialIcon from '@mui/icons-material/Warning'
import PayIcon from '@mui/icons-material/Payment'
import FilterIcon from '@mui/icons-material/FilterList'
import RefreshIcon from '@mui/icons-material/Refresh'
import NoteIcon from '@mui/icons-material/NoteAdd'
import CloseIcon from '@mui/icons-material/Close'
import LedgerIcon from '@mui/icons-material/Receipt'
import BankIcon from '@mui/icons-material/AccountBalance'
import DateIcon from '@mui/icons-material/CalendarMonth'
import AmountIcon from '@mui/icons-material/Payments'
import ReceiptIcon from '@mui/icons-material/ReceiptLong'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import { getGmailLedgerEntries, getGmailLedgerSummary, markPayment, getGmailLedgerBanks } from '@/lib/api/gmail-ledger'
import type { GmailLedgerEntry } from '@/lib/api/gmail-ledger'

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
      style={{ borderRadius: size * 0.25, flexShrink: 0, objectFit: 'cover' }}
    />
  )
}

type TabValue = 'all' | 'unpaid' | 'partial' | 'paid'

export default function GmailLedgerPage() {
  const [entries, setEntries] = useState<GmailLedgerEntry[]>([])
  const [summary, setSummary] = useState({ total: 0, unpaid: 0, partial: 0, paid: 0, totalAmount: 0, unpaidAmount: 0 })
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

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [entriesData, summaryData, banksData] = await Promise.all([
        getGmailLedgerEntries(),
        getGmailLedgerSummary(),
        getGmailLedgerBanks(),
      ])
      setEntries(entriesData)
      setSummary(summaryData)
      setBanks(banksData)
    } catch (e: any) {
      setSnack({ open: true, message: `加载失败: ${e.message}`, severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = entries.filter(e => {
    if (tab === 'all') return true
    if (tab === 'unpaid') return e.payment_status === '未还款'
    if (tab === 'partial') return e.payment_status === '部分还款'
    if (tab === 'paid') return e.payment_status === '已还清'
    return true
  }).filter(e => bankFilter ? e.bank.includes(bankFilter) : true)

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
    } catch (e: any) {
      setSnack({ open: true, message: `操作失败: ${e.message}`, severity: 'error' })
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
    } catch (e: any) {
      setSnack({ open: true, message: `操作失败: ${e.message}`, severity: 'error' })
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
        <Typography variant="h6" fontWeight={700}>
          <LedgerIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'primary.main' }} />
          Gmail 账单
        </Typography>
        <IconButton onClick={fetchData} size="small"><RefreshIcon /></IconButton>
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
            minWidth: 72, p: 1.5, borderRadius: 2, textAlign: 'center',
            bgcolor: alpha(s.color === 'default' ? '#1976d2' : s.color === 'error' ? '#d32f2f' : s.color === 'warning' ? '#ed6c02' : '#2e7d32', 0.08),
            border: `1px solid ${alpha(s.color === 'default' ? '#1976d2' : s.color === 'error' ? '#d32f2f' : s.color === 'warning' ? '#ed6c02' : '#2e7d32', 0.15)}`,
          }}>
            <Typography variant="h6" fontWeight={700} color={`${s.color}.main`}>{s.value}</Typography>
            <Typography variant="caption" color="text.secondary">{s.label}</Typography>
          </Box>
        ))}
      </Stack>

      {/* Total amount bar */}
      <Card sx={{ mb: 2, bgcolor: alpha('#1976d2', 0.04), border: '1px solid', borderColor: alpha('#1976d2', 0.12) }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" justifyContent="space-between">
            <Box>
              <Typography variant="caption" color="text.secondary">账单总额</Typography>
              <Typography variant="h6" fontWeight={700}>¥{summary.totalAmount.toLocaleString()}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary">待还金额</Typography>
              <Typography variant="h6" fontWeight={700} color="error.main">¥{summary.unpaidAmount.toLocaleString()}</Typography>
            </Box>
          </Stack>
          {summary.unpaid > 0 && (
            <LinearProgress
              variant="determinate"
              value={(1 - summary.unpaidAmount / Math.max(summary.totalAmount, 1)) * 100}
              sx={{ mt: 1, height: 4, borderRadius: 2 }}
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
      </Tabs>

      {banks.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
          <FilterIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
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
            <IconButton size="small" onClick={() => setBankFilter('')}><CloseIcon /></IconButton>
          )}
        </Stack>
      )}

      {/* Batch select bar */}
      {!loading && filtered.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <FormControlLabel
            control={<Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} size="small" color="primary" />}
            label={<Typography variant="caption">全选 ({selectableEntries.length} 条未还)</Typography>}
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
              sx={{ fontSize: '0.75rem' }}
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
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <ReceiptIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
          <Typography>暂无数据</Typography>
        </Box>
      ) : (
        <List disablePadding>
          {filtered.map(entry => (
            <ListItem
              key={entry.id}
              disablePadding
              sx={{
                mb: 1,
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: entry.completed ? alpha('#2e7d32', 0.15) : isDueToday(entry.due_date) ? alpha('#ed6c02', 0.25) : isOverdue(entry.due_date) ? alpha('#d32f2f', 0.2) : 'divider',
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
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {entry.bank.split('/')[0]}
                        </Typography>
                        {entry.account_tail && (
                          <Typography variant="caption" color="text.secondary">
                            ****{entry.account_tail}
                          </Typography>
                        )}
                      </Stack>
                      {entry.holder_name && (
                        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 500, ml: 0.5 }}>
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
                        <AmountIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" fontWeight={700} color={isOverdue(entry.due_date) && !entry.completed ? 'error.main' : 'text.primary'}>
                          {entry.currency_symbol || '¥'}{Number(entry.statement_amount || 0).toLocaleString()}
                        </Typography>
                        {entry.paid_amount > 0 && (
                          <Typography variant="caption" color="success.main">
                            (已还{entry.currency_symbol || '¥'}{Number(entry.paid_amount).toLocaleString()})
                          </Typography>
                        )}
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <DateIcon sx={{ fontSize: 14, color: isDueToday(entry.due_date) ? 'warning.main' : isOverdue(entry.due_date) ? 'error.main' : 'text.secondary' }} />
                        <Typography variant="caption" color={isDueToday(entry.due_date) && !entry.completed ? 'warning.main' : isOverdue(entry.due_date) && !entry.completed ? 'error.main' : 'text.secondary'}>
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
                    {!entry.completed && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<PayIcon />}
                          onClick={() => { setSelectedEntry(entry); setPayDialogOpen(true); setPayForm({ amount: '', note: '' }) }}
                          sx={{ fontSize: '0.7rem', py: 0.25 }}
                        >
                          标记还款
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          onClick={() => handleQuickMarkAll(entry, '已还清')}
                          sx={{ fontSize: '0.7rem', py: 0.25 }}
                        >
                          全额已还
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          onClick={() => handleQuickMarkAll(entry, '部分还款')}
                          sx={{ fontSize: '0.7rem', py: 0.25 }}
                        >
                          部分还款
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                          sx={{ fontSize: '0.7rem', py: 0.25, ml: 'auto' }}
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
                        sx={{ fontSize: '0.7rem', py: 0, mt: 0.5 }}
                      >
                        查看详情 →
                      </Button>
                    )}
                  </Stack>
                }
                sx={{ px: 2, py: 1.5 }}
              />
            </ListItem>
          ))}
        </List>
      )}

      {/* Payment Dialog */}
      <Dialog open={payDialogOpen} onClose={() => setPayDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>标记还款 - {selectedEntry?.bank?.split('/')[0]}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="body2" color="text.secondary">账单金额</Typography>
              <Typography variant="h6">{selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.statement_amount || 0).toLocaleString()}</Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">已还金额</Typography>
              <Typography variant="body1" color="success.main">{selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.paid_amount || 0).toLocaleString()}</Typography>
            </Box>
            <Divider />
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
        <DialogTitle>账单详情</DialogTitle>
        <DialogContent dividers>
          {selectedEntry && (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <BankLogo bank={selectedEntry.bank} size={32} />
                  <Typography fontWeight={600}>{selectedEntry.bank}</Typography>
                </Stack>
              </Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">卡尾号</Typography><Typography>{selectedEntry.account_tail || '-'}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">类型</Typography><Typography>{selectedEntry.kind}</Typography></Stack>
              {selectedEntry.cardholder_name && (
                <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">持卡人</Typography><Typography fontWeight={600}>{selectedEntry.cardholder_name}</Typography></Stack>
              )}
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">账单金额</Typography><Typography fontWeight={700}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.statement_amount).toLocaleString()}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">最低还款</Typography><Typography>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.minimum_payment).toLocaleString()}</Typography></Stack>
              {selectedEntry.loan_monthly_payment && (
                <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">月供</Typography><Typography fontWeight={600} color="warning.main">{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.loan_monthly_payment).toLocaleString()}</Typography></Stack>
              )}
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">到期日</Typography><Typography color={isDueToday(selectedEntry.due_date) && !selectedEntry.completed ? 'warning.main' : isOverdue(selectedEntry.due_date) && !selectedEntry.completed ? 'error.main' : undefined}>{selectedEntry.due_date}{!selectedEntry.completed && isDueToday(selectedEntry.due_date) ? ' (今天还款日)' : isOverdue(selectedEntry.due_date) && !selectedEntry.completed ? ` (已逾期${daysOverdue(selectedEntry.due_date)}天)` : ''}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">账单日</Typography><Typography>{selectedEntry.statement_date}</Typography></Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">还款状态</Typography>{statusChip(selectedEntry.payment_status)}</Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">已还金额</Typography><Typography color="success.main">{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.paid_amount).toLocaleString()}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">剩余金额</Typography><Typography color={!selectedEntry.completed ? 'warning.main' : undefined}>{selectedEntry.currency_symbol || '¥'}{Number(selectedEntry.remaining_amount).toLocaleString()}</Typography></Stack>
              {selectedEntry.payment_note && (
                <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">备注</Typography><Typography>{selectedEntry.payment_note}</Typography></Stack>
              )}
              <Divider />
              <Box>
                <Typography variant="subtitle2" gutterBottom>邮件主题</Typography>
                <Typography variant="body2">{selectedEntry.subject || '-'}</Typography>
              </Box>
              {selectedEntry.evidence && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>证据摘录</Typography>
                  <Typography variant="body2" sx={{
                    maxHeight: 120, overflow: 'auto', p: 1, borderRadius: 1,
                    bgcolor: 'grey.50', fontSize: '0.75rem', lineHeight: 1.6,
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
