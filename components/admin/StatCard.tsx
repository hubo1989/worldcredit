'use client'

import type { ReactNode } from 'react'

interface StatCardProps {
  icon: ReactNode
  label: string
  value: string | number
  subtitle?: string
  color: string // gradient start color
}

export function StatCard({ icon, label, value, subtitle, color }: StatCardProps) {
  return (
    <div className='flex items-start gap-4 rounded-2xl border border-d-border bg-d-surface p-4 transition-colors'>
      <span
        className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg'
        style={{
          background: `linear-gradient(135deg, ${color}33 0%, ${color}1a 100%)`,
          color,
        }}
      >
        {icon}
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-[12px] font-medium text-d-muted'>{label}</p>
        <p className='mt-0.5 text-[24px] font-semibold leading-[1.3] tabular-nums'>{value}</p>
        {subtitle && <p className='text-[11px] font-bold text-d-success-ink'>{subtitle}</p>}
      </div>
    </div>
  )
}
