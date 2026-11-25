'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/obsidian/controls'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { ChevronLeftIcon } from '@/components/icons/WcIcon'
import { currencySymbol } from '@/lib/fx'
import { categoryLabel } from '@/lib/direction3/pure'
import { getStatementReport } from '@/lib/direction3/rpc'
import type { FamilyStatementReport } from '@/lib/direction3/types'

interface StatementQuery {
  mode: 'monthly' | 'annual'
  period: string
  scope: 'family' | 'holder'
  holderId?: string
  cardId?: string
  displayCurrency: string
}

export default function StatementPrintPage() {
  const router = useRouter()
  const [queryState, setQueryState] = useState<StatementQuery | null>(null)
  const [report, setReport] = useState<FamilyStatementReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode') === 'annual' ? 'annual' : 'monthly'
    const now = new Date()
    const defaultPeriod =
      mode === 'annual'
        ? String(now.getFullYear())
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const period = params.get('period') || defaultPeriod
    const scope = params.get('scope') === 'family' ? 'family' : 'holder'
    const holderId = params.get('holderId') || undefined
    const cardId = params.get('cardId') || undefined
    const displayCurrency = params.get('currency') || 'CNY'
    setQueryState({ mode, period, scope, holderId, cardId, displayCurrency })
  }, [])

  useEffect(() => {
    if (!queryState) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getStatementReport({
      mode: queryState.mode,
      period: queryState.period,
      scope: queryState.scope,
      holder_id: queryState.holderId,
      card_id: queryState.cardId,
      display_currency: queryState.displayCurrency,
    })
      .then((res) => {
        if (!cancelled) setReport(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载对账单失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [queryState])

  const targetSym = currencySymbol(report?.display_currency || queryState?.displayCurrency || 'CNY')

  return (
    <div className='min-h-dvh bg-d-bg px-4 pb-24 pt-3 text-d-text print:bg-white print:p-0 print:text-black'>
      <style>{`
        @media print {
          nav, .no-print { display: none !important; }
          body, html { background: #ffffff !important; color: #111827 !important; padding-top: 0 !important; }
          .print-statement-sheet {
            background: #ffffff !important;
            color: #111827 !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          .print-section { break-inside: avoid; page-break-inside: avoid; }
          .print-table th, .print-table td { border-color: #d1d5db !important; color: #111827 !important; }
        }
      `}</style>

      <div className='no-print mb-4 flex items-center justify-between gap-2'>
        <button
          type='button'
          onClick={() => router.back()}
          aria-label='返回'
          className='flex h-11 items-center gap-1 rounded-xl border border-d-border bg-d-surface px-3 text-[13px] font-semibold text-d-text'
        >
          <ChevronLeftIcon size={18} />
          返回
        </button>
        <Button onClick={() => window.print()} disabled={loading || !report}>
          打印 / 存为 PDF
        </Button>
      </div>

      {loading ? (
        <div className='space-y-3'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-48 w-full' />
        </div>
      ) : error ? (
        <Alert severity='error'>{error}</Alert>
      ) : !report ? (
        <div className='rounded-2xl border border-d-border bg-d-surface p-6 text-center'>
          <p className='text-[14px] font-semibold text-d-text'>所选范围暂无对账单数据</p>
        </div>
      ) : (
        <div className='print-statement-sheet mx-auto max-w-3xl rounded-2xl border border-d-border bg-white p-5 text-slate-900 shadow-sm'>
          <header className='border-b border-slate-200 pb-4'>
            <div className='flex flex-wrap items-start justify-between gap-2'>
              <div>
                <p className='text-[12px] font-semibold uppercase tracking-wider text-slate-500'>
                  WorldCredit Statement
                </p>
                <h1 className='mt-1 text-[22px] font-bold text-slate-900'>
                  {report.scope === 'family'
                    ? '全家庭合并'
                    : report.holders?.[0]?.holder_name || '个人持卡人'}{' '}
                  · {report.mode === 'monthly' ? '月度对账单' : '年度对账单'}
                </h1>
              </div>
              <div className='text-right text-[12px] text-slate-600'>
                <p>统计周期：{report.period_start} 至 {report.period_end}</p>
                <p>账期标识：{report.period}</p>
              </div>
            </div>
          </header>

          {/* 分币种总览 */}
          <section className='print-section mt-4'>
            <h2 className='mb-2 text-[15px] font-bold text-slate-900'>分币种账务总览</h2>
            {Object.keys(report.totals_by_currency ?? {}).length === 0 ? (
              <p className='text-[13px] text-slate-500'>所选范围暂无账单记录</p>
            ) : (
              <div className='overflow-x-auto'>
                <table className='print-table w-full border-collapse text-left text-[12px]'>
                  <thead>
                    <tr className='border-b border-slate-300 bg-slate-50 text-slate-700'>
                      <th className='px-2 py-2'>原币种</th>
                      <th className='px-2 py-2 text-right'>账单总额</th>
                      <th className='px-2 py-2 text-right'>已还金额</th>
                      <th className='px-2 py-2 text-right'>剩余待还</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.totals_by_currency ?? {}).map(([cur, row]) => {
                      const sym = currencySymbol(cur)
                      return (
                        <tr key={cur} className='border-b border-slate-200'>
                          <td className='px-2 py-2 font-semibold'>{cur}</td>
                          <td className='num-tabular px-2 py-2 text-right'>
                            {sym}{Number(row.billed).toFixed(2)}
                          </td>
                          <td className='num-tabular px-2 py-2 text-right'>
                            {sym}{Number(row.paid).toFixed(2)}
                          </td>
                          <td className='num-tabular px-2 py-2 text-right'>
                            {sym}{Number(row.outstanding).toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className='mt-3 rounded-lg bg-slate-100 px-3 py-2 text-[12px] text-slate-700'>
              <p className='font-semibold'>
                折合 {report.display_currency} 参考合计：
                账单 {targetSym}{Number(report.converted_totals?.billed ?? 0).toFixed(2)} ·
                已还 {targetSym}{Number(report.converted_totals?.paid ?? 0).toFixed(2)} ·
                待还 {targetSym}{Number(report.converted_totals?.outstanding ?? 0).toFixed(2)}
              </p>
              {report.converted_totals &&
                !report.converted_totals.fx_converted &&
                report.converted_totals.fx_unconverted_currencies.length > 0 && (
                  <p className='mt-0.5 text-amber-700'>
                    注意：以下币种缺汇率未计入折算合计：
                    {report.converted_totals.fx_unconverted_currencies.join('、')}
                  </p>
                )}
            </div>
          </section>

          {/* 持卡人汇总 */}
          {report.holders && report.holders.length > 0 && (
            <section className='print-section mt-5'>
              <h2 className='mb-2 text-[15px] font-bold text-slate-900'>持卡人账务汇总（{report.display_currency} 口径）</h2>
              <div className='overflow-x-auto'>
                <table className='print-table w-full border-collapse text-left text-[12px]'>
                  <thead>
                    <tr className='border-b border-slate-300 bg-slate-50 text-slate-700'>
                      <th className='px-2 py-2'>持卡人</th>
                      <th className='px-2 py-2 text-right'>账单数</th>
                      <th className='px-2 py-2 text-right'>账单合计</th>
                      <th className='px-2 py-2 text-right'>已还（含锁汇）</th>
                      <th className='px-2 py-2 text-right'>剩余待还</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.holders.map((h) => (
                      <tr key={h.holder_id} className='border-b border-slate-200'>
                        <td className='px-2 py-1.5 font-semibold'>{h.holder_name}</td>
                        <td className='num-tabular px-2 py-1.5 text-right'>{h.bill_count}</td>
                        <td className='num-tabular px-2 py-1.5 text-right'>{targetSym}{Number(h.total_billed).toFixed(2)}</td>
                        <td className='num-tabular px-2 py-1.5 text-right'>{targetSym}{Number(h.total_paid).toFixed(2)}</td>
                        <td className='num-tabular px-2 py-1.5 text-right'>{targetSym}{Number(h.outstanding).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 账单明细清单 */}
          {report.bills && report.bills.length > 0 && (
            <section className='print-section mt-5'>
              <h2 className='mb-2 text-[15px] font-bold text-slate-900'>账单明细清单</h2>
              <div className='overflow-x-auto'>
                <table className='print-table w-full border-collapse text-left text-[12px]'>
                  <thead>
                    <tr className='border-b border-slate-300 bg-slate-50 text-slate-700'>
                      <th className='px-2 py-2'>账期</th>
                      <th className='px-2 py-2'>持卡人</th>
                      <th className='px-2 py-2'>银行 / 卡片</th>
                      <th className='px-2 py-2'>币种</th>
                      <th className='px-2 py-2 text-right'>账单金额</th>
                      <th className='px-2 py-2'>还款截止日</th>
                      <th className='px-2 py-2'>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bills.map((b) => {
                      const sym = currencySymbol(b.currency)
                      return (
                        <tr key={b.id} className='border-b border-slate-200'>
                          <td className='px-2 py-1.5'>{b.bill_month}</td>
                          <td className='px-2 py-1.5'>{b.holder_name}</td>
                          <td className='px-2 py-1.5'>
                            {b.bank_name ?? ''} {b.card_name ?? ''}
                            {b.card_tail ? ` (${b.card_tail})` : ''}
                          </td>
                          <td className='px-2 py-1.5'>{b.currency}</td>
                          <td className='num-tabular px-2 py-1.5 text-right'>{sym}{Number(b.bill_amount).toFixed(2)}</td>
                          <td className='px-2 py-1.5'>{b.due_date}</td>
                          <td className='px-2 py-1.5 text-[11px] text-slate-600'>{b.status}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 消费分类汇总 */}
          <section className='print-section mt-5'>
            <h2 className='mb-2 text-[15px] font-bold text-slate-900'>消费分类汇总</h2>
            {!report.category_breakdown || report.category_breakdown.length === 0 ? (
              <p className='text-[12px] text-slate-500'>无消费明细记录</p>
            ) : (
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                {report.category_breakdown.map((cat) => (
                  <div
                    key={cat.category}
                    className='rounded-lg border border-slate-200 px-3 py-2 text-[12px]'
                  >
                    <p className='font-semibold text-slate-800'>
                      {cat.category_label || categoryLabel(cat.category)}
                    </p>
                    <p className='num-tabular text-slate-600'>
                      {targetSym}{Number(cat.amount).toFixed(2)} ({Number(cat.percentage).toFixed(1)}%)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 分期与固定支出摘要 */}
          {report.installments && report.installments.length > 0 && (
            <section className='print-section mt-5'>
              <h2 className='mb-2 text-[15px] font-bold text-slate-900'>分期计划摘要</h2>
              <ul className='space-y-1 text-[12px] text-slate-700'>
                {report.installments.map((inst) => (
                  <li key={inst.id}>
                    {inst.holder_name ? `${inst.holder_name} · ` : ''}
                    {inst.bank_name ?? ''} {inst.card_name ?? ''} — {inst.title}（{inst.paid_periods}/{inst.total_periods} 期，剩余本金 {currencySymbol(inst.currency)}{Number(inst.remaining_principal).toFixed(2)}）
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.payables && report.payables.length > 0 && (
            <section className='print-section mt-5'>
              <h2 className='mb-2 text-[15px] font-bold text-slate-900'>固定支出摘要</h2>
              <ul className='space-y-1 text-[12px] text-slate-700'>
                {report.payables.map((p) => (
                  <li key={p.id}>
                    {p.holder_name ? `${p.holder_name} · ` : ''}
                    {p.name}：{currencySymbol(p.currency)}{Number(p.amount).toFixed(2)}（已付 {currencySymbol(p.currency)}{Number(p.paid_amount).toFixed(2)} · 截止 {p.due_date} · {p.status}）
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
