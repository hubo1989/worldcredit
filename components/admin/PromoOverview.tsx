'use client'

import type { PromoItem } from '@/lib/api/dashboard'
import { PromoIcon, CheckIcon, XCircleIcon } from '@/components/icons/WcIcon'

interface PromoOverviewProps {
  data: PromoItem[]
}

const DISCOUNT_COLORS: Record<string, string> = {
  满减: '#fbbf24',
  折扣: '#34d399',
  积分: '#818cf8',
  返现: '#f472b6',
}

export function PromoOverview({ data }: PromoOverviewProps) {
  const activeCount = data.filter((p) => p.is_active).length

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-6'>
      <div className='mb-5'>
        <p className='text-[15px] font-semibold'>优惠活动</p>
        <p className='text-[12px] text-d-muted'>
          进行中 {activeCount} · 共 {data.length}
        </p>
      </div>

      {data.length === 0 ? (
        <div className='py-8 text-center'>
          <PromoIcon size={40} className='mx-auto mb-2 text-d-border' />
          <p className='text-[13px] text-d-muted'>暂无优惠活动</p>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {data.slice(0, 6).map((promo) => {
            const discountColor = DISCOUNT_COLORS[promo.discount_type ?? ''] || '#9aa6bc'
            return (
              <div
                key={promo.id}
                className='flex items-center gap-4 rounded-xl border border-d-border/60 bg-d-subtle/50 p-4 transition-colors hover:border-d-border'
              >
                <div className='min-w-0 flex-1'>
                  <div className='mb-1 flex items-center gap-1.5'>
                    <p className='truncate text-[13px] font-medium'>{promo.title}</p>
                    {promo.is_active ? (
                      <CheckIcon size={14} className='shrink-0 text-d-success-ink' />
                    ) : (
                      <XCircleIcon size={14} className='shrink-0 text-d-muted' />
                    )}
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-[11px] text-d-muted'>{promo.bank_name}</span>
                    {promo.discount_type ? (
                      <span
                        className='rounded-md px-1.5 py-0.5 text-[10px] font-semibold'
                        style={{ backgroundColor: `${discountColor}26`, color: discountColor }}
                      >
                        {promo.discount_type}
                      </span>
                    ) : null}
                    {promo.end_date ? (
                      <span className='text-[11px] text-d-muted'>截止 {promo.end_date}</span>
                    ) : null}
                  </div>
                </div>
                <div className='shrink-0 text-right'>
                  <p className='text-[15px] font-bold tabular-nums'>{promo.usage_count}</p>
                  <p className='text-[10px] text-d-muted'>已使用</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
