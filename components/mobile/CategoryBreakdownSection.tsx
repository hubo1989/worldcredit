'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { BottomSheet } from '@/components/obsidian/overlays'
import { CheckRow, Toggle } from '@/components/obsidian/controls'
import { SelectField } from '@/components/obsidian/fields'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { currencySymbol } from '@/lib/fx'
import { categoryLabel } from '@/lib/direction3/pure'
import { getCategoryDrilldownItems, updateBillItem } from '@/lib/direction3/rpc'
import {
  SPEND_CATEGORIES,
  SPEND_CATEGORY_LABELS,
  type CategoryBreakdownItem,
  type CategoryBreakdownNormalized,
  type CategoryDrilldownItem,
  type SpendCategory,
} from '@/lib/direction3/types'

const COLORS = [
  '#7aadff',
  '#6ee7a0',
  '#ffc46b',
  '#ff8a8a',
  '#c4a5ff',
  '#5fd4d0',
  '#f0c75e',
  '#93c5fd',
  '#f9a8d4',
  '#a5b4fc',
]

const TOOLTIP_STYLE = {
  backgroundColor: '#131a2a',
  border: '1px solid #26304a',
  borderRadius: 12,
  color: '#f5f7fa',
}

const CATEGORY_OPTIONS = [
  { value: '', label: '未分类' },
  ...SPEND_CATEGORIES.map((c) => ({ value: c, label: SPEND_CATEGORY_LABELS[c] })),
]

interface Props {
  breakdown: CategoryBreakdownNormalized
  displayCurrency: string
  filters: {
    holder_id?: string
    from_month?: string
    to_month?: string
  }
  includeFees: boolean
  onToggleIncludeFees: (next: boolean) => void
  onRefresh: () => Promise<void> | void
}

