'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
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
import { BillDraftsPanel } from '@/components/mobile/BillDraftsPanel'
import { ManualBillAmountDialog } from '@/components/mobile/ManualBillAmountDialog'
import { PayableForm } from '@/components/mobile/PayableForm'
import {
  getRecurringPayables, payRecurringPayable, getPayablePayments,
  type PayableWithStatus,
  type PayablePaymentRecord,
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
} from '@/components/obsidian/BillsView'
import { BillsOverlays } from '@/components/obsidian/BillsOverlays'
import {
  BILL_STATUS_LABELS,
  NO_BANK_TAG,
  countByTag,
  countEntities,
  countStatuses,
  filterCardsForView,
  filterPayablesForView,
  statusOptionsFor,
  type BillStatusKey,
  type BillsEntityType,
  type BillsFilterState,
} from '@/lib/bills-view-model'

type Dimension = BillDimension

const ENTITY_TEXT: Record<BillsEntityType, string> = {
  all: '全部',
  cards: '信用卡账单',
  payables: '固定支出',
}

/** 标签摘要：维度 + 选中值，避免多层嵌套三目。 */
function tagSummary(
  dimension: Dimension,
  selectedTag: string,
  holderTags: Array<{ id: string; name: string }>
): string {
  if (selectedTag === 'all') return '全部' + (dimension === 'holder' ? '持卡人' : '银行')
  if (dimension === 'holder') {
    return holderTags.find(t => t.id === selectedTag)?.name ?? '未知持卡人'
  }
  return selectedTag === NO_BANK_TAG ? '非银行' : selectedTag
}

