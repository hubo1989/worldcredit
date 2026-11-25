'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { currencySymbol } from '@/lib/fx'
import { getCashflowForecast } from '@/lib/direction3/rpc'
import type { CashflowForecastResult, CashflowHorizonDays } from '@/lib/direction3/types'

const AXIS_TICK = { fontSize: 11, fill: '#9aa6bc' }
const TOOLTIP_STYLE = {
  backgroundColor: '#131a2a',
  border: '1px solid #26304a',
  borderRadius: 12,
  color: '#f5f7fa',
}

const SOURCE_BADGES: Record<'bill' | 'installment' | 'payable', { label: string; cls: string }> = {
  bill: { label: '账单', cls: 'bg-d-subtle text-d-accent-light' },
  installment: { label: '分期', cls: 'bg-d-subtle text-d-warn-ink' },
  payable: { label: '固定支出', cls: 'bg-d-gold-soft text-d-gold' },
}

interface Props {
  holderId?: string
  displayCurrency: string
}

export function CashflowForecastSection({ holderId, displayCurrency }: Props) {
  const [horizon, setHorizon] = useState<CashflowHorizonDays>(30)
  const [forecast, setForecast] = useState<CashflowForecastResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadForecast = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getCashflowForecast({
        holder_id: holderId,
        horizon_days: horizon,
        display_currency: displayCurrency,
      })
      setForecast(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '现金流预测暂不可用')
      setForecast(null)
    } finally {
      setLoading(false)
    }
  }, [holderId, horizon, displayCurrency])

  useEffect(() => {
    void loadForecast()
  }, [loadForecast])

  const targetSym = currencySymbol(displayCurrency)

  return (
    <section id='cashflow' className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <div>
          <p className='text-[19px] font-semibold leading-6 text-d-text'>未来现金流预测</p>
          <p className='mt-0.5 text-[12px] text-d-muted'>
            聚合已出待还账单 · 活跃分期 · 周期固定支出
          </p>
        </div>
        <div className='flex gap-1 rounded-xl bg-d-subtle p-1'>
          {([30, 60, 90] as CashflowHorizonDays[]).map((days) => (
            <button
              key={days}
              type='button'
              onClick={() => setHorizon(days)}
              className={
                'h-11 rounded-lg px-3 text-[13px] font-semibold transition-colors ' +
                (horizon === days ? 'bg-d-accent text-white' : 'text-d-muted')
              }
            >
              {days} 天
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className='space-y-3'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-[220px] w-full' />
        </div>
      ) : error ? (
        <Alert severity='info'>{error}</Alert>
      ) : !forecast ? null : (
        <div className='flex flex-col gap-3'>
          {/* 逾期硬隔离警示 */}
          {forecast.overdue_alert.count > 0 && (
            <Alert severity='error'>
              <p className='font-semibold'>
                当前另有 {forecast.overdue_alert.count} 笔已逾期未还（
                {Object.entries(forecast.overdue_alert.by_currency)
                  .map(([cur, amt]) => `${cur} ${currencySymbol(cur)}${amt.toFixed(2)}`)
                  .join(' · ')}
                ），需立即处理
              </p>
              <p className='mt-0.5 text-[11px]'>逾期款项未计入下方未来 {horizon} 天预测</p>
            </Alert>
          )}

          {/* 原币种准备金汇总条（永远完整） */}
          {Object.keys(forecast.reserves_by_currency).length > 0 && (
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              {Object.entries(forecast.reserves_by_currency).map(([cur, res]) => {
                const sym = currencySymbol(cur)
                return (
                  <div
                    key={cur}
                    className='rounded-xl border border-d-border bg-d-subtle p-3'
                  >
                    <div className='flex items-baseline justify-between'>
                      <span className='text-[12px] font-semibold text-d-muted'>
                        {cur} 准备金
                      </span>
                      <span className='num-tabular text-[17px] font-bold text-d-text'>
                        {sym}
                        {res.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className='mt-1 text-[11px] text-d-muted'>
                      账单 {sym}
                      {res.bill.toFixed(0)} · 分期 {sym}
                      {res.installment.toFixed(0)} · 固定支出 {sym}
                      {res.payable.toFixed(0)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}

          {/* 折算目标币种参考合计 / 缺汇率降级提示 */}
          {forecast.converted_summary.converted ? (
            <p className='text-[13px] text-d-muted'>
              折合 {displayCurrency} 约{' '}
              <span className='num-tabular font-bold text-d-text'>
                {targetSym}
                {forecast.converted_summary.total.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
              （按当前参考汇率）
            </p>
          ) : (
            <Alert severity='warning'>
              缺汇率币种（{forecast.converted_summary.unconverted_currencies.join('、')}
              ）未计入折算总计，请以上方原币分列为准（已折算部分：{targetSym}
              {forecast.converted_summary.total.toFixed(2)}）
            </Alert>
          )}

          {forecast.timeline.length === 0 ? (
            <div className='rounded-xl bg-d-subtle px-4 py-6 text-center'>
              <p className='text-[14px] font-semibold text-d-text'>
                未来 {horizon} 天暂无到期应还 · 资金宽裕
              </p>
            </div>
          ) : (
            <>
              {/* 堆叠柱状图 */}
              <ResponsiveContainer width='100%' height={220}>
                <BarChart data={forecast.buckets}>
                  <CartesianGrid strokeDasharray='3 3' stroke='#26304a' />
                  <XAxis dataKey='label' tick={AXIS_TICK} stroke='#26304a' />
                  <YAxis tick={AXIS_TICK} stroke='#26304a' />
                  <Tooltip
                    formatter={(value: unknown) => `${targetSym}${Number(value || 0).toFixed(2)}`}
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: '#9aa6bc' }}
                  />
                  <Legend wrapperStyle={{ color: '#9aa6bc', fontSize: 12 }} />
                  <Bar dataKey='bill' stackId='a' fill='#7aadff' name='账单待还' />
                  <Bar dataKey='installment' stackId='a' fill='#c4a5ff' name='分期应还' />
                  <Bar dataKey='payable' stackId='a' fill='#ffc46b' name='固定支出' />
                </BarChart>
              </ResponsiveContainer>

              {/* 到期流水列表 */}
              <div className='flex flex-col gap-1.5'>
                {forecast.timeline.map((item) => {
                  const source = item.source ?? item.source_type ?? 'bill'
                  const refId = item.ref_id ?? item.source_id ?? item.id ?? ''
                  const badge = SOURCE_BADGES[source] ?? {
                    label: String(source || '待还'),
                    cls: 'bg-d-subtle text-d-muted',
                  }
                  const sym = currencySymbol(item.currency)
                  const itemKey = `${source}:${refId}:${item.due_date}:${item.period ?? ''}`
                  const href =
                    source === 'bill' && refId
                      ? `/bills/${refId}`
                      : source === 'installment' && item.card_id
                        ? `/cards/${item.card_id}`
                        : null

                  const content = (
                    <div className='flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-d-subtle px-3 py-2'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <span
                            className={
                              'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' +
                              badge.cls
                            }
                          >
                            {source === 'installment' &&
                            item.period_index != null &&
                            item.total_periods != null
                              ? `分期 ${item.period_index}/${item.total_periods}`
                              : badge.label}
                          </span>
                          <span className='truncate text-[13px] font-semibold text-d-text'>
                            {item.title}
                          </span>
                        </div>
                        <p className='mt-0.5 truncate text-[11px] text-d-muted'>
                          {item.due_date} ·{' '}
                          {item.days_until_due === 0
                            ? '今天到期'
                            : `${item.days_until_due} 天后`}
                          {item.card_tail ? ` · 尾号 ${item.card_tail}` : ''}
                          {item.holder_name ? ` · ${item.holder_name}` : ''}
                          {item.subtitle ? ` · ${item.subtitle}` : ''}
                        </p>
                      </div>
                      <span className='num-tabular shrink-0 text-[14px] font-bold text-d-text'>
                        {sym}
                        {Number(item.amount).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )

                  return href ? (
                    <Link key={itemKey} href={href} className='block'>
                      {content}
                    </Link>
                  ) : (
                    <div key={itemKey}>{content}</div>
                  )
                })}
              </div>
            </>
          )}

          <p className='text-[11px] leading-4 text-d-muted'>
            预测基于已出待还账单、已登记分期计划及周期固定支出，不含未出账周期的新增消费。
          </p>
        </div>
      )}
    </section>
  )
}
