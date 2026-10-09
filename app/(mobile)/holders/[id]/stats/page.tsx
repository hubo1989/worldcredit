'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getHolder, getHolderStatsPageData } from '@/lib/api/holders'
import type { StatsPageData } from '@/lib/api/holders'
import { formatAmount } from '@/lib/utils'
import type { CardHolder } from '@/lib/types'

function formatMonth(monthStr: string) {
  const [, mm] = monthStr.split('-')
  return `${parseInt(mm)}月`
}

export default function HolderStatsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [statsData, setStatsData] = useState<StatsPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, stats] = await Promise.all([
        getHolder(id),
        getHolderStatsPageData(id),
      ])
      setHolder(h)
      setStatsData(stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4'>
        <div className='wc-skeleton mb-3 h-[60px] w-full rounded-2xl' />
        <div className='wc-skeleton mb-3 h-40 w-full rounded-2xl' />
        <div className='wc-skeleton h-[120px] w-full rounded-2xl' />
      </div>
    )
  }

  if (!holder) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-10 text-center text-d-text'>
        <p className='text-[17px] font-semibold leading-6'>持卡人不存在</p>
        <p className='mt-1 text-[13px] leading-5 text-d-muted'>请返回重试</p>
      </div>
    )
  }

  const { summary, quickStats, monthlyTrend } = statsData!
  const maxTrendAmount = Math.max(...monthlyTrend.map(t => t.totalAmount), 1)
  const trendTotal = monthlyTrend.reduce((s, t) => s + t.totalAmount, 0)
  const emptyTrend = monthlyTrend.every(t => t.totalAmount === 0)

  const tiles = [
    { label: '卡数', value: String(quickStats.cardCount) },
    { label: '本月账单', value: formatAmount(quickStats.monthlyBills) },
    { label: '待还款', value: formatAmount(quickStats.pendingPayment) },
    {
      label: '逾期数',
      value: String(quickStats.overdueCount),
      danger: quickStats.overdueCount > 0,
    },
  ]

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-4 flex items-center justify-between'>
        <div className='flex min-w-0 items-center gap-2'>
          <button
            type='button'
            aria-label='返回'
            onClick={() => router.back()}
            className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-d-border bg-d-surface'
          >
            <BackIcon />
          </button>
          <p className='truncate text-[17px] font-semibold leading-6'>{holder.name}</p>
        </div>
        {/* 原按钮没有点击行为，只保留入口外观，不补未定义的编辑流程 */}
        <span
          aria-label='编辑持卡人'
          className='flex h-8 w-8 items-center justify-center rounded-full border border-d-border bg-d-surface text-d-muted'
        >
          <EditGlyph />
        </span>
      </div>

      {error && (
        <p className='mb-3 rounded-xl border border-d-danger/30 bg-d-danger-soft px-3 py-2 text-[13px] leading-5 text-d-danger-ink'>
          {error}
        </p>
      )}

      <div className='mb-4 rounded-2xl bg-d-accent px-5 py-5 text-white'>
        <p className='text-[13px] leading-5 text-white/80'>信用卡总额度</p>
        <p className='mt-1 text-[28px] font-bold leading-9 num-tabular'>{formatAmount(summary.totalLimit)}</p>
        <div className='mt-4 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] leading-5 text-white/80'>
          <span className='whitespace-nowrap'>额度使用率 {summary.utilizationRate}%</span>
          <span className='whitespace-nowrap'>
            已用 {formatAmount(summary.totalUsed)} / 可用 {formatAmount(summary.availableLimit)}
          </span>
        </div>
        <div className='mt-2 h-2 overflow-hidden rounded-full bg-white/20'>
          <div className='h-full rounded-full bg-white' style={{ width: `${Math.min(summary.utilizationRate, 100)}%` }} />
        </div>
      </div>

      <div className='mb-5 grid grid-cols-2 gap-3'>
        {tiles.map(tile => (
          <div key={tile.label} className='rounded-2xl border border-d-border bg-d-surface px-4 py-3'>
            <p className='text-[13px] leading-5 text-d-muted'>{tile.label}</p>
            <p className={'mt-1 text-[22px] font-bold leading-7 num-tabular ' + (tile.danger ? 'text-d-danger-ink' : '')}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      <p className='mb-2 text-[17px] font-semibold leading-6'>账单趋势</p>
      <div className='rounded-2xl border border-d-border bg-d-surface px-4 py-5'>
        {emptyTrend ? (
          <p className='py-6 text-center text-[13px] leading-5 text-d-muted'>近6个月暂无账单数据</p>
        ) : (
          <>
            <div className='flex h-[120px] items-end justify-around gap-2'>
              {monthlyTrend.map(t => {
                const heightPct = t.totalAmount > 0
                  ? Math.max((t.totalAmount / maxTrendAmount) * 100, 6)
                  : 6
                return (
                  <div
                    key={t.month}
                    title={`${formatMonth(t.month)}: ${formatAmount(t.totalAmount)}`}
                    className='flex h-full flex-1 flex-col items-center justify-end gap-1'
                  >
                    <span className='text-[10px] leading-3 text-d-muted'>
                      {t.totalAmount > 0 ? `${(t.totalAmount / 1000).toFixed(1)}k` : '-'}
                    </span>
                    <div
                      className={'w-full max-w-8 rounded-t ' + (t.totalAmount > 0 ? 'bg-d-accent' : 'bg-d-border')}
                      style={{ height: `${heightPct}%`, minHeight: 4 }}
                    />
                    <span className='text-[10px] leading-3 text-d-muted'>{formatMonth(t.month)}</span>
                  </div>
                )
              })}
            </div>
            <div className='mt-4 flex justify-between border-t border-d-border pt-3 text-[13px] leading-5 text-d-muted'>
              <span>总计 {formatAmount(trendTotal)}</span>
              <span>月均 {formatAmount(trendTotal / 6)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BackIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M15 18 9 12l6-6' />
    </svg>
  )
}

function EditGlyph() {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 20h9' />
      <path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' />
    </svg>
  )
}
