'use client'

import type { ReactNode } from 'react'

/**
 * WorldCredit 状态徽章 / 来源徽章（暗色）。
 * 状态四色：绿已还 / 黄部分 / 红逾期 / 蓝待还。
 */

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  paid: { className: 'bg-d-success-soft text-d-success-ink', label: '已还' },
  partial: { className: 'bg-d-gold-soft text-d-warn-ink', label: '部分' },
  overdue: { className: 'bg-d-danger-soft text-d-danger-ink', label: '逾期' },
  unpaid: { className: 'bg-d-subtle text-d-accent-light', label: '待还' },
}

export function StatusBadge({ status, label, size = 'sm' }: { status: string; label?: string; size?: 'sm' | 'md' }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.unpaid
  const sizing = size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]'
  return (
    <span className={'inline-flex items-center whitespace-nowrap rounded-full font-semibold leading-snug ' + sizing + ' ' + cfg.className}>
      {label ?? cfg.label}
    </span>
  )
}

const SOURCE_STYLES: Record<string, { className: string; label: string }> = {
  email: { className: 'bg-d-subtle text-d-accent-light', label: '邮件' },
  manual: { className: 'bg-d-subtle text-d-muted', label: '手动' },
  ai: { className: 'bg-d-gold-soft text-d-warn-ink', label: 'AI' },
}

export function SourceBadge({ source, size = 'sm' }: { source: string; size?: 'sm' | 'md' }) {
  const cfg = SOURCE_STYLES[source] ?? SOURCE_STYLES.manual
  const sizing = size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]'
  return (
    <span className={'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-snug ' + sizing + ' ' + cfg.className}>
      {source === 'ai' && (
        <svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
          <path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z' />
        </svg>
      )}
      {cfg.label}
    </span>
  )
}

/** 通用胶囊徽章 */
export function PillBadge({ children, className = 'bg-d-subtle text-d-muted' }: { children: ReactNode; className?: string }) {
  return (
    <span className={'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug ' + className}>
      {children}
    </span>
  )
}
