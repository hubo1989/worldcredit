'use client'

import type { UserActivity } from '@/lib/api/dashboard'
import { UserPlusIcon, PaymentsIcon, CardIcon, BenefitIcon } from '@/components/icons/WcIcon'

const ACTIVITY_ITEMS = [
  { key: 'recentNewUsers' as const, label: '新增用户', icon: <UserPlusIcon size={18} />, color: '#818cf8' },
  { key: 'recentPayments' as const, label: '还款操作', icon: <PaymentsIcon size={18} />, color: '#34d399' },
  { key: 'recentCardOpenings' as const, label: '新开卡', icon: <CardIcon size={18} />, color: '#fbbf24' },
  { key: 'recentBenefitUsages' as const, label: '权益使用', icon: <BenefitIcon size={18} />, color: '#f472b6' },
]

interface UserActivityStatsProps {
  data: UserActivity
}

export function UserActivityStats({ data }: UserActivityStatsProps) {
  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-6'>
      <p className='mb-5 text-[15px] font-semibold'>近 7 天用户活跃度</p>

      <div className='flex flex-col gap-2'>
        {ACTIVITY_ITEMS.map((item) => {
          const count = data[item.key]
          return (
            <div
              key={item.key}
              className='flex items-center gap-4 rounded-xl bg-d-subtle/50 px-3 py-2.5 transition-colors hover:bg-d-subtle'
            >
              <span
                className='flex h-9 w-9 items-center justify-center rounded-lg'
                style={{ backgroundColor: `${item.color}26`, color: item.color }}
              >
                {item.icon}
              </span>
              <p className='flex-1 text-[13px] text-d-muted'>{item.label}</p>
              <p className='text-[18px] font-bold tabular-nums'>{count}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
