'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import type { BillDashboardItem, CardWithBillsSummary } from '@/lib/api/bills'
import {
  amountToneClass,
  badgeToneClass,
  billBadgeView,
  deriveAccountMode,
} from '@/lib/bills-view-model'
import {
  canManuallySetBillAmount,
  compareUnifiedBills,
  dueDistanceLabel,
  formatCardTail,
  getEffectiveCardName,
  hasManualBillAmount,
  missingStatementDays,
  nextBillingDateOf,
  payableToSortCard,
  pickDueReference,
  type BillsListCard,
  type BillsSortMode,
} from '@/lib/utils'
import { PayableRow } from '@/components/mobile/PayableList'
import type { PayableWithStatus } from '@/lib/api/payables'
import { currencySymbol } from '@/lib/fx'
import {
  AlertIcon,
  BankIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FilterIcon,
  PlusIcon,
  SyncIcon,
} from '@/components/icons/WcIcon'

export type BillDimension = 'holder' | 'bank'
export type BillViewFilter = 'all' | 'unpaid' | 'cleared'

export interface BankGroup {
  bankName: string
  cards: CardWithBillsSummary[]
  sumTotal: number
  sumUnconverted: string[]
  /** 银行维度额度模式：多卡共享额度（额度是一个池，不随卡数叠加） */
  sharedQuota?: boolean
  /** 银行维度账单模式：多卡合并账单（同银行多卡合一张账单一起还） */
  mergedStatement?: boolean
}

export interface BillsViewProps {
  syncing: boolean
  onSync: () => void
  overdueCount: number
  overdueTotal: number
  overdueUnconverted: string[]
  displayCurrency: string
  onPayAllOpen: () => void
  filtersOpen: boolean
  onFiltersToggle: () => void
  filterSummary: string
  activeFilterCount: number
  hasActiveFilter: boolean
  onResetFilters: () => void
  viewFilter: BillViewFilter
  onViewFilter: (v: BillViewFilter) => void
  sortMode: BillsSortMode
  onSortMode: (m: BillsSortMode) => void
  dimension: BillDimension
  onDimension: (d: BillDimension) => void
  selectedTag: string
  onSelectedTag: (t: string) => void
  holderTags: Array<{ id: string; name: string }>
  bankTags: string[]
  totalCount: number
  unpaidCount: number
  clearedCount: number
  loading: boolean
  loadError: string | null
  onRetry: () => void
  onEmptySync: () => void
  payables: PayableWithStatus[]
  onEditPayable: (p: PayableWithStatus) => void
  onPayPayable: (p: PayableWithStatus) => void
  cards: CardWithBillsSummary[]
  allCards: CardWithBillsSummary[]
  holderMap: Record<string, string>
  bankGroups: BankGroup[]
  onOpenPayment: (bill: BillDashboardItem) => void
  onManualAmount: (item: CardWithBillsSummary) => void
  onAddBill: () => void
}

