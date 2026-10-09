// app/(mobile)/analytics/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { getAnalyticsSummary, getMonthlyDebtTrend, getCategoryBreakdown } from '@/lib/api/analytics'
import { getHolders } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import type { CreditCardWithProduct } from '@/lib/api/cards'
import { useAuth } from '@/lib/auth'
import { ExportDialog } from '@/components/mobile/ExportDialog'
import { SelectField } from '@/components/obsidian/fields'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { DownloadIcon } from '@/components/icons/WcIcon'
import type { AnalyticsSummary, MonthlyDebtPoint, CategoryBreakdown } from '@/lib/api/analytics'
import type { CardHolder } from '@/lib/types'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { currencySymbol } from '@/lib/fx'

interface Filters {
  months: number
  holderId?: string
}

// 暗色底饼图色板：避开低饱和灰蓝，保证 12px 图例可辨
const COLORS = ['#7aadff', '#6ee7a0', '#ffc46b', '#ff8a8a', '#c4a5ff', '#5fd4d0']

// recharts 默认黑字在暗底不可读：统一口径到 d-muted / d-border
const AXIS_TICK = { fontSize: 12, fill: '#9aa6bc' }
const TOOLTIP_STYLE = {
  backgroundColor: '#131a2a',
  border: '1px solid #26304a',
  borderRadius: 12,
  color: '#f5f7fa',
}

