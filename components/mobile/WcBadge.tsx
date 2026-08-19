'use client'

import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * WorldCredit 状态徽章 / 来源徽章。
 * 状态四色：绿已还 / 黄部分 / 红逾期 / 蓝待还（§7.3）。
 */

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  paid:    { bg: 'rgba(22,163,74,0.12)',  fg: '#16A34A', label: '已还' },
  partial: { bg: 'rgba(252,185,0,0.16)',  fg: '#9A7000', label: '部分' },
  overdue: { bg: 'rgba(207,46,46,0.12)',  fg: '#CF2E2E', label: '逾期' },
  unpaid:  { bg: 'rgba(37,99,235,0.10)',  fg: '#2563EB', label: '待还' },
}

export function StatusBadge({ status, label, size = 'sm' }: { status: string; label?: string; size?: 'sm' | 'md' }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.unpaid
  const px = size === 'md' ? 1.5 : 1
  const py = size === 'md' ? 0.5 : 0.25
  const fs = size === 'md' ? 12 : 11
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        bgcolor: cfg.bg,
        color: cfg.fg,
        borderRadius: 'var(--radius-pill)',
        px,
        py,
        fontSize: fs,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {label ?? cfg.label}
    </Box>
  )
}

const SOURCE_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  email:  { bg: 'rgba(37,99,235,0.10)',  fg: '#2563EB', label: '邮件' },
  manual: { bg: 'rgba(91,100,120,0.12)', fg: '#5B6478', label: '手动' },
  ai:     { bg: 'rgba(201,162,39,0.16)', fg: '#8A6D1F', label: 'AI' },
}

export function SourceBadge({ source, size = 'sm' }: { source: string; size?: 'sm' | 'md' }) {
  const cfg = SOURCE_STYLES[source] ?? SOURCE_STYLES.manual
  const px = size === 'md' ? 1.5 : 1
  const py = size === 'md' ? 0.5 : 0.25
  const fs = size === 'md' ? 12 : 11
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: cfg.bg,
        color: cfg.fg,
        borderRadius: 'var(--radius-pill)',
        px,
        py,
        fontSize: fs,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {source === 'ai' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
        </svg>
      )}
      {cfg.label}
    </Box>
  )
}

/** 通用胶囊徽章 */
export function PillBadge({ children, color = '#5B6478', bg = 'rgba(91,100,120,0.10)' }: { children: ReactNode; color?: string; bg?: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        bgcolor: bg,
        color,
        borderRadius: 'var(--radius-pill)',
        px: 1,
        py: 0.25,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}
