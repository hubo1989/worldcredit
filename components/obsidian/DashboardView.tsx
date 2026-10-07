'use client'

import type { ReactNode } from 'react'
import type { BillDashboardItem } from '@/lib/api/bills'
import {
  billCurrency,
  computeMetrics,
  formatMoney,
  FUTURE_RANGES,
  getDueTodayBills,
  type FutureRange,
  type HolderFilter,
} from '@/lib/dashboard-metrics'
import { getEffectiveCardName } from '@/lib/utils'

export type DashboardMetrics = ReturnType<typeof computeMetrics>

export interface DashboardViewProps {
  metrics: DashboardMetrics
  holderPills: Array<{ value: HolderFilter; label: string; fullName?: string }>
  holderFilter: HolderFilter
  onHolderFilter: (v: HolderFilter) => void
  futureRange: FutureRange
  onFutureRange: (r: FutureRange) => void
  debtExpanded: boolean
  onDebtExpanded: () => void
  privacyOn: boolean
  privacyIcon: ReactNode
  onTogglePrivacy: () => void
  amountClass: string
  displayCurrency: string
  visibleBills: BillDashboardItem[]
  onPaySingle: (e: React.MouseEvent, bill: BillDashboardItem) => void
  onPayAllOpen: () => void
  onNavBills: () => void
  onNavPromos: () => void
  totalCardCount: number
  holders: Array<{ id: string; name: string }>
  cardsByHolder: Record<string, number>
  quickActions: Array<{ key: string; label: string; icon: ReactNode; onClick: () => void }>
  promoCount: number | null
  /** 已登录用户展示口径：姓名缺失时回落到邮箱前缀，避免把所有人显示成同一个人。 */
  userName: string | null
  userEmail: string | null
}

export function DashboardView(vm: DashboardViewProps) {
  const {
    metrics, holderPills, holderFilter, onHolderFilter, futureRange, onFutureRange,
    debtExpanded, onDebtExpanded, privacyOn, privacyIcon, onTogglePrivacy,
    amountClass, displayCurrency, visibleBills, onPaySingle, onPayAllOpen,
    onNavBills, onNavPromos, totalCardCount, holders, cardsByHolder,
    quickActions, promoCount, userName, userEmail,
  } = vm

  // 头像/称呼都来自当前登录用户；邮箱前缀只是兜底，不能再写死成某一个人的名字。
  const emailPrefix = (userEmail || '').split('@')[0]
  const displayName = (userName || '').trim() || emailPrefix || '我'
  const avatarInitial = (displayName.trim().charAt(0) || '我').toUpperCase()

  return (
    <div className="obsidian-dashboard min-h-dvh bg-d-bg pb-4 text-d-text">
      {/* 页头：问候 + 隐私开关 */}
      <div className="flex items-center gap-3 px-5 pt-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-d-accent text-sm font-bold text-white">{avatarInitial}</div>
        <div className="flex-1">
          <p className="text-[11px] leading-4 text-d-muted">概览</p>
          <p className="text-[15px] font-bold leading-5">{displayName}</p>
        </div>
        <button
          onClick={onTogglePrivacy}
          aria-label={privacyOn ? '显示金额' : '隐匿金额'}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-d-border bg-d-surface"
        >
          {privacyIcon}
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
            onClick={() => onPayAllOpen()}
            className="h-11 shrink-0 rounded-xl bg-d-danger px-4 text-xs font-semibold text-white"
          >
            一键全部还款
          </button>
        </div>
      )}

      {/* 持卡人筛选 */}
      <div className="mt-4 flex gap-2 overflow-x-auto px-5">
        {holderPills.map(p => {
          const active = holderFilter === p.value
          return (
            <button
              key={p.value}
              onClick={() => onHolderFilter(p.value)}
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
        <button onClick={() => onNavBills()} className="rounded-2xl border border-d-border bg-d-surface p-3.5 text-left">
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
                    onClick={() => onFutureRange(r)}
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
          onClick={() => onDebtExpanded()}
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

      {/* 当天需还款（B0-2 修订需求） */}
      {(() => {
        // 已结清（或剩余为 0）的账单不该再出现在「今天需还款」里——
        // 它的 CTA 会被 markBillAsPaid 拒绝，用户看到的是一个必然失败的操作。
        const dueToday = getDueTodayBills(visibleBills)
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
                  onClick={e => onPaySingle(e, b)}
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
        onClick={() => onNavPromos()}
        className="mx-5 mt-4 flex w-[calc(100%-40px)] items-center gap-3 rounded-2xl border border-d-border bg-d-surface p-3.5 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-d-subtle text-d-gold">%</div>
        <div className="flex-1">
          <p className="text-[13px] font-bold">今日可享优惠</p>
          <p className="text-[11px] text-d-muted">
            {promoCount !== null ? promoCount + ' 项有效期内优惠' : '查看名下卡片在有效期内的优惠'}
          </p>
        </div>
        <span className="text-d-muted">›</span>
      </button>

      {/* 账户 chips */}
      <div className="mt-5 px-5">
        <p className="text-[15px] font-semibold">账户</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => onHolderFilter('all')}
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
              onClick={() => onHolderFilter(h.id)}
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

      {/* 逾期明细 */}
      <div className="mx-5 mt-5 flex items-center justify-between">
        <p className="text-[15px] font-semibold">逾期明细</p>
        {metrics.overdueBills.length > 0 && (
          <button onClick={() => onNavBills()} className="text-xs font-semibold text-d-accent-light">
            查看全部
          </button>
        )}
      </div>
      {metrics.overdueBills.map(b => (
        <div
          key={b.id}
          className="mx-5 mt-3 rounded-2xl border border-d-border bg-d-surface p-3.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{b.card?.card_product?.bank_name || '信用卡'}</p>
            <span className="rounded-md bg-d-danger-soft px-2 py-0.5 text-[11px] font-bold text-d-danger-ink">逾期</span>
          </div>
          <p className="mt-1 text-[11px] text-d-muted">
            {getEffectiveCardName(b.card, b.card?.card_product)} · 尾号 {b.card?.card_number_last4 || '----'}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-d-muted">待还金额</p>
              <p className={amountClass + ' text-[17px] font-bold text-d-danger-ink'}>
                {formatMoney(b.remaining_amount, billCurrency(b, displayCurrency))}
              </p>
            </div>
            <button
              onClick={e => onPaySingle(e, b)}
              className="h-11 rounded-xl bg-d-accent px-4 text-xs font-semibold text-white"
            >
              全额结清
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
