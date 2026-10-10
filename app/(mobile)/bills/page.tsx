'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import {
  getCardsWithBillsSummary,
  createPayment,
  updateBillStatus,
  markAllOverdueBillsAsPaid,
  getPaymentTotal,
  type CardWithBillsSummary,
  type BillDashboardItem,
} from '@/lib/api/bills'
import { syncGmailLedgerToCardsAndBills } from '@/lib/api/sync-gmail'
import { getHolders } from '@/lib/api/holders'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { BillForm } from '@/components/mobile/BillForm'
import { ManualBillAmountDialog } from '@/components/mobile/ManualBillAmountDialog'
import { PayableList } from '@/components/mobile/PayableList'
import { PayableForm } from '@/components/mobile/PayableForm'
import {
  getRecurringPayables, payRecurringPayable,
  type PayableWithStatus,
} from '@/lib/api/payables'
import {
  formatCardTail, compareBillsListCardsByMode, pickDueReference,
  type BillsSortMode,
  getEffectiveCardName, hasManualBillAmount, effectiveBillAmount,
} from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { fetchRates, sumByCurrency, currencySymbol, type FxRates } from '@/lib/fx'
import {
  BillsView,
  type BankGroup,
  type BillDimension,
  type BillViewFilter,
} from '@/components/obsidian/BillsView'
import { BillsOverlays } from '@/components/obsidian/BillsOverlays'

type Dimension = BillDimension
type ViewFilter = BillViewFilter

