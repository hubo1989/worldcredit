'use client'

import { useMemo, useState } from 'react'
import { TextField } from '@/components/obsidian/fields'
import { currencySymbol } from '@/lib/fx'
import { addMonthsToPayablePeriod, billEffectiveStatementDate } from '@/lib/utils'
import {
  estimateBillRepaymentHealth,
  simulateRepaymentScenarios,
} from '@/lib/direction3/pure'
import type { BillItem, PaymentWithFx } from '@/lib/direction3/types'

interface Props {
  bill: {
    bill_month: string
    bill_amount: number
    bill_amount_override?: number | null
    min_payment?: number | null
    min_payment_override?: number | null
    statement_date?: string | null
    statement_date_override?: string | null
    statement_start?: string | null
    statement_end?: string | null
    due_date: string
    due_date_override?: string | null
  }
  cardType?: 'credit' | 'loan'
  currency: string
  items: BillItem[]
  payments: PaymentWithFx[]
}

export function BillRepaymentHealthCard({ bill, cardType, currency, items, payments }: Props) {
  const [simOpen, setSimOpen] = useState(false)
  const [simMode, setSimMode] = useState<'current' | 'min' | 'full' | 'custom'>('min')
  const [customPayText, setCustomPayText] = useState('')
  const [dailyRatePctText, setDailyRatePctText] = useState('0.05')

  const dailyRate = useMemo(() => {
    const pct = Number(dailyRatePctText)
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) return 0.0005
    return pct / 100
  }, [dailyRatePctText])

  const health = useMemo(
    () =>
      estimateBillRepaymentHealth({
        bill,
        cardType,
        items,
        payments,
        dailyRate,
      }),
    [bill, cardType, items, payments, dailyRate],
  )

  const nextStatementDate = useMemo(() => {
    const base =
      billEffectiveStatementDate(bill) || bill.statement_end || `${bill.bill_month}-01`
    const nextMonth = addMonthsToPayablePeriod(base.slice(0, 7), 1)
    return `${nextMonth}-${base.slice(8, 10) || '01'}`
  }, [bill])

  const simulation = useMemo(
    () =>
      simulateRepaymentScenarios(
        {
          bill,
          cardType,
          items,
          payments,
          dailyRate,
          customPayAmount: Number(customPayText) || 0,
        },
        nextStatementDate,
      ),
    [bill, cardType, items, payments, dailyRate, customPayText, nextStatementDate],
  )

  if (!health.applicable) return null

  const sym = currencySymbol(currency)

  const renderMinStatusBanner = () => {
    if (health.is_fully_paid) {
      return (
        <div className='rounded-xl bg-d-success-soft px-3 py-2 text-[12px] font-semibold text-d-success-ink'>
          已全额还清 · 预估循环利息 {sym}0.00
        </div>
      )
    }

    if (health.min_payment_status === 'unset') {
      return (
        <div className='rounded-xl bg-d-subtle px-3 py-2 text-[12px] text-d-muted'>
          未设置最低还款额（点「编辑金额与日期」可补充）
        </div>
      )
    }

    if (health.min_payment_status === 'covered') {
      return (
        <div className='rounded-xl bg-d-gold-soft px-3 py-2 text-[12px] font-semibold text-d-warn-ink'>
          最低还款已覆盖 · 仍欠 {sym}
          {health.remaining_amount.toLocaleString()}，按最低还款将产生循环利息
        </div>
      )
    }

    return (
      <div className='rounded-xl bg-d-danger-soft px-3 py-2 text-[12px] font-semibold text-d-danger-ink'>
        <p>
          未覆盖最低还款 · 尚差 {sym}
          {health.uncovered_min.toLocaleString()}
        </p>
        {health.is_overdue && (
          <p className='mt-0.5 text-[11px]'>
            已逾期且未足额还最低，可能产生逾期违约金并影响信用记录
          </p>
        )}
      </div>
    )
  }

  const activeSim =
    simMode === 'current'
      ? simulation.current
      : simMode === 'min'
        ? simulation.min_payment
        : simMode === 'full'
          ? simulation.full_payment
          : simulation.custom

  return (
    <div className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>还款健康与利息预估</p>
        <button
          type='button'
          onClick={() => setSimOpen((v) => !v)}
          className='min-h-[44px] px-1 text-[13px] font-semibold text-d-accent-light'
        >
          {simOpen ? '收起试算' : '还款利息试算'}
        </button>
      </div>

      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
        {renderMinStatusBanner()}

        <div className='mt-2.5 flex items-baseline justify-between gap-2'>
          <div>
            <p className='text-[12px] text-d-muted'>截至今日预估循环利息</p>
            <p className='mt-0.5 text-[11px] text-d-muted'>
              {health.tier === 'A_items'
                ? '档位 A：基于消费明细与 FIFO 还款冲抵'
                : '档位 B：当前账单未录入明细，以下为基于账单总额与出账日的估算利息（录入消费明细后可精确到单笔消费日）'}
            </p>
            {health.used_fallback_date && (
              <p className='mt-0.5 text-[11px] text-d-warn-ink'>
                部分明细缺少交易日期，已使用出账日/账单日估算起息
              </p>
            )}
          </div>
          <span
            className={
              'num-tabular shrink-0 text-[18px] font-bold ' +
              (health.estimated_interest > 0 ? 'text-d-warn-ink' : 'text-d-success-ink')
            }
          >
            {sym}
            {health.estimated_interest.toFixed(2)}
          </span>
        </div>

        {simOpen && (
          <div className='mt-3 border-t border-d-border pt-3'>
            <p className='mb-2 text-[12px] font-semibold text-d-text'>
              模拟下期滚动试算（截至 {nextStatementDate}）
            </p>
            <div className='grid grid-cols-2 gap-1.5 sm:grid-cols-4'>
              {[
                { key: 'current' as const, label: '按当前已还' },
                { key: 'min' as const, label: '按最低还款' },
                { key: 'full' as const, label: '全额还清' },
                { key: 'custom' as const, label: '自定义还款' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type='button'
                  onClick={() => setSimMode(opt.key)}
                  className={
                    'min-h-[44px] rounded-xl px-2.5 text-[12px] font-semibold transition-colors ' +
                    (simMode === opt.key
                      ? 'bg-d-accent text-white'
                      : 'border border-d-border bg-d-subtle text-d-muted')
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className='mt-2.5 grid grid-cols-2 gap-2.5'>
              <TextField
                label='测算日利率 (%)'
                type='number'
                inputMode='decimal'
                step='0.01'
                value={dailyRatePctText}
                onChange={(e) => setDailyRatePctText(e.target.value)}
                helperText='默认万分之五 (0.05%)'
              />
              {simMode === 'custom' && (
                <TextField
                  label={`今日追加还款 (${currency})`}
                  type='number'
                  inputMode='decimal'
                  step='0.01'
                  value={customPayText}
                  onChange={(e) => setCustomPayText(e.target.value)}
                  startAdornment={<span>{sym}</span>}
                />
              )}
            </div>

            <div className='mt-2.5 flex items-center justify-between rounded-xl bg-d-subtle px-3 py-2.5 text-[12px]'>
              <span className='text-d-muted'>模拟至下期出账日预估利息</span>
              <span className='num-tabular font-bold text-d-warn-ink'>
                {sym}
                {activeSim.estimated_interest.toFixed(2)}
              </span>
            </div>
            <div className='mt-1.5 flex items-center justify-between rounded-xl bg-d-subtle px-3 py-2 text-[12px]'>
              <span className='text-d-muted'>预计滚入下期本息合计</span>
              <span className='num-tabular font-bold text-d-text'>
                {sym}
                {(activeSim.remaining_amount + activeSim.estimated_interest).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
