'use client'

import type { BenefitStat } from '@/lib/api/dashboard'

interface BenefitOverviewProps {
  data: BenefitStat[]
}

const PERIOD_LABEL: Record<string, string> = {
  yearly: '年度',
  monthly: '月度',
  one_time: '一次性',
}

const PERIOD_COLOR: Record<string, string> = {
  yearly: '#818cf8',
  monthly: '#34d399',
  one_time: '#fbbf24',
}

export function BenefitOverview({ data }: BenefitOverviewProps) {
  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-6'>
      <p className='mb-5 text-[15px] font-semibold'>权益使用概览</p>

      {data.length === 0 ? (
        <p className='py-8 text-center text-[13px] text-d-muted'>暂无权益数据</p>
      ) : (
        <div className='flex flex-col gap-4'>
          {data.map((b) => {
            const usageRate = b.quota > 0 ? Math.min((b.usage_count / b.quota) * 100, 100) : 0
            const periodColor = PERIOD_COLOR[b.period] || '#9aa6bc'

            return (
              <div key={b.id} className='rounded-xl border border-d-border/60 bg-d-subtle/50 p-4'>
                <div className='mb-2 flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <p className='text-[13px] font-medium'>{b.name}</p>
                    <span
                      className='rounded-md px-1.5 py-0.5 text-[10px] font-semibold'
                      style={{ backgroundColor: `${periodColor}26`, color: periodColor }}
                    >
                      {PERIOD_LABEL[b.period] || b.period}
                    </span>
                  </div>
                  <p className='text-[11px] tabular-nums text-d-muted'>
                    {b.usage_count}/{b.quota}
                  </p>
                </div>

                <div
                  className='mb-2 h-1.5 w-full overflow-hidden rounded-full bg-d-border'
                  role='progressbar'
                  aria-valuenow={Math.round(usageRate)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className='h-full rounded-full transition-[width] duration-300'
                    style={{
                      width: `${usageRate}%`,
                      background: `linear-gradient(90deg, ${periodColor}, ${periodColor}cc)`,
                    }}
                  />
                </div>

                <p className='text-[11px] text-d-muted'>
                  {b.bank_name} · {b.card_product_name}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