function FilterPill({
  selected, onClick, children, warn,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  warn?: boolean
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={
        'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ' +
        (selected
          ? 'bg-d-accent text-white'
          : 'border border-d-border bg-d-surface ' + (warn ? 'text-d-warn-ink' : 'text-d-muted'))
      }
    >
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className='mb-1.5 text-[11px] font-semibold text-d-muted'>{children}</p>
}

/** 单张卡聚合卡（新层级：银行名为主标题 + 账户模式标签；持卡人降为次要信息） */
function BillCard({
  item, allCards, holderName, onOpenPayment, onManualAmount, sortMode,
}: {
  item: CardWithBillsSummary
  allCards: CardWithBillsSummary[]
  holderName?: string
  onOpenPayment: (bill: BillDashboardItem) => void
  onManualAmount: (item: CardWithBillsSummary) => void
  sortMode: BillsSortMode
}) {
  const router = useRouter()
  const [historyOpen, setHistoryOpen] = useState(false)
  const product = item.card.card_product
  const bankName = product?.bank_name || '银行卡'
  const rowCurrency = product?.currency || 'CNY'
  const cardName = getEffectiveCardName(item.card, product)
  // 卡名常自带银行名前缀（如「中国银行 普卡」），去掉避免渲染成「中国银行 中国银行 普卡」。
  const redundantPrefix = cardName.startsWith(bankName) ? bankName : ''
  const displayName = redundantPrefix ? cardName.slice(redundantPrefix.length).trim() : cardName
  const tailDigits = formatCardTail(item.card.card_number_last4)

  const isCleared = item.status === 'unissued' || item.unpaidAmount <= 0
  const isOverdue = item.status === 'overdue'
  const billingDay = item.card.override_billing_day ?? item.card.billing_day
  // 下期账单日：服务端算好带回（今天交易所在期的出账日）；兜底用账单日规则推
  const nextBillingDate = item.nextBillingDate
    ? new Date(item.nextBillingDate)
    : nextBillingDateOf(billingDay)
  const manualPinned = item.historyBills.some(hasManualBillAmount)
  const canManual = manualPinned || canManuallySetBillAmount(billingDay)
  // 已过账单日但本期账单还没进系统：非首次账单的卡才提醒（首次出账时间不可预期）
  const latestBillMonth = item.historyBills.reduce<string | null>((latest, b) => {
    return b.bill_month && (!latest || b.bill_month > latest) ? b.bill_month : latest
  }, null)
  const missingStatement = missingStatementDays(billingDay, latestBillMonth)

  const unpaidBills = item.historyBills.filter(b => b.computed_status !== 'paid')
  const dueRef = isCleared ? null : pickDueReference(unpaidBills)
  const dueLabel = dueRef ? dueDistanceLabel(dueRef.days) : null
  const payTarget = dueRef?.bill ?? item.activeBill
  const badge = billBadgeView(item)
  const accountMode = deriveAccountMode(item.holder_id, bankName, allCards)

  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={`查看 ${bankName} 卡片详情`}
      onClick={() => router.push(`/cards/${item.card.id}`)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/cards/${item.card.id}`) } }}
      className='cursor-pointer rounded-2xl border border-d-border bg-d-surface p-4 transition-colors active:bg-d-subtle/60'
    >
      {/* 主行：银行名 + 账户模式标签 + 状态徽章 */}
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <BankIcon size={16} className='shrink-0 text-d-accent-light' />
            <p className='min-w-0 truncate text-[16px] font-bold leading-[22px] text-d-text'>
              {bankName}
            </p>
            <span
              className={
                'shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-[14px] ' +
                (accountMode === 'multi'
                  ? 'bg-d-accent text-white'
                  : 'bg-d-subtle text-d-muted')
              }
            >
              {accountMode === 'multi' ? '多卡一账户' : '单卡单账户'}
            </span>
          </div>
          {/* 次行：卡名 + 尾号 + 持卡人（降级为 10px 次要信息） */}
          <div className='mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5'>
            {displayName && (
              <span className='min-w-0 truncate text-[12px] leading-4 text-d-muted'>
                {displayName}
              </span>
            )}
            {tailDigits && (
              <span className='shrink-0 whitespace-nowrap text-[12px] font-semibold leading-4 text-d-text'>
                尾号 {tailDigits}
              </span>
            )}
            {holderName && (
              <span className='shrink-0 whitespace-nowrap text-[10px] leading-4 text-d-muted'>
                持卡人 {holderName}
              </span>
            )}
          </div>
        </div>
        <span
          className={
            'shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold leading-5 ' +
            badgeToneClass(badge.tone)
          }
        >
          {badge.text}
        </span>
      </div>

      {/* 金额行：标签 + 手填入口；金额 + 登记还款 */}
      <div className='mt-3 flex items-end justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-1.5'>
            <span className='text-[11px] text-d-muted'>
              {isCleared ? '本期待还' : '当前待还金额'}
            </span>
            {canManual && (
              <button
                type='button'
                onClick={e => { e.stopPropagation(); onManualAmount(item) }}
                className='text-[11px] font-semibold text-d-accent-light underline underline-offset-2'
              >
                {manualPinned ? '修改金额' : '填写金额'}
              </button>
            )}
          </div>
          <p
            className={
              'mt-0.5 whitespace-nowrap text-[21px] font-bold leading-none ' +
              amountToneClass(item)
            }
          >
            {currencySymbol(rowCurrency)}
            {item.unpaidAmount.toLocaleString()}
          </p>
        </div>
        {!isCleared && payTarget && (
          <button
            type='button'
            onClick={e => { e.stopPropagation(); onOpenPayment(payTarget) }}
            className='h-11 shrink-0 whitespace-nowrap rounded-xl bg-d-accent px-4 text-xs font-semibold text-white'
          >
            登记还款
          </button>
        )}
      </div>

      {/* 周期与免息期 */}
      <div className='mt-3 flex flex-col gap-1 rounded-[10px] bg-d-subtle p-3'>
        <p className='text-[11px] leading-4 text-d-text'>
          下期账单日 <span className='font-bold'>{format(nextBillingDate, 'MM-dd')}</span>
          <span className='text-d-muted'> · </span>
          下期还款日 <span className='font-bold'>{format(new Date(item.nextDueDate), 'MM-dd')}</span>
        </p>
        {missingStatement && (
          <p className='flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-[color:var(--warning)]'>
            已过账单日 {missingStatement} 日，未接收到新的账单，请检查
          </p>
        )}
        {isCleared || sortMode === 'max_interest_free' ? (
          <p className='flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-d-success-ink'>
            今日刷卡免息 {item.graceDays} 天
          </p>
        ) : dueLabel ? (
          <p
            className={
              'flex items-center gap-1.5 text-[11px] font-semibold leading-4 ' +
              (isOverdue ? 'text-d-danger-ink' : 'text-d-muted')
            }
          >
            {dueLabel}
          </p>
        ) : null}
      </div>

      {/* 历史账单明细 */}
      {item.historyBills.length > 0 && (
        <div className='mt-3 border-t border-d-border pt-2'>
          <button
            type='button'
            onClick={e => { e.stopPropagation(); setHistoryOpen(v => !v) }}
            aria-expanded={historyOpen}
            className='flex w-full items-center justify-between py-1 text-left text-[12px] text-d-muted'
          >
            <span className='flex items-center gap-1.5'>
              历史账单明细 ({item.historyBills.length} 期)
            </span>
            <ChevronDownIcon
              size={16}
              className={'transition-transform ' + (historyOpen ? 'rotate-180' : '')}
            />
          </button>
          {historyOpen && (
            <div className='mt-1 flex flex-col gap-1.5'>
              {item.historyBills.map(b => {
                const bPaid = b.computed_status === 'paid'
                const bMonth = b.bill_month || (b.due_date ? b.due_date.slice(0, 7) : '账单')
                return (
                  <button
                    key={b.id}
                    type='button'
                    onClick={e => { e.stopPropagation(); if (!bPaid) onOpenPayment(b) }}
                    className={
                      'flex items-center justify-between rounded-lg bg-d-subtle p-2.5 text-left' +
                      (bPaid ? ' cursor-default' : '')
                    }
                  >
                    <span className='min-w-0'>
                      <span className='block text-[12px] font-semibold leading-4 text-d-text'>
                        {bMonth} 期账单
                      </span>
                      <span className='mt-0.5 block text-[10px] leading-4 text-d-muted'>
                        到期日: {b.due_date ? format(new Date(b.due_date), 'yyyy-MM-dd') : '—'}
                      </span>
                    </span>
                    <span className='flex shrink-0 items-center gap-2'>
                      <span className='text-[12px] font-semibold text-d-text'>
                        {currencySymbol(rowCurrency)}
                        {Number(b.bill_amount).toLocaleString()}
                      </span>
                      <span
                        className={
                          'rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' +
                          (bPaid
                            ? 'bg-d-success-soft text-d-success-ink'
                            : 'bg-d-danger-soft text-d-danger-ink')
                        }
                      >
                        {bPaid ? '已结清' : '未结清'}
                      </span>
                      <ChevronRightIcon
                        size={14}
                        className='text-d-muted'
                        onClick={e => { e.stopPropagation(); router.push('/bills/' + b.id) }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BillsView(vm: BillsViewProps) {
  const {
    syncing, onSync, overdueCount, overdueTotal, overdueUnconverted, displayCurrency,
    onPayAllOpen, filtersOpen, onFiltersToggle, filterSummary, activeFilterCount,
    hasActiveFilter, onResetFilters, viewFilter, onViewFilter, dimension, onDimension,
    selectedTag, onSelectedTag, holderTags, bankTags, totalCount, unpaidCount, clearedCount,
    loading, loadError, onRetry, onEmptySync, payables, cards, allCards, holderMap,
    bankGroups, onOpenPayment, onManualAmount, onAddBill, sortMode, onSortMode,
    onEditPayable, onPayPayable,
  } = vm

  const renderCards = () => {
    if (dimension === 'bank') {
      return (
        <div className='flex flex-col gap-5'>
          {bankGroups.map(group => (
            <div key={group.bankName}>
              <div className='mb-2 flex items-center gap-2 rounded-xl bg-d-subtle px-3.5 py-2'>
                <BankIcon size={16} className='shrink-0 text-d-accent-light' />
                <p className='flex-1 text-[15px] font-semibold text-d-text'>
                  {group.bankName} · {group.cards.length} 张卡
                </p>
                {/* 银行维度模式徽章：只有 shared/merged 才提示，默认形态不加噪 */}
                {group.sharedQuota ? (
                  <span className='rounded-md bg-d-accent px-1.5 py-0.5 text-[9px] font-semibold text-white'>共享额度</span>
                ) : null}
                {group.mergedStatement ? (
                  <span className='rounded-md bg-d-accent px-1.5 py-0.5 text-[9px] font-semibold text-white'>合并账单</span>
                ) : null}
                <p className='text-[12px] font-semibold text-d-muted'>
                  待还 {currencySymbol(displayCurrency)}
                  {group.sumTotal.toLocaleString()}
                  {group.sumUnconverted.length > 0 &&
                    '（未含 ' + group.sumUnconverted.join('、') + '）'}
                </p>
              </div>
              <div className='flex flex-col gap-2.5'>
                {group.cards.map(item => (
                  <BillCard
                    key={item.card.id}
                    item={item}
                    allCards={allCards}
                    holderName={holderMap[item.holder_id]}
                    onOpenPayment={onOpenPayment}
                    onManualAmount={onManualAmount}
                    sortMode={sortMode}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
    // 固定支出与信用卡混排：同一比较器（逾期→待还→已结清分组 + 所选组内轴）。
    // 信用卡的排序字段在 CardWithBillsSummary 上同名（status/billingDay/
    // historyBills），直接 as BillsListCard 复用，不复制数据。
    const unified = [
      ...payables.map(p => ({
        key: `payable-${p.id}`,
        sortCard: payableToSortCard(p),
        node: (
          <PayableRow
            key={`payable-${p.id}`}
            payable={p}
            onEdit={onEditPayable}
            onPay={onPayPayable}
          />
        ),
      })),
      ...cards.map(item => ({
        key: item.card.id,
        sortCard: item as unknown as BillsListCard,
        node: (
          <BillCard
            key={item.card.id}
            item={item}
            allCards={allCards}
            holderName={holderMap[item.holder_id]}
            onOpenPayment={onOpenPayment}
            onManualAmount={onManualAmount}
            sortMode={sortMode}
          />
        ),
      })),
    ].sort((a, b) => compareUnifiedBills(a.sortCard, b.sortCard, sortMode))

    return (
      <div className='flex flex-col gap-2.5'>{unified.map(u => u.node)}</div>
    )
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg pb-24 text-d-text'>
      {/* 页头：标题 + 同步 */}
      <div className='flex items-center justify-between px-5 pt-4'>
        <p className='text-[20px] font-bold leading-7 text-d-text'>卡片与账单</p>
        <button
          id='sync-bills-btn'
          type='button'
          aria-label='同步账单'
          onClick={onSync}
          disabled={syncing}
          className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface disabled:opacity-60'
        >
          <SyncIcon
            size={20}
            className={syncing ? 'animate-spin text-d-accent-light' : 'text-d-accent-light'}
          />
        </button>
      </div>

      <div className='mt-4 flex flex-col gap-3 px-5'>
        {/* 吸顶区：排序 tab + 筛选摘要栏随滚动固定，筛选展开面板不吸顶 */}
        <div className='sticky top-0 z-20 -mx-5 flex flex-col gap-3 bg-d-bg px-5 pb-1 pt-1 shadow-[0_1px_0_0_var(--color-d-border)]'>
        {/* BILL-02：顶部三个排序快捷切换栏（受控） */}
        <div className='flex gap-2 rounded-xl border border-d-border bg-d-surface p-1 text-[13px] font-semibold'>
          {([
            ['nearest_due', '最近需还款'],
            ['max_interest_free', '最大免息期'],
            ['nearest_billing', '最近账单日'],
          ] as Array<[BillsSortMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type='button'
              aria-pressed={sortMode === mode}
              onClick={() => onSortMode(mode)}
              className={
                'flex-1 rounded-lg py-1.5 text-center transition-colors ' +
                (sortMode === mode
                  ? 'bg-d-accent text-white'
                  : 'text-d-muted hover:text-d-text')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* 逾期警示横幅 */}
        {overdueCount > 0 && (
          <div className='flex items-center gap-2.5 rounded-[14px] bg-d-danger-soft p-3'>
            <AlertIcon size={18} className='shrink-0 text-d-danger-ink' />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[12px] font-bold leading-4 text-d-danger-ink'>
                存在 {overdueCount} 笔历史逾期账单未结清
              </p>
              <p className='mt-0.5 truncate text-[11px] leading-4 text-d-muted'>
                待还合计：{currencySymbol(displayCurrency)}
                {overdueTotal.toLocaleString()}
                {overdueUnconverted.length > 0 &&
                  '（未含 ' + overdueUnconverted.join('、') + '）'}
              </p>
            </div>
            <button
              type='button'
              onClick={onPayAllOpen}
              className='h-11 shrink-0 whitespace-nowrap rounded-xl bg-d-danger px-3.5 text-xs font-semibold text-white'
            >
              一键还清
            </button>
          </div>
        )}

        {/* 筛选栏：收起态摘要 */}
        <div className='flex h-10 items-center gap-2.5 rounded-xl border border-d-border bg-d-surface px-3.5'>
          <button
            type='button'
            onClick={onFiltersToggle}
            aria-expanded={filtersOpen}
            aria-controls='bills-filter-panel'
            className='flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-d-text'
          >
            <FilterIcon size={15} className='text-d-accent-light' />
            筛选
            {activeFilterCount > 0 && (
              <span className='rounded-full bg-d-accent px-1.5 text-[11px] font-bold leading-[17px] text-white'>
                {activeFilterCount}
              </span>
            )}
            <ChevronDownIcon
              size={14}
              className={'text-d-muted transition-transform ' + (filtersOpen ? 'rotate-180' : '')}
            />
          </button>
          <span className='h-4 w-px shrink-0 bg-d-border' />
          <p className='min-w-0 flex-1 truncate text-[11px] text-d-muted'>{filterSummary}</p>
          {hasActiveFilter && (
            <button
              type='button'
              aria-label='清除全部筛选'
              onClick={onResetFilters}
              className='shrink-0 text-d-muted'
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
        </div>

        {/* 筛选面板：展开态 */}
        {filtersOpen && (
          <div id='bills-filter-panel' className='rounded-xl border border-d-border bg-d-surface p-4'>
            <SectionLabel>卡片状态</SectionLabel>
            <div className='mb-4 flex gap-2 overflow-x-auto pb-1'>
              <FilterPill selected={viewFilter === 'all'} onClick={() => onViewFilter('all')}>
                全部卡片 ({totalCount})
              </FilterPill>
              <FilterPill
                selected={viewFilter === 'unpaid'}
                onClick={() => onViewFilter('unpaid')}
                warn={unpaidCount > 0 && viewFilter !== 'unpaid'}
              >
                待还款卡片 ({unpaidCount})
              </FilterPill>
              <FilterPill selected={viewFilter === 'cleared'} onClick={() => onViewFilter('cleared')}>
                未出账单/已结清 ({clearedCount})
              </FilterPill>
            </div>

            <SectionLabel>分组维度</SectionLabel>
            <div className='mb-4 flex gap-2'>
              <FilterPill selected={dimension === 'holder'} onClick={() => onDimension('holder')}>
                按持卡人
              </FilterPill>
              <FilterPill selected={dimension === 'bank'} onClick={() => onDimension('bank')}>
                按银行
              </FilterPill>
            </div>

            <SectionLabel>{dimension === 'holder' ? '持卡人' : '银行'}</SectionLabel>
            <div className='mb-4 flex gap-2 overflow-x-auto pb-1'>
              <FilterPill selected={selectedTag === 'all'} onClick={() => onSelectedTag('all')}>
                {dimension === 'holder' ? '全部持卡人' : '全部银行'}
              </FilterPill>
              {dimension === 'holder'
                ? holderTags.map(t => (
                    <FilterPill
                      key={t.id}
                      selected={selectedTag === t.id}
                      onClick={() => onSelectedTag(t.id)}
                    >
                      {t.name}
                    </FilterPill>
                  ))
                : bankTags.map(name => (
                    <FilterPill
                      key={name}
                      selected={selectedTag === name}
                      onClick={() => onSelectedTag(name)}
                    >
                      {name}
                    </FilterPill>
                  ))}
            </div>

            <SectionLabel>排序</SectionLabel>
            {/* 三段顺序固定，无可选项；不放开关，只说明规则。 */}
            <ol className='m-0 list-decimal space-y-1 pl-5 text-[11px] leading-4 text-d-muted'>
              <li>逾期：逾期最久 → 最短</li>
              <li>待还款：距还款日最近 → 最远</li>
              <li>未出账单/已结清：距账单日最近 → 最远</li>
            </ol>
          </div>
        )}

        {/* 错误态 */}
        {loadError && (
          <div className='rounded-xl bg-d-danger-soft p-3 text-center'>
            <p className='text-[12px] font-semibold text-d-danger-ink'>{loadError}</p>
            <button
              type='button'
              onClick={onRetry}
              className='mt-2 rounded-xl bg-d-danger px-4 py-1.5 text-xs font-semibold text-white'
            >
              重试
            </button>
          </div>
        )}

        {loading ? (
          <div className='flex flex-col gap-3'>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className='wc-skeleton h-[140px] w-full rounded-2xl' />
            ))}
          </div>
        ) : cards.length === 0 && payables.length === 0 ? (
          <div className='rounded-2xl border border-d-border bg-d-surface px-6 py-10 text-center'>
            <p className='text-[15px] font-semibold text-d-text'>没有找到卡片记录</p>
            <p className='mt-1 text-[12px] text-d-muted'>可以手动录入卡片或导入邮箱账单</p>
            <button
              type='button'
              onClick={onEmptySync}
              className='mt-4 h-11 rounded-xl bg-d-accent px-5 text-xs font-semibold text-white'
            >
              立即同步
            </button>
          </div>
        ) : (
          renderCards()
        )}
      </div>

      {/* 录入账单 FAB */}
      <button
        type='button'
        aria-label='录入账单'
        onClick={onAddBill}
        className='fixed bottom-20 right-5 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-d-accent text-white shadow-lg'
      >
        <PlusIcon size={22} />
      </button>
    </div>
  )
}