export default function AnalyticsPage() {
  const { user } = useAuth()
  const { displayConfig } = useUserPreferences()
  /** 折算目标币种：与服务端 analytics 使用同一份偏好，保证口径一致。 */
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  const [filters, setFilters] = useState<Filters>({ months: 6 })
  const [holderOptions, setHolderOptions] = useState<Array<{ id: string; name: string }>>([])
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [trend, setTrend] = useState<MonthlyDebtPoint[]>([])
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardOptions, setCardOptions] = useState<Array<{ id: string; label: string; card: CreditCardWithProduct }>>([])

  const loadHolders = useCallback(async () => {
    if (!user) return
    try {
      const holdersData = await getHolders(user.id)
      setHolders(holdersData)
      setHolderOptions(holdersData.map(h => ({ id: h.id, name: h.name })))

      // Load card options for export
      const allCards: Array<{ id: string; label: string; card: CreditCardWithProduct }> = []
      await Promise.all(
        holdersData.map(async (h) => {
          const cards = await getCardsByHolder(h.id)
          cards.forEach(c => {
            allCards.push({
              id: c.id,
              // 修改内容优先：getCardsByHolder 已把卡级别覆盖写进 card.card_name
              label: `${h.name} - ${c.card_product?.bank_name ?? ''} ${c.card_name ?? c.card_product?.card_name ?? ''}`,
              card: c,
            })
          })
        })
      )
      setCardOptions(allCards)
    } catch (err) {
      console.error('Failed to load holders:', err)
    }
  }, [user])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryData, trendData, categoryData] = await Promise.all([
        getAnalyticsSummary({ holder_id: filters.holderId, display_currency: displayCurrency }),
        getMonthlyDebtTrend({ holder_id: filters.holderId, display_currency: displayCurrency }, filters.months),
        getCategoryBreakdown({ holder_id: filters.holderId }),
      ])

      setSummary(summaryData)
      setTrend(trendData)
      setCategoryBreakdown(categoryData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [filters, displayCurrency])

  useEffect(() => {
    loadHolders()
  }, [loadHolders])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 金额一律按折算目标币种渲染：历史上这里写死 ¥，把 USD/HKD 的合计显示成人民币
  const formatCurrency = (amount: number) => {
    return `${currencySymbol(displayCurrency)}${amount.toFixed(2)}`
  }

  const formatChartCurrency = (value: unknown) => {
    return formatCurrency(typeof value === 'number' ? value : Number(value) || 0)
  }

  const getRiskAlerts = () => {
    const alerts = []

    const utilization = summary?.utilization_rate
    // null 表示口径不齐（缺汇率）或没有可用额度，不该当成 0% 或高风险
    if (utilization != null && utilization > 70) {
      alerts.push(`额度使用率过高 (${utilization.toFixed(1)}%)`)
    }

    // 汇率缺失会让上面的合计不完整，必须显式提示，别让用户以为看到的是全部
    if (summary && !summary.fx_converted) {
      alerts.push(`部分外币未折算（缺汇率）：${summary.fx_unconverted_currencies.join('、')}`)
    }

    const overdueCount = summary?.overdue_count
    if (overdueCount != null && overdueCount > 0) {
      alerts.push(`有 ${overdueCount} 笔逾期账单`)
    }

    if (trend.length > 1) {
      const lastMonth = trend[trend.length - 1]
      const prevMonth = trend[trend.length - 2]
      if (lastMonth && prevMonth && lastMonth.bill_amount > prevMonth.bill_amount * 1.2) {
        alerts.push('上月消费激增')
      }
    }

    return alerts
  }

  return (
    <div className='px-4 pb-24 pt-3'>
      <div className='mb-4 flex items-center justify-between'>
        <h1 className='text-[22px] font-semibold leading-7 tracking-tight text-d-text'>
          消费与负债分析
        </h1>
        <button
          type='button'
          onClick={() => setExportOpen(true)}
          aria-label='导出数据'
          className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text active:bg-d-subtle'
        >
          <DownloadIcon size={20} />
        </button>
      </div>

      {/* Filters */}
      <div className='mb-4 flex gap-2'>
        <SelectField
          containerClassName='min-w-[120px] flex-1'
          value={String(filters.months)}
          onChange={e => setFilters({ ...filters, months: Number(e.target.value) })}
          options={[
            { value: '6', label: '近 6 个月' },
            { value: '12', label: '近 12 个月' },
          ]}
        />
        <SelectField
          containerClassName='min-w-[120px] flex-1'
          value={filters.holderId || 'all'}
          onChange={e => setFilters({ ...filters, holderId: e.target.value === 'all' ? undefined : e.target.value })}
          options={[
            { value: 'all', label: '全部持卡人' },
            ...holderOptions.map(h => ({ value: h.id, label: h.name })),
          ]}
        />
      </div>

      {error && (
        <div className='mb-4'>
          <Alert severity='error' action={
            <button
              type='button'
              onClick={loadData}
              className='h-8 rounded-full bg-d-danger px-3 text-[12px] font-semibold text-white'
            >
              重试
            </button>
          }>
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <div className='flex flex-col gap-4'>
          <Skeleton className='h-[100px] w-full' />
          <Skeleton className='h-[300px] w-full' />
          <Skeleton className='h-[300px] w-full' />
        </div>
      ) : summary && (
        <div className='flex flex-col gap-4'>
          {/* Risk Alerts */}
          {getRiskAlerts().length > 0 && (
            <Alert severity='warning'>
              <p className='mb-1 text-[15px] font-semibold leading-5'>风险提示</p>
              {getRiskAlerts().map((alert, i) => (
                <p key={i} className='text-[14px] leading-5'>• {alert}</p>
              ))}
            </Alert>
          )}

          {/* Summary Cards */}
          {/* 折算口径说明：明确合计数是折算结果、折算到哪个币种 */}
          <p className='mb-1 text-[14px] leading-[18px] text-d-muted'>
            金额已折算为 {summary.display_currency}
            {summary.fx_converted ? '' : `（未含汇率：${summary.fx_unconverted_currencies.join('、')}）`}
          </p>
          <div className='flex gap-2 overflow-x-auto pb-1'>
            {/* 横向滚动条里的卡片：shrink-0 让每个语义单元保持完整宽度，
                不让 flex 把「额度使用率」这类标签压到折行。 */}
            <div className='min-w-[140px] flex-1 shrink-0 rounded-2xl border border-d-border bg-d-surface p-3'>
              <p className='whitespace-nowrap text-[14px] leading-[18px] text-d-muted'>账单总额</p>
              <p className='num-tabular whitespace-nowrap text-[17px] font-bold leading-6 text-d-text'>
                {formatCurrency(summary.total_bill_amount)}
              </p>
            </div>
            <div className='min-w-[140px] flex-1 shrink-0 rounded-2xl border border-d-border bg-d-surface p-3'>
              <p className='whitespace-nowrap text-[14px] leading-[18px] text-d-muted'>待还金额</p>
              <p className='num-tabular whitespace-nowrap text-[17px] font-bold leading-6 text-d-danger-ink'>
                {formatCurrency(summary.pending_amount)}
              </p>
            </div>
            <div className='min-w-[140px] flex-1 shrink-0 rounded-2xl border border-d-border bg-d-surface p-3'>
              <p className='whitespace-nowrap text-[14px] leading-[18px] text-d-muted'>已还金额</p>
              <p className='num-tabular whitespace-nowrap text-[17px] font-bold leading-6 text-d-success-ink'>
                {formatCurrency(summary.paid_amount)}
              </p>
            </div>
            <div className='min-w-[140px] flex-1 shrink-0 rounded-2xl border border-d-border bg-d-surface p-3'>
              <p className='whitespace-nowrap text-[14px] leading-[18px] text-d-muted'>额度使用率</p>
              <p className={'num-tabular whitespace-nowrap text-[17px] font-bold leading-6 ' + ((summary.utilization_rate ?? 0) > 70 ? 'text-d-danger-ink' : 'text-d-text')}>
                {/* null = 口径不齐或没有可用额度，展示「—」而不是 0%，避免把未知说成宽裕 */}
                {summary.utilization_rate == null ? '—' : `${summary.utilization_rate.toFixed(1)}%`}
              </p>
            </div>
          </div>

          {/* Monthly Trend Chart */}
          <div className='rounded-2xl border border-d-border bg-d-surface p-3'>
            <p className='mb-3 text-[19px] font-semibold leading-6 text-d-text'>月度账单趋势</p>
            <ResponsiveContainer width='100%' height={250}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray='3 3' stroke='#26304a' />
                <XAxis dataKey='month' tick={AXIS_TICK} stroke='#26304a' />
                <YAxis tick={AXIS_TICK} stroke='#26304a' />
                <Tooltip
                  formatter={formatChartCurrency}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#9aa6bc' }}
                  itemStyle={{ color: '#f5f7fa' }}
                />
                <Legend wrapperStyle={{ color: '#9aa6bc' }} />
                <Line
                  type='monotone'
                  dataKey='bill_amount'
                  stroke='#7aadff'
                  name='账单金额'
                  strokeWidth={2}
                />
                <Line
                  type='monotone'
                  dataKey='paid_amount'
                  stroke='#6ee7a0'
                  name='已还金额'
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Category Breakdown Chart */}
          {categoryBreakdown.length > 0 && (
            <div className='rounded-2xl border border-d-border bg-d-surface p-3'>
              <p className='mb-3 text-[19px] font-semibold leading-6 text-d-text'>消费分类占比</p>
              <ResponsiveContainer width='100%' height={250}>
                <PieChart>
                  <Pie
                    data={categoryBreakdown}
                    cx='50%'
                    cy='50%'
                    labelLine={false}
                    label={(props: PieLabelRenderProps) => {
                      const p = props as unknown as { category?: string; percentage?: number }
                      return `${p.category ?? ''} ${Number(p.percentage || 0).toFixed(1)}%`
                    }}
                    outerRadius={80}
                    fill='#7aadff'
                    dataKey='amount'
                  >
                    {categoryBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={formatChartCurrency} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#f5f7fa' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Category List */}
          <div className='rounded-2xl border border-d-border bg-d-surface p-3'>
            <p className='mb-3 text-[19px] font-semibold leading-6 text-d-text'>分类详情</p>
            <div className='flex flex-col gap-2'>
              {categoryBreakdown.map((cat, i) => (
                <div key={cat.category} className='flex items-center justify-between'>
                  <span className='flex items-center gap-2'>
                    <span
                      className='h-3 w-3 shrink-0 rounded-full'
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className='text-[14px] leading-[18px] text-d-text'>{cat.category}</span>
                  </span>
                  <span className='num-tabular text-[14px] font-semibold leading-[18px] text-d-text'>
                    {formatCurrency(cat.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        holderId={filters.holderId || holderOptions[0]?.id || ''}
        holders={holders}
        cards={cardOptions}
      />
    </div>
  )
}
