'use client'

import { useState, useEffect, useCallback } from 'react'
import { getGmailLedgerEntries, getGmailLedgerSummary, markPayment, updateLedgerAmount, getGmailLedgerBanks } from '@/lib/api/gmail-ledger'
import type { GmailLedgerEntry } from '@/lib/api/gmail-ledger'
import { formatCardTail } from '@/lib/utils'
import { Modal, Toast } from '@/components/obsidian/overlays'
import { TextField, TextArea } from '@/components/obsidian/fields'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import {
  CheckIcon, ClockIcon, AlertIcon, PaymentsIcon, FilterIcon,
  SyncIcon, CloseIcon, BillsIcon, CalendarIcon, DoneAllIcon, ChevronDownIcon,
} from '@/components/icons/WcIcon'

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
      loading='lazy'
      decoding='async'
      style={{ borderRadius: size * 0.25, flexShrink: 0, objectFit: 'cover' }}
    />
  )
}

type TabValue = 'all' | 'unpaid' | 'partial' | 'paid' | 'needsAmount'

/** 小号自绘复选框：支持三态（checked / indeterminate / unchecked） */
function MiniCheckBox({
  checked, indeterminate, onChange, label,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label?: React.ReactNode
}) {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={onChange}
      className='flex items-center gap-2'
    >
      <span
        className={
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[11px] font-bold leading-none text-white ' +
          (checked || indeterminate ? 'border-d-accent bg-d-accent' : 'border-d-border bg-transparent')
        }
      >
        {indeterminate ? '−' : checked ? '✓' : ''}
      </span>
      {label ? <span className='text-[14px] leading-[18px] text-d-muted'>{label}</span> : null}
    </button>
  )
}

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

  /** 状态徽章：淡底 + ink，与暗色 bills 视图同一口径 */
  const statusChip = (status: GmailLedgerEntry['payment_status']) => {
    const map: Record<string, { cls: string; icon: React.ReactNode }> = {
      '未还款': { cls: 'bg-d-danger-soft text-d-danger-ink', icon: <ClockIcon size={13} /> },
      '部分还款': { cls: 'bg-d-gold-soft text-d-warn-ink', icon: <AlertIcon size={13} /> },
      '已还清': { cls: 'bg-d-success-soft text-d-success-ink', icon: <CheckIcon size={13} /> },
    }
    const s = map[status] || map['未还款']
    return (
      <span className={'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ' + s.cls}>
        {s.icon}
        {status}
      </span>
    )
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

  /** 列表项语义描边/底色：已完成 / 今日到期 / 逾期 */
  const entryStateCls = (entry: GmailLedgerEntry) => {
    if (entry.completed) return 'border-d-success-ink/30 bg-d-success-soft/40'
    if (isDueToday(entry.due_date)) return 'border-d-warn-ink/40'
    if (isOverdue(entry.due_date)) return 'border-d-danger/40 bg-d-danger-soft/30'
    return 'border-d-border bg-d-surface'
  }

  const TABS: { value: TabValue; label: string; count: number; alert?: boolean }[] = [
    { value: 'all', label: '全部', count: summary.total },
    { value: 'unpaid', label: '未还', count: summary.unpaid },
    { value: 'partial', label: '部分', count: summary.partial },
    { value: 'paid', label: '已清', count: summary.paid },
    { value: 'needsAmount', label: '待补金额', count: summary.needsAmount, alert: summary.needsAmount > 0 },
  ]

  return (
    <div className='px-4 pb-24 pt-3'>
      {/* Header */}
      <div className='mb-4 flex items-center justify-between'>
        <h1 className='flex items-center gap-1.5 text-[22px] font-semibold leading-7 tracking-tight text-d-text'>
          <BillsIcon size={22} className='text-d-accent-light' />
          邮箱账单流水
        </h1>
        <button
          type='button'
          aria-label='刷新'
          onClick={fetchData}
          className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text active:bg-d-subtle'
        >
          <SyncIcon size={20} />
        </button>
      </div>

      {/* Summary Cards：语义状态容器，彩色淡底保留 */}
      <div className='mb-4 flex gap-2 overflow-x-auto'>
        {[
          { label: '全部', value: summary.total, cls: 'bg-d-subtle text-d-text' },
          { label: '未还', value: summary.unpaid, cls: 'bg-d-danger-soft text-d-danger-ink' },
          { label: '部分', value: summary.partial, cls: 'bg-d-gold-soft text-d-warn-ink' },
          { label: '已清', value: summary.paid, cls: 'bg-d-success-soft text-d-success-ink' },
        ].map(s => (
          <div
            key={s.label}
            className={'min-w-[72px] shrink-0 rounded-xl p-1.5 text-center ' + s.cls}
          >
            <p className='num-tabular text-[17px] font-bold leading-6'>{s.value}</p>
            <p className='text-[13px] leading-4 opacity-80'>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Total amount bar */}
      <div className='mb-4 rounded-2xl border border-d-border bg-d-surface p-3.5'>
        <div className='flex justify-between'>
          <div>
            <p className='text-[14px] leading-[18px] text-d-muted'>账单总额</p>
            <p className='num-tabular text-[17px] font-bold leading-6 text-d-text'>¥{summary.totalAmount.toLocaleString()}</p>
          </div>
          <div className='text-right'>
            <p className='text-[14px] leading-[18px] text-d-muted'>待还金额</p>
            <p className='num-tabular text-[17px] font-bold leading-6 text-d-danger-ink'>¥{summary.unpaidAmount.toLocaleString()}</p>
          </div>
        </div>
        {summary.unpaid > 0 && (
          <div className='mt-2 h-1 overflow-hidden rounded-full bg-d-border'>
            <div
              className='h-full rounded-full bg-d-accent transition-[width] duration-300'
              style={{ width: `${(1 - summary.unpaidAmount / Math.max(summary.totalAmount, 1)) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Tabs：pill 分段，横向滚动 */}
      <div className='mb-2 flex gap-1.5 overflow-x-auto pb-0.5'>
        {TABS.map(t => (
          <button
            key={t.value}
            type='button'
            onClick={() => setTab(t.value)}
            className={
              'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold leading-5 transition-colors ' +
              (tab === t.value
                ? 'bg-d-subtle text-d-text'
                : t.alert
                  ? 'text-d-warn-ink'
                  : 'text-d-muted active:bg-d-subtle')
            }
          >
            {t.label}({t.count})
          </button>
        ))}
      </div>

      {banks.length > 1 && (
        <div className='mb-2 flex items-center gap-2'>
          <FilterIcon size={18} className='shrink-0 text-d-muted' />
          <div className='relative max-w-[200px] flex-1'>
            <select
              value={bankFilter}
              onChange={e => setBankFilter(e.target.value)}
              className='h-9 w-full appearance-none rounded-xl border border-d-border bg-d-surface px-3 pr-8 text-[14px] text-d-text outline-none focus:border-d-accent'
            >
              <option value=''>全部银行</option>
              {banks.map(b => <option key={b} value={b}>{b.split('/')[0]}</option>)}
            </select>
            <ChevronDownIcon
              size={14}
              className='pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-d-muted'
            />
          </div>
          {bankFilter && (
            <button
              type='button'
              aria-label='清除银行筛选'
              onClick={() => setBankFilter('')}
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text active:bg-d-subtle'
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      )}

      {/* Batch select bar */}
      {!loading && filtered.length > 0 && (
        <div className='mb-2 flex items-center justify-between gap-2'>
          <MiniCheckBox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={toggleSelectAll}
            label={<>全选 ({selectableEntries.length} 条未还)</>}
          />
          {selectedIds.size > 0 && (
            <button
              type='button'
              onClick={handleBatchMarkPaid}
              disabled={batchLoading}
              className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-d-success-ink/90 px-3 text-[13px] font-semibold text-[#052e16] disabled:opacity-50'
            >
              {batchLoading ? <Spinner size={14} className='border-[#052e16]/40 border-t-[#052e16]' /> : <DoneAllIcon size={15} />}
              {batchLoading ? '处理中...' : `标记 ${selectedIds.size} 条已还款`}
            </button>
          )}
        </div>
      )}

      {/* Entry List */}
      {loading ? (
        <div className='flex justify-center py-8'>
          <Spinner size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <div className='py-8 text-center text-d-muted'>
          <BillsIcon size={48} className='mx-auto mb-1 opacity-30' />
          <p className='text-[14px] leading-[18px]'>暂无数据</p>
        </div>
      ) : (
        <div>
          {filtered.map(entry => (
            <div
              key={entry.id}
              className={'mb-2 flex overflow-hidden rounded-xl border p-2 ' + entryStateCls(entry)}
            >
              {!entry.completed && (
                <div className='flex items-center pl-1 pr-2'>
                  <MiniCheckBox
                    checked={selectedIds.has(entry.ledger_id)}
                    onChange={() => toggleSelect(entry.ledger_id)}
                  />
                </div>
              )}
              {entry.completed && <div className='w-8 shrink-0' />}
              <div className='min-w-0 flex-1 py-0.5'>
                {/* primary */}
                <div className='flex items-center gap-2'>
                  <BankLogo bank={entry.bank} />
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <p className='truncate text-[14.5px] font-semibold leading-[18px] text-d-text'>
                        {entry.bank.split('/')[0]}
                      </p>
                      {formatCardTail(entry.account_tail) && (
                        // 尾号是同行唯一能区分「同银行多张卡」的识别信息，
                        // 宽度不够时让银行名省略，尾号始终完整保留。
                        <p className='shrink-0 whitespace-nowrap text-[14.5px] leading-[18px] text-d-muted'>
                          ****{formatCardTail(entry.account_tail)}
                        </p>
                      )}
                    </div>
                    {entry.holder_name && (
                      <p className='ml-0.5 text-[14.5px] font-medium leading-[18px] text-d-accent-light'>
                        {entry.holder_name}
                      </p>
                    )}
                  </div>
                  {statusChip(entry.payment_status)}
                </div>

                {/* secondary */}
                <div className='mt-1 flex flex-col gap-1'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='flex items-center gap-1'>
                      <PaymentsIcon size={14} className='shrink-0 text-d-muted' />
                      {Number(entry.statement_amount || 0) > 0 ? (
                        <p className={'num-tabular text-[14.5px] font-bold leading-[18px] ' + (isOverdue(entry.due_date) && !entry.completed ? 'text-d-danger-ink' : 'text-d-text')}>
                          {entry.currency_symbol || '¥'}{Number(entry.statement_amount || 0).toLocaleString()}
                        </p>
                      ) : (
                        <p className='text-[14.5px] font-bold leading-[18px] text-d-warn-ink'>金额待补录</p>
                      )}
                      {entry.paid_amount > 0 && (
                        <p className='text-[14.5px] leading-[18px] text-d-success-ink'>
                          (已还{entry.currency_symbol || '¥'}{Number(entry.paid_amount).toLocaleString()})
                        </p>
                      )}
                    </span>
                    <span className='flex shrink-0 items-center gap-1'>
                      <CalendarIcon
                        size={14}
                        className={isDueToday(entry.due_date) ? 'text-d-warn-ink' : isOverdue(entry.due_date) ? 'text-d-danger-ink' : 'text-d-muted'}
                      />
                      <p
                        className={
                          'text-[14.5px] leading-[18px] ' +
                          (isDueToday(entry.due_date) && !entry.completed
                            ? 'text-d-warn-ink'
                            : isOverdue(entry.due_date) && !entry.completed
                              ? 'text-d-danger-ink'
                              : 'text-d-muted')
                        }
                      >
                        {!entry.completed && isDueToday(entry.due_date)
                          ? '今天还款日'
                          : isOverdue(entry.due_date) && !entry.completed
                            ? `已逾期${daysOverdue(entry.due_date)}天`
                            : `到期: ${entry.due_date ?? '-'}`
                        }
                      </p>
                    </span>
                  </div>

                  {/* Quick actions */}
                  {!entry.completed && Number(entry.statement_amount || 0) > 0 && (
                    <div className='mt-0.5 flex flex-wrap gap-1'>
                      <button
                        type='button'
                        onClick={() => { setSelectedEntry(entry); setPayDialogOpen(true); setPayForm({ amount: '', note: '' }) }}
                        className='inline-flex h-8 items-center gap-1 rounded-full bg-d-accent px-3 text-[13px] font-semibold text-white active:bg-d-accent/85'
                      >
                        <PaymentsIcon size={14} />
                        标记还款
                      </button>
                      <button
                        type='button'
                        onClick={() => handleQuickMarkAll(entry, '已还清')}
                        className='inline-flex h-8 items-center rounded-full border border-d-success-ink/50 px-3 text-[13px] font-semibold text-d-success-ink active:bg-d-success-soft'
                      >
                        全额已还
                      </button>
                      <button
                        type='button'
                        onClick={() => handleQuickMarkAll(entry, '部分还款')}
                        className='inline-flex h-8 items-center rounded-full border border-d-warn-ink/50 px-3 text-[13px] font-semibold text-d-warn-ink active:bg-d-gold-soft'
                      >
                        部分还款
                      </button>
                      <button
                        type='button'
                        onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                        className='ml-auto inline-flex h-8 items-center rounded-full px-2 text-[13px] font-semibold text-d-muted active:text-d-text'
                      >
                        详情
                      </button>
                    </div>
                  )}

                  {entry.completed && (
                    <button
                      type='button'
                      onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                      className='self-start px-0 py-0.5 text-[13px] font-semibold text-d-muted active:text-d-text'
                    >
                      查看详情 →
                    </button>
                  )}

                  {/* 无金额条目：邮件正文本身没写金额，提供一个补录入口 */}
                  {!entry.completed && Number(entry.statement_amount || 0) === 0 && (
                    <div className='mt-0.5 flex flex-wrap items-center gap-1'>
                      <button
                        type='button'
                        onClick={() => openAmountDialog(entry)}
                        className='inline-flex h-8 items-center gap-1 rounded-full bg-d-gold-deep px-3 text-[13px] font-semibold text-white active:bg-d-gold-deep/85'
                      >
                        <PaymentsIcon size={14} />
                        补录金额
                      </button>
                      <p className='text-[14.5px] leading-[18px] text-d-muted'>
                        邮件里没有金额，补录后即可标记还款
                      </p>
                      <button
                        type='button'
                        onClick={() => { setSelectedEntry(entry); setDetailOpen(true) }}
                        className='ml-auto inline-flex h-8 items-center rounded-full px-2 text-[13px] font-semibold text-d-muted active:text-d-text'
                      >
                        详情
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 补录金额 Dialog：邮件正文没有金额时使用 */}
      <Modal
        open={amountDialogOpen}
        onClose={() => setAmountDialogOpen(false)}
        title={'补录金额 - ' + (selectedEntry?.bank?.split('/')[0] ?? '')}
        footer={
          <>
            <button
              type='button'
              onClick={() => setAmountDialogOpen(false)}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleSaveAmount}
              disabled={amountSaving || !amountForm.amount}
              className='h-10 rounded-xl bg-d-gold-deep px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              {amountSaving ? '保存中...' : '保存金额'}
            </button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <Alert severity='info'>该邮件正文没有金额，请按实际账单填写。</Alert>
          {selectedEntry?.subject && (
            <p className='text-[14px] leading-[18px] text-d-muted'>
              邮件主题：{selectedEntry.subject}
            </p>
          )}
          <TextField
            label='账单金额'
            type='number'
            value={amountForm.amount}
            onChange={e => setAmountForm(f => ({ ...f, amount: e.target.value }))}
            startAdornment={<span className='text-[14px]'>{selectedEntry?.currency_symbol || '¥'}</span>}
          />
          <TextField
            label='最低还款（选填）'
            type='number'
            value={amountForm.minimum}
            onChange={e => setAmountForm(f => ({ ...f, minimum: e.target.value }))}
            startAdornment={<span className='text-[14px]'>{selectedEntry?.currency_symbol || '¥'}</span>}
          />
          <TextField
            label='到期还款日（选填）'
            type='date'
            value={amountForm.dueDate}
            onChange={e => setAmountForm(f => ({ ...f, dueDate: e.target.value }))}
          />
        </div>
      </Modal>

      {/* Payment Dialog */}
      <Modal
        open={payDialogOpen}
        onClose={() => setPayDialogOpen(false)}
        title={'标记还款 - ' + (selectedEntry?.bank?.split('/')[0] ?? '')}
        footer={
          <>
            <button
              type='button'
              onClick={() => setPayDialogOpen(false)}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleMarkPaid}
              disabled={!payForm.amount || parseFloat(payForm.amount) <= 0}
              className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              确认还款
            </button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <div>
            <p className='text-[14px] leading-[18px] text-d-muted'>账单金额</p>
            <p className='num-tabular text-[17px] font-bold leading-6 text-d-text'>
              {selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.statement_amount || 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className='text-[14px] leading-[18px] text-d-muted'>已还金额</p>
            <p className='num-tabular text-[14px] leading-[18px] text-d-success-ink'>
              {selectedEntry?.currency_symbol || '¥'}{Number(selectedEntry?.paid_amount || 0).toLocaleString()}
            </p>
          </div>
          <div className='h-px bg-d-border' />
          <TextField
            label='本次还款金额'
            type='number'
            value={payForm.amount}
            onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
            placeholder={`最大: ${selectedEntry?.currency_symbol || '¥'}${Math.max(0, (Number(selectedEntry?.statement_amount || 0) - Number(selectedEntry?.paid_amount || 0))).toLocaleString()}`}
            startAdornment={<span className='text-[14px]'>{selectedEntry?.currency_symbol || '¥'}</span>}
          />
          <TextArea
            label='备注（可选）'
            rows={2}
            value={payForm.note}
            onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
            placeholder='如：支付宝转账、银行代扣...'
          />
        </div>
      </Modal>

      {/* Detail Dialog */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title='账单详情'
        maxWidth='md'
        footer={
          <>
            <button
              type='button'
              onClick={() => setDetailOpen(false)}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted'
            >
              关闭
            </button>
            {!selectedEntry?.completed && (
              <button
                type='button'
                onClick={() => { setDetailOpen(false); setPayDialogOpen(true); setPayForm({ amount: '', note: '' }) }}
                className='inline-flex h-10 items-center gap-1.5 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white'
              >
                <PaymentsIcon size={15} />
                标记还款
              </button>
            )}
          </>
        }
      >
        {selectedEntry && (
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <BankLogo bank={selectedEntry.bank} size={32} />
                <p className='text-[15px] font-semibold text-d-text'>{selectedEntry.bank}</p>
              </div>
            </div>
            <DetailRow label='卡尾号' value={formatCardTail(selectedEntry.account_tail) || '-'} mono />
            <DetailRow label='类型' value={selectedEntry.kind} />
            {selectedEntry.cardholder_name && (
              <DetailRow label='持卡人' value={selectedEntry.cardholder_name} bold />
            )}
            <div className='h-px bg-d-border' />
            <DetailRow label='账单金额' value={`${selectedEntry.currency_symbol || '¥'}${Number(selectedEntry.statement_amount).toLocaleString()}`} mono bold />
            <DetailRow label='最低还款' value={`${selectedEntry.currency_symbol || '¥'}${Number(selectedEntry.minimum_payment).toLocaleString()}`} mono />
            {selectedEntry.loan_monthly_payment && (
              <DetailRow
                label='月供'
                value={`${selectedEntry.currency_symbol || '¥'}${Number(selectedEntry.loan_monthly_payment).toLocaleString()}`}
                mono
                bold
                valueCls='text-d-warn-ink'
              />
            )}
            <DetailRow
              label='到期日'
              value={`${selectedEntry.due_date}${!selectedEntry.completed && isDueToday(selectedEntry.due_date) ? ' (今天还款日)' : isOverdue(selectedEntry.due_date) && !selectedEntry.completed ? ` (已逾期${daysOverdue(selectedEntry.due_date)}天)` : ''}`}
              mono
              valueCls={
                isDueToday(selectedEntry.due_date) && !selectedEntry.completed
                  ? 'text-d-warn-ink'
                  : isOverdue(selectedEntry.due_date) && !selectedEntry.completed
                    ? 'text-d-danger-ink'
                    : 'text-d-text'
              }
            />
            <DetailRow label='账单日' value={selectedEntry.statement_date} mono />
            <div className='h-px bg-d-border' />
            <div className='flex items-center justify-between'>
              <span className='text-[14px] leading-[18px] text-d-muted'>还款状态</span>
              {statusChip(selectedEntry.payment_status)}
            </div>
            <DetailRow label='已还金额' value={`${selectedEntry.currency_symbol || '¥'}${Number(selectedEntry.paid_amount).toLocaleString()}`} mono valueCls='text-d-success-ink' />
            <DetailRow
              label='剩余金额'
              value={`${selectedEntry.currency_symbol || '¥'}${Number(selectedEntry.remaining_amount).toLocaleString()}`}
              mono
              valueCls={!selectedEntry.completed ? 'text-d-warn-ink' : 'text-d-text'}
            />
            {selectedEntry.payment_note && (
              <DetailRow label='备注' value={selectedEntry.payment_note} />
            )}
            <div className='h-px bg-d-border' />
            <div>
              <p className='mb-1 text-[15px] font-semibold leading-5 text-d-text'>邮件主题</p>
              <p className='text-[14px] leading-[18px] text-d-text'>{selectedEntry.subject || '-'}</p>
            </div>
            {selectedEntry.evidence && (
              <div>
                <p className='mb-1 text-[15px] font-semibold leading-5 text-d-text'>证据摘录</p>
                <p className='max-h-[120px] overflow-auto rounded-xl bg-d-bg p-2 text-[14px] leading-[18px] text-d-muted'>
                  {selectedEntry.evidence.slice(0, 500)}{selectedEntry.evidence.length > 500 ? '...' : ''}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Toast：warning 语义在暗色 Toast 里归并到 info 档 */}
      <Toast
        open={snack.open}
        message={snack.message}
        severity={snack.severity === 'warning' ? 'info' : snack.severity}
        autoHideMs={3000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
      />
    </div>
  )
}

function DetailRow({
  label, value, mono, bold, valueCls,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  bold?: boolean
  valueCls?: string
}) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-[14px] leading-[18px] text-d-muted'>{label}</span>
      <span className={(mono ? 'num-tabular ' : '') + (bold ? 'font-semibold ' : '') + (valueCls ?? 'text-d-text')}>
        {value}
      </span>
    </div>
  )
}