/** 不可变地从 Record 中删除一个 key（无该 key 时返回原对象）。 */
function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

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
  // 固定支出历史还款：按需加载，展开一次后缓存
  const [payablePayments, setPayablePayments] = useState<Record<string, PayablePaymentRecord[]>>({})
  const [expandedPayableIds, setExpandedPayableIds] = useState<Set<string>>(new Set())
  const [payableHistoryErrors, setPayableHistoryErrors] = useState<Record<string, string>>({})
  const [payableHistoryLoading, setPayableHistoryLoading] = useState<Set<string>>(new Set())
  const [editingPayable, setEditingPayable] = useState<PayableWithStatus | null>(null)

  const [celebrationNotice, setCelebrationNotice] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })

  // 维度 / 标签 / 排序 / 状态过滤
  const [dimension, setDimension] = useState<Dimension>('holder')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  // 对象类型 + 状态多选；默认全部（用户口径）
  const [entityType, setEntityType] = useState<BillsEntityType>('all')
  const [statusKeys, setStatusKeys] = useState<BillStatusKey[]>([])
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

  // 展开集合的 ref：异步回调里需要读最新值（state 是渲染快照）
  const expandedPayableIdsRef = useRef(expandedPayableIds)
  useEffect(() => {
    expandedPayableIdsRef.current = expandedPayableIds
  }, [expandedPayableIds])

  // 同一笔的在途请求：并发点击或还款后重取都复用同一个 Promise，避免重复 RPC
  const payableHistoryInFlight = useRef<Map<string, Promise<void>>>(new Map())

  /** 拉取并写入历史缓存；同一 payableId 复用进行中的请求。 */
  const loadPayableHistory = useCallback((payableId: string) => {
    const running = payableHistoryInFlight.current.get(payableId)
    if (running) return running
    setPayableHistoryLoading(prev => new Set(prev).add(payableId))
    let settle!: () => void
    const current = new Promise<void>(resolve => { settle = resolve })
    void (async () => {
      try {
        const records = await getPayablePayments(payableId)
        setPayablePayments(prev => ({ ...prev, [payableId]: records }))
        setPayableHistoryErrors(prev => omitRecordKey(prev, payableId))
      } catch (err) {
        // 保持未加载状态：再次展开会重试；错误就地展示
        setPayableHistoryErrors(prev => ({
          ...prev,
          [payableId]: err instanceof Error ? err.message : '历史还款加载失败',
        }))
      } finally {
        // 只清理自己这条：若期间已被 loadData 清空并重新发起，不能误删新任务
        // 用 token 而非 task 引用比对（task 在 IIFE 内部尚未赋值）
        if (payableHistoryInFlight.current.get(payableId) === current) {
          payableHistoryInFlight.current.delete(payableId)
        }
        setPayableHistoryLoading(prev => {
          const next = new Set(prev)
          next.delete(payableId)
          return next
        })
      }
    })().finally(() => settle())
    payableHistoryInFlight.current.set(payableId, current)
    return current
  }, [])

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
      // 全量刷新：历史缓存可能过期。先丢弃在途请求（否则其成功回调会把刷新前的旧数据写回），
      // 再清空缓存并对仍展开的行重拉，避免停在「加载中」
      payableHistoryInFlight.current.clear()
      setPayablePayments({})
      setPayableHistoryErrors({})
      expandedPayableIdsRef.current.forEach(id => { void loadPayableHistory(id) })
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
  }, [user, loadPayableHistory])

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

  const filterState: BillsFilterState = useMemo(
    () => ({ entityType, statuses: statusKeys, dimension, selectedTag }),
    [entityType, statusKeys, dimension, selectedTag]
  )

  // 信用卡与固定支出共用同一套筛选口径
  const filteredCards = useMemo(
    () => filterCardsForView(cardsSummary, filterState),
    [cardsSummary, filterState]
  )
  const filteredPayables = useMemo(
    () => filterPayablesForView(payables, filterState),
    [payables, filterState]
  )

  // 面板里的 facet 计数
  const statusCounts = useMemo(
    () => countStatuses(cardsSummary, payables, filterState),
    [cardsSummary, payables, filterState]
  )
  const entityCounts = useMemo(
    () => countEntities(cardsSummary, payables, filterState),
    [cardsSummary, payables, filterState]
  )
  const tagCounts = useMemo(
    () => countByTag(cardsSummary, payables, filterState),
    [cardsSummary, payables, filterState]
  )

  // 当前筛选结果中的逾期账单（筛选影响汇总与一键还款范围）
  const allOverdueBills = useMemo(() => {
    const list: BillDashboardItem[] = []
    for (const card of filteredCards) {
      for (const bill of card.historyBills) {
        if (bill.computed_status === 'overdue' || (bill.days_until_due < 0 && bill.computed_status !== 'paid')) {
          list.push(bill)
        }
      }
    }
    return list
  }, [filteredCards])

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

  // 持卡人维度可选标签：信用卡 + 固定支出
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
    // 固定支出可归属到某个持卡人：即使该人名下没有信用卡，也要出现在筛选标签里
    for (const p of payables) {
      const hid = p.holder_id
      if (hid && !seen.has(hid)) {
        seen.add(hid)
        ids.push(hid)
      }
    }
    return ids.map(id => ({ id, name: holderMap[id] || '未知持卡人' }))
  }, [cardsSummary, payables, holderMap])

  // 银行维度可选标签：信用卡银行 + 固定支出银行
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
    for (const p of payables) {
      const n = p.bank_name
      if (n && !seen.has(n)) {
        seen.add(n)
        names.push(n)
      }
    }
    return names.sort()
  }, [cardsSummary, payables])


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
        // 银行维度额度/账单模式是银行级属性，取组内第一张卡联查带出的值即可
        const first = item.card.card_product
        groups.push({
          bankName,
          cards: [],
          sumTotal: 0,
          sumUnconverted: [],
          sharedQuota: first?.bank_quota_mode === 'shared' || undefined,
          mergedStatement: first?.bank_statement_mode === 'merged' || undefined,
        })
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
      // 新还款落库：先等在途旧请求落定（否则它的成功回调会把不含新还款的记录写回），
      // 再清缓存并重取
      const running = payableHistoryInFlight.current.get(payable.id)
      if (running) await running
      setPayablePayments(prev => omitRecordKey(prev, payable.id))
      // 等待期间用户可能收起/展开，重取前重新读取展开状态
      setCelebrationNotice({
        open: true,
        message: `🎉 已登记「${payable.name}」本期付款 ${currencySymbol(payable.currency)}${payable.amount.toLocaleString()}`,
      })
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : '登记失败，请重试')
    }
  }

  /** 展开/收起固定支出历史：首次展开才拉取该笔记录。 */
  const handleTogglePayableHistory = useCallback(
    (payableId: string) => {
      const willOpen = !expandedPayableIdsRef.current.has(payableId)
      setExpandedPayableIds(prev => {
        const next = new Set(prev)
        if (willOpen) next.add(payableId)
        else next.delete(payableId)
        return next
      })
      if (!willOpen || payablePayments[payableId]) return
      void loadPayableHistory(payableId)
    },
    [payablePayments, loadPayableHistory]
  )

  // 收起态摘要：把当前筛选、分组与排序压成一行可读文本
  const filterSummary = useMemo(() => {
    const statusText =
      statusKeys.length === 0
        ? '全部状态'
        : statusKeys.map(k => BILL_STATUS_LABELS[k]).join('+')
    const dimText = dimension === 'holder' ? '持卡人' : '银行'
    return (
      ENTITY_TEXT[entityType] +
      ' · ' + statusText +
      ' · 按' + dimText +
      ' · ' + tagSummary(dimension, selectedTag, holderTags)
    )
  }, [entityType, statusKeys, dimension, selectedTag, holderTags])

  // 计入摘要的非默认维度数量
  const activeFilterCount = useMemo(() => {
    let n = 0
    if (entityType !== 'all') n += 1
    if (statusKeys.length > 0) n += 1
    if (dimension !== 'holder') n += 1
    if (selectedTag !== 'all') n += 1
    return n
  }, [entityType, statusKeys, dimension, selectedTag])

  const hasActiveFilter = activeFilterCount > 0

  const resetFilters = useCallback(() => {
    setEntityType('all')
    setStatusKeys([])
    setDimension('holder')
    setSelectedTag('all')
  }, [])

  return (
    <>
      {/* 邮件导入的待确认草稿：有草稿才渲染，确认后刷新账单列表 */}
      <BillDraftsPanel onChanged={() => void loadData()} />
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
        entityType={entityType}
        onEntityType={next => {
          setEntityType(next)
          // 切到只含一种对象时，剔除该类型不存在的状态，避免残留成空结果
          const allowed = statusOptionsFor(next)
          setStatusKeys(prev => prev.filter(k => allowed.includes(k)))
        }}
        statusKeys={statusKeys}
        onToggleStatus={k =>
          setStatusKeys(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]))
        }
        onClearStatuses={() => setStatusKeys([])}
        statusCounts={statusCounts}
        entityCounts={entityCounts}
        tagCounts={tagCounts}
        sortMode={sortMode}
        onSortMode={setSortMode}
        dimension={dimension}
        onDimension={setDimension}
        selectedTag={selectedTag}
        onSelectedTag={setSelectedTag}
        holderTags={holderTags}
        bankTags={bankTags}
        loading={loading}
        loadError={loadError}
        onRetry={() => loadData()}
        onEmptySync={handleSync}
        payables={filteredPayables}
        payablePayments={payablePayments}
        payableHistoryErrors={payableHistoryErrors}
        payableHistoryLoading={payableHistoryLoading}
        expandedPayableIds={expandedPayableIds}
        onTogglePayableHistory={handleTogglePayableHistory}
        onEditPayable={p => { setEditingPayable(p); setPayableFormOpen(true) }}
        onPayPayable={handlePayPayable}
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