export default function BillsPage() {
  const { user } = useAuth()
  const { displayConfig } = useUserPreferences()
  /** 折算目标币种：用户偏好 display_config.default_currency（缺省 CNY）。 */
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  /** 汇率状态：null 表示本次没取到，界面走「未含汇率」的降级展示。 */
  const [fxRates, setFxRates] = useState<FxRates | null>(null)
  const [cardsSummary, setCardsSummary] = useState<CardWithBillsSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<BillDashboardItem | null>(null)
  const [billFormOpen, setBillFormOpen] = useState(false)
  // 手填金额：只针对「卡」，账单可能还没生成，因此传的是 card，不是 bill
  const [manualTarget, setManualTarget] = useState<CardWithBillsSummary | null>(null)
  // 固定支出（房租/贷款等按月应付）
  const [payables, setPayables] = useState<PayableWithStatus[]>([])
  const [payableFormOpen, setPayableFormOpen] = useState(false)
  const [editingPayable, setEditingPayable] = useState<PayableWithStatus | null>(null)

  const [celebrationNotice, setCelebrationNotice] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })

  // 维度 / 标签 / 排序 / 状态过滤
  const [dimension, setDimension] = useState<Dimension>('holder')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  // BILL-02：三个排序快捷栏。只影响卡片组内顺序，不碰筛选条件。
  const [sortMode, setSortMode] = useState<BillsSortMode>('nearest_due')
  // 筛选器默认收成一行摘要，逐步展开完整维度/标签/排序
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    if (!filtersOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filtersOpen])

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
      // 固定支出单独拉取：取不到也不该让整页失败（与汇率同样的降级策略）
      try {
        setPayables(await getRecurringPayables(user.id))
      } catch (payableErr) {
        console.error(payableErr)
        setPayables([])
      }
    } catch (err) {
      console.error(err)
      setLoadError(err instanceof Error ? err.message : '加载账单与卡片失败')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 汇率与业务数据解耦：拿不到也不让整页失败，只是合计缺少外币部分。
  useEffect(() => {
    let cancelled = false
    fetchRates()
      .then(rates => { if (!cancelled) setFxRates(rates) })
      .catch(() => { if (!cancelled) setFxRates(null) })
    return () => { cancelled = true }
  }, [])

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
    } catch (err) {
      setLoadError('同步失败：' + (err instanceof Error ? err.message : '未知错误'))
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

      const totalPaid = await getPaymentTotal(selectedBill.id)
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
    } catch (err) {
      alert('登记还款失败: ' + (err instanceof Error ? err.message : String(err)))
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

  /**
   * 逾期待还合计。
   *
   * 原来是把所有逾期账单的金额直接相加，而卡可能是不同币种（生产库有 USD / HKD），
   * 相加后再标 ¥ 是错的。这里按币种分组、折算到目标币种；汇率拿不到时跨币种部分
   * 不计入，并在下方明确提示未含哪些币种。
   */
  const overdueTotals = useMemo(() => {
    const sum = sumByCurrency(
      allOverdueBills,
      b => ({
        amount: b.remaining_amount > 0 ? b.remaining_amount : Number(b.bill_amount || 0),
        currency: b.card?.card_product?.currency || displayCurrency,
      }),
      displayCurrency,
      fxRates
    )
    return { total: sum.total, unconverted: sum.unconverted_currencies }
  }, [allOverdueBills, displayCurrency, fxRates])

  const handlePayAllOverdue = async () => {
    if (!user?.id) return
    setPaying(true)
    try {
      const res = await markAllOverdueBillsAsPaid(user.id, allOverdueBills)
      setPayAllOpen(false)
      // 展示口径用界面已折算好的 overdueTotals.total：服务端返回的 totalAmount
      // 仍是跨币种直接相加的老口径（那属于 bills.server.ts，本次不改）。
      setCelebrationNotice({
        open: true,
        message: `🎉 恭喜！已一键全额结清 ${res.count} 笔逾期账单（合计 ${currencySymbol(displayCurrency)}${overdueTotals.total.toLocaleString()}）！`,
      })
      await loadData()
    } catch (err) {
      alert('一键还款失败: ' + (err instanceof Error ? err.message : String(err)))
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

  // 排序固定为三段，每段用各自的时间轴，方向都是「最紧要的在前」：
  //   逾期      → 逾期最久 → 逾期最短
  //   待还款    → 距还款日最近 → 最远
  //   未出账单  → 距账单日最近 → 最远
  // 三段顺序不随任何开关变化，所以页面上不再提供排序选项。
  const sortedCards = useMemo(
    () => [...filteredCards].sort((a, b) => compareBillsListCardsByMode(a, b, sortMode)),
    [filteredCards, sortMode]
  )

  // 按银行分组（保持 sortedCards 顺序）；组内待还合计按币种折算后汇总
  const bankGroups = useMemo<BankGroup[]>(() => {
    if (dimension !== 'bank') return []
    const groups: BankGroup[] = []
    const idx = new Map<string, number>()
    for (const item of sortedCards) {
      const bankName = item.card.card_product?.bank_name || '未知银行'
      if (!idx.has(bankName)) {
        idx.set(bankName, groups.length)
        groups.push({ bankName, cards: [], sumTotal: 0, sumUnconverted: [] })
      }
      groups[idx.get(bankName)!].cards.push(item)
    }
    for (const group of groups) {
      const sum = sumByCurrency(
        group.cards,
        c => ({ amount: c.unpaidAmount, currency: c.card.card_product?.currency || displayCurrency }),
        displayCurrency,
        fxRates
      )
      group.sumTotal = sum.total
      group.sumUnconverted = sum.unconverted_currencies
    }
    return groups
  }, [sortedCards, dimension, displayCurrency, fxRates])

  const openPaymentForBill = (bill: BillDashboardItem) => {
    setSelectedBill(bill)
    setPaymentOpen(true)
  }

  /** 手填对话框的预填金额：优先已手填的那期，否则用当前待还对应的账单。 */
  const manualAmountOf = (item: CardWithBillsSummary): number => {
    const pinned = item.historyBills.find(hasManualBillAmount)
    if (pinned) return effectiveBillAmount(pinned)
    const ref = pickDueReference(item.historyBills.filter(b => b.computed_status !== 'paid'))
    const bill = ref?.bill ?? item.activeBill
    return bill ? effectiveBillAmount(bill) : 0
  }

  /** 登记固定支出本期付款。账期由服务端决定，客户端只传金额。 */
  const handlePayPayable = async (payable: PayableWithStatus) => {
    try {
      await payRecurringPayable(payable.id, payable.amount)
      setCelebrationNotice({
        open: true,
        message: `🎉 已登记「${payable.name}」本期付款 ${currencySymbol(payable.currency)}${payable.amount.toLocaleString()}`,
      })
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : '登记失败，请重试')
    }
  }

  const unpaidCount = useMemo(() => cardsSummary.filter(c => c.unpaidAmount > 0).length, [cardsSummary])
  const clearedCount = useMemo(() => cardsSummary.filter(c => c.unpaidAmount <= 0).length, [cardsSummary])

  // 收起态摘要：把当前筛选、分组与排序压成一行可读文本
  const filterSummary = useMemo(() => {
    const statusText =
      viewFilter === 'unpaid' ? '待还款' : viewFilter === 'cleared' ? '未出账单/已结清' : '全部卡片'
    const tagText =
      selectedTag === 'all'
        ? '全部' + (dimension === 'holder' ? '持卡人' : '银行')
        : dimension === 'holder'
          ? holderTags.find(t => t.id === selectedTag)?.name || '未知持卡人'
          : selectedTag
    const dimText = dimension === 'holder' ? '持卡人' : '银行'
    return statusText + ' · 按' + dimText + ' · ' + tagText + ' · 逾期优先'
  }, [viewFilter, dimension, selectedTag, holderTags])

  // 计入摘要的非默认维度数量（排序已固定，不计入）
  const activeFilterCount = useMemo(() => {
    let n = 0
    if (viewFilter !== 'all') n += 1
    if (dimension !== 'holder') n += 1
    if (selectedTag !== 'all') n += 1
    return n
  }, [viewFilter, dimension, selectedTag])

  const hasActiveFilter = activeFilterCount > 0

  const resetFilters = useCallback(() => {
    setViewFilter('all')
    setDimension('holder')
    setSelectedTag('all')
  }, [])

  return (
    <>
      <BillsView
        syncing={syncing}
        onSync={handleSync}
        overdueCount={allOverdueBills.length}
        overdueTotal={overdueTotals.total}
        overdueUnconverted={overdueTotals.unconverted}
        displayCurrency={displayCurrency}
        onPayAllOpen={() => setPayAllOpen(true)}
        filtersOpen={filtersOpen}
        onFiltersToggle={() => setFiltersOpen(open => !open)}
        filterSummary={filterSummary}
        activeFilterCount={activeFilterCount}
        hasActiveFilter={hasActiveFilter}
        onResetFilters={resetFilters}
        viewFilter={viewFilter}
        onViewFilter={setViewFilter}
        sortMode={sortMode}
        onSortMode={setSortMode}
        dimension={dimension}
        onDimension={setDimension}
        selectedTag={selectedTag}
        onSelectedTag={setSelectedTag}
        holderTags={holderTags}
        bankTags={bankTags}
        totalCount={cardsSummary.length}
        unpaidCount={unpaidCount}
        clearedCount={clearedCount}
        loading={loading}
        loadError={loadError}
        onRetry={() => loadData()}
        onEmptySync={handleSync}
        payables={
          <PayableList
            payables={payables}
            onAdd={() => { setEditingPayable(null); setPayableFormOpen(true) }}
            onEdit={p => { setEditingPayable(p); setPayableFormOpen(true) }}
            onPay={handlePayPayable}
          />
        }
        cards={sortedCards}
        allCards={cardsSummary}
        holderMap={holderMap}
        bankGroups={bankGroups}
        onOpenPayment={openPaymentForBill}
        onManualAmount={setManualTarget}
        onAddBill={() => setBillFormOpen(true)}
      />

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

      <BillForm
        open={billFormOpen}
        onClose={() => setBillFormOpen(false)}
        onSuccess={loadData}
      />

      {/* 手填账单金额：金额优先级高于一切导入来源 */}
      <ManualBillAmountDialog
        open={manualTarget !== null}
        onClose={() => setManualTarget(null)}
        onSuccess={loadData}
        cardId={manualTarget?.card.id ?? null}
        cardLabel={`${getEffectiveCardName(manualTarget?.card, manualTarget?.card.card_product)} ${formatCardTail(manualTarget?.card.card_number_last4) ? `····${formatCardTail(manualTarget?.card.card_number_last4)}` : ''}`.trim()}
        currency={manualTarget?.card.card_product?.currency || 'CNY'}
        currentAmount={manualTarget ? manualAmountOf(manualTarget) : 0}
        isPinned={!!manualTarget?.historyBills.some(hasManualBillAmount)}
      />

      {/* 固定支出新增/编辑 */}
      <PayableForm
        open={payableFormOpen}
        onClose={() => setPayableFormOpen(false)}
        onSuccess={loadData}
        existing={editingPayable}
      />

      <BillsOverlays
        overdueCount={allOverdueBills.length}
        overdueTotalLabel={
          currencySymbol(displayCurrency) + overdueTotals.total.toLocaleString() +
          (overdueTotals.unconverted.length > 0
            ? '（未含 ' + overdueTotals.unconverted.join('、') + '）'
            : '')
        }
        payAllOpen={payAllOpen}
        onPayAllClose={() => !paying && setPayAllOpen(false)}
        onPayAllConfirm={handlePayAllOverdue}
        paying={paying}
        toast={celebrationNotice}
        onToastClose={() => setCelebrationNotice(prev => ({ ...prev, open: false }))}
      />
    </>
  )
}
