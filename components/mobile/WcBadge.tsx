'use client'

import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * WorldCredit 状态徽章 / 来源徽章。
 * 状态四色：绿已还 / 黄部分 / 红逾期 / 蓝待还（§7.3）。
 */

// 状态与来源徽章的颜色一律走语义令牌，只用 color-mix 生成淡底，不再散落字面色值。
//
// 文字用 `-ink` 档（语义色的深档）而不是语义色本色：本色压在自己 10~14% 的
// 淡底上只有 2.66~4.18:1，全部不达 AA（实测 --success 本色 2.89:1、--info 4.49:1）。
// 语义本色留给填充、描边和大字号，正文一律下沉到 ink 档。
const tint = (token: string, pct: number) => `color-mix(in srgb, var(${token}) ${pct}%, transparent)`

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  paid:    { bg: tint('--success', 12), fg: 'var(--success-ink)', label: '已还' },
  partial: { bg: tint('--warn', 18),    fg: 'var(--gold-700)', label: '部分' },
  overdue: { bg: tint('--danger', 12),  fg: 'var(--danger-ink)', label: '逾期' },
  unpaid:  { bg: tint('--info', 10),    fg: 'var(--info-ink)', label: '待还' },
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
  email:  { bg: tint('--info', 10),   fg: 'var(--info-ink)', label: '邮件' },
  manual: { bg: tint('--muted', 14),  fg: 'var(--muted)', label: '手动' },
  ai:     { bg: tint('--gold-500', 18), fg: 'var(--gold-700)', label: 'AI' },
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
export function PillBadge({ children, color = 'var(--muted)', bg }: { children: ReactNode; color?: string; bg?: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        bgcolor: bg ?? tint('--muted', 14),
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