export function CategoryBreakdownSection({
  breakdown,
  displayCurrency,
  filters,
  includeFees,
  onToggleIncludeFees,
  onRefresh,
}: Props) {
  const [drillCategory, setDrillCategory] = useState<CategoryBreakdownItem | null>(null)
  const [drillItems, setDrillItems] = useState<CategoryDrilldownItem[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)
  const [rememberMerchant, setRememberMerchant] = useState(true)
  const [savingItemId, setSavingItemId] = useState<string | null>(null)

  const sym = currencySymbol(displayCurrency)
  const formatCurrency = (val: number) => `${sym}${val.toFixed(2)}`

  const openDrilldown = async (cat: CategoryBreakdownItem) => {
    setDrillCategory(cat)
    setDrillLoading(true)
    setDrillError(null)
    try {
      const items = await getCategoryDrilldownItems({
        ...filters,
        display_currency: displayCurrency,
        category: cat.category === 'uncategorized' ? null : cat.category,
        include_fees: includeFees,
      })
      setDrillItems(Array.isArray(items) ? items : [])
    } catch (err) {
      setDrillError(err instanceof Error ? err.message : '加载分类明细失败')
      setDrillItems([])
    } finally {
      setDrillLoading(false)
    }
  }

  const handleReclassify = async (item: CategoryDrilldownItem, nextCategory: string) => {
    setSavingItemId(item.id)
    setDrillError(null)
    try {
      await updateBillItem(item.id, {
        category: nextCategory ? (nextCategory as SpendCategory) : null,
        remember_merchant: rememberMerchant && Boolean(nextCategory),
      })
      await onRefresh()
      if (drillCategory) {
        const refreshed = await getCategoryDrilldownItems({
          ...filters,
          display_currency: displayCurrency,
          category: drillCategory.category === 'uncategorized' ? null : drillCategory.category,
          include_fees: includeFees,
        })
        setDrillItems(Array.isArray(refreshed) ? refreshed : [])
      }
    } catch (err) {
      setDrillError(err instanceof Error ? err.message : '更新分类失败')
    } finally {
      setSavingItemId(null)
    }
  }

  const unallocatedEntries = Object.entries(breakdown.unallocated_refunds_by_currency).filter(
    ([, amt]) => Math.abs(amt) > 0.01,
  )

  return (
    <>
      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
          <div>
            <p className='text-[19px] font-semibold leading-6 text-d-text'>消费分类分析</p>
            {breakdown.total_bills > 0 && (
              <p className='mt-0.5 text-[12px] text-d-muted'>
                统计基于已录入明细的 {breakdown.covered_bills}/{breakdown.total_bills} 张账单
              </p>
            )}
          </div>
          <label className='flex min-h-[44px] items-center gap-2 text-[12px] text-d-muted'>
            <span>含利息/费用</span>
            <Toggle
              checked={includeFees}
              onChange={onToggleIncludeFees}
              ariaLabel='含利息和费用'
            />
          </label>
        </div>

        {!breakdown.fx_converted && breakdown.fx_unconverted_currencies.length > 0 && (
          <div className='mb-3'>
            <Alert severity='warning'>
              以下币种暂缺汇率，未纳入占比折算：{breakdown.fx_unconverted_currencies.join('、')}（已保留在分项原币明细中）
            </Alert>
          </div>
        )}

        {breakdown.items.length === 0 ? (
          <div className='rounded-xl border border-dashed border-d-border bg-d-subtle px-4 py-6 text-center'>
            <p className='text-[14px] font-semibold text-d-text'>暂无交易明细数据</p>
            <p className='mt-1.5 text-[12px] leading-5 text-d-muted'>
              交易明细为轻量可选项，前往任意账单详情补录或导入 CSV 明细后即可查看分类占比
            </p>
            <Link
              href='/bills'
              className='mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-d-accent px-5 text-[13px] font-semibold text-white'
            >
              去账单页补录
            </Link>
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            <ResponsiveContainer width='100%' height={240}>
              <PieChart>
                <Pie
                  data={breakdown.items}
                  cx='50%'
                  cy='50%'
                  labelLine={false}
                  label={(props: PieLabelRenderProps) => {
                    const p = props as unknown as CategoryBreakdownItem
                    const label = p.category_label || categoryLabel(p.category)
                    return `${label} ${Number(p.percentage || 0).toFixed(1)}%`
                  }}
                  outerRadius={80}
                  fill='#7aadff'
                  dataKey='amount'
                  onClick={(_, index) => {
                    const cat = breakdown.items[index]
                    if (cat) void openDrilldown(cat)
                  }}
                >
                  {breakdown.items.map((entry, index) => (
                    <Cell
                      key={entry.category}
                      fill={COLORS[index % COLORS.length]}
                      className='cursor-pointer'
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown) => formatCurrency(Number(value) || 0)}
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: '#f5f7fa' }}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className='flex flex-col gap-1.5'>
              {breakdown.items.map((cat, i) => {
                const label = cat.category_label || categoryLabel(cat.category)
                const currencyEntries = Object.entries(cat.by_currency ?? {}).filter(
                  ([, amt]) => Math.abs(amt) > 0.005,
                )
                return (
                  <button
                    key={cat.category}
                    type='button'
                    onClick={() => void openDrilldown(cat)}
                    className='flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl bg-d-subtle px-3 py-2 text-left transition-colors active:bg-d-border/40'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <span
                          className='h-3 w-3 shrink-0 rounded-full'
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className='truncate text-[14px] font-semibold text-d-text'>
                          {label}
                        </span>
                        {cat.item_count != null && (
                          <span className='shrink-0 text-[11px] text-d-muted'>
                            {cat.item_count} 笔
                          </span>
                        )}
                      </div>
                      {currencyEntries.length > 0 && (
                        <p className='mt-0.5 pl-5 text-[11px] text-d-muted'>
                          原币：
                          {currencyEntries
                            .map(([cur, amt]) => `${cur} ${currencySymbol(cur)}${amt.toFixed(2)}`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className='shrink-0 text-right'>
                      <p className='num-tabular text-[14px] font-semibold text-d-text'>
                        {formatCurrency(cat.amount)}
                      </p>
                      <p className='num-tabular text-[11px] text-d-muted'>
                        {Number(cat.percentage || 0).toFixed(1)}% ›
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {unallocatedEntries.length > 0 && (
              <p className='text-[12px] text-d-muted'>
                未归类退款抵扣：
                {unallocatedEntries
                  .map(([cur, amt]) => `${cur} ${currencySymbol(cur)}${Math.abs(amt).toFixed(2)}`)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 分类下钻明细抽屉 */}
      <BottomSheet
        open={drillCategory !== null}
        onClose={() => setDrillCategory(null)}
        title={
          drillCategory
            ? `${drillCategory.category_label || categoryLabel(drillCategory.category)} · 明细下钻`
            : '分类明细'
        }
      >
        <div className='flex flex-col gap-3'>
          {drillError && <Alert severity='error'>{drillError}</Alert>}
          <CheckRow checked={rememberMerchant} onChange={setRememberMerchant}>
            <span>修改分类时自动记住该商户归类规则</span>
          </CheckRow>

          {drillLoading ? (
            <div className='space-y-2'>
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-16 w-full' />
            </div>
          ) : drillItems.length === 0 ? (
            <p className='py-6 text-center text-[13px] text-d-muted'>暂无该分类下的明细记录</p>
          ) : (
            <div className='flex flex-col gap-2.5'>
              {drillItems.map((item) => {
                const itemSym = currencySymbol(item.currency)
                const isRefund = item.item_type === 'refund'
                return (
                  <div
                    key={item.id}
                    className='rounded-xl border border-d-border bg-d-subtle p-3'
                  >
                    <div className='flex items-start justify-between gap-2'>
                      <div className='min-w-0 flex-1'>
                        <Link
                          href={`/bills/${item.bill_id}`}
                          className='block truncate text-[14px] font-semibold text-d-accent-light underline-offset-2 hover:underline'
                        >
                          {item.merchant_name || item.description}
                        </Link>
                        <p className='mt-0.5 text-[11px] text-d-muted'>
                          {item.transaction_date?.slice(0, 10) || item.bill_month || '—'}
                          {item.bank_name || item.card_name
                            ? ` · ${item.bank_name ?? ''} ${item.card_name ?? ''}`
                            : ''}
                        </p>
                      </div>
                      <span
                        className={
                          'num-tabular shrink-0 text-[14px] font-bold ' +
                          (isRefund ? 'text-d-success-ink' : 'text-d-text')
                        }
                      >
                        {isRefund ? `-${itemSym}` : itemSym}
                        {Number(item.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className='mt-2'>
                      <SelectField
                        aria-label={`修改 ${item.description} 分类`}
                        disabled={savingItemId === item.id}
                        value={item.category ?? ''}
                        onChange={(e) => void handleReclassify(item, e.target.value)}
                        options={CATEGORY_OPTIONS}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
