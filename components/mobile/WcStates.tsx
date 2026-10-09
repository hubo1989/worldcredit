'use client'

import { RetryIcon } from '@/components/icons/WcIcon'
import type { ReactNode } from 'react'

/**
 * WorldCredit 通用状态组件：骨架屏 / 空态 / 错误态。
 * 走 ObsidianUI 暗色 token，不依赖 MUI。
 */

/** 骨架卡片（shimmer）。需放在 .obsidian-dashboard 内才会用暗色渐变。 */
export function WcSkeleton({ height = 96, count = 3, radius = 12 }: { height?: number; count?: number; radius?: number | string }) {
  const borderRadius = typeof radius === 'number' ? `${radius}px` : radius
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className='wc-skeleton mb-3 w-full'
          style={{ height, borderRadius }}
        />
      ))}
    </>
  )
}

/** 空态：插画色块 + 标题 + 说明 + CTA */
export function WcEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  icon?: ReactNode
}) {
  return (
    <div className='flex flex-col items-center justify-center px-6 py-12 text-center'>
      <div className='mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-d-subtle text-d-accent-light'>
        {icon ?? (
          <svg width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
            <path d='M3 10.5 12 3l9 7.5' />
            <path d='M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5' />
          </svg>
        )}
      </div>
      <p className='text-[17px] font-semibold leading-6 text-d-text'>{title}</p>
      {description && (
        <p className='mt-1 max-w-[280px] text-[13px] leading-5 text-d-muted'>{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          type='button'
          onClick={onAction}
          className='mt-4 h-10 rounded-full bg-d-accent px-5 text-sm font-semibold text-white'
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/** 错误态：原因 + 重试 */
export function WcErrorState({
  message,
  onRetry,
  retryLabel = '重试',
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className='rounded-2xl border border-d-danger/30 bg-d-danger-soft p-5 text-center'>
      <p className='text-[13px] leading-5 text-d-danger-ink'>{message}</p>
      {onRetry && (
        <button
          type='button'
          onClick={onRetry}
          className='mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-d-danger px-4 text-[13px] font-semibold text-white'
        >
          <RetryIcon size={16} />
          {retryLabel}
        </button>
      )}
    </div>
  )
}
