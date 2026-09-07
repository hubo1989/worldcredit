'use client'

import { Box, Typography, Button } from '@mui/material'
import { RetryIcon } from '@/components/icons/WcIcon'
import type { ReactNode } from 'react'

/**
 * WorldCredit 通用状态组件：骨架屏 / 空态 / 错误态。
 * 所有列表与详情页必须覆盖这三态（§7.5）。
 */

/** 骨架卡片（shimmer） */
export function WcSkeleton({ height = 96, count = 3, radius = 12 }: { height?: number; count?: number; radius?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Box
          key={i}
          className="wc-skeleton"
          sx={{ height, borderRadius: radius, mb: 1.5, width: '100%' }}
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
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 6,
        px: 3,
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(10,31,68,0.06), rgba(122,173,255,0.12))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 2,
          color: '#1E3A8A',
        }}
      >
        {icon ?? (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        )}
      </Box>
      <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', mb: 0.5 }}>
        {title}
      </Typography>
      {description && (
        <Typography sx={{ fontSize: 13, color: 'var(--text-secondary)', mb: 2, maxWidth: 280 }}>
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button
          variant="outlined"
          onClick={onAction}
          sx={{
            borderRadius: 'var(--radius-pill)',
            borderColor: 'var(--navy-600)',
            color: 'var(--navy-600)',
            fontWeight: 600,
            textTransform: 'none',
            px: 3,
          }}
        >
          {actionLabel}
        </Button>
      )}
    </Box>
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
    <Box
      sx={{
        background: 'rgba(207, 46, 46, 0.06)',
        border: '1px solid rgba(207, 46, 46, 0.20)',
        borderRadius: 'var(--radius-card)',
        p: 3,
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontSize: 13.5, color: 'var(--danger)', mb: 1.5 }}>
        {message}
      </Typography>
      {onRetry && (
        <Button
          size="small"
          variant="contained"
          startIcon={<RetryIcon size={16} />}
          onClick={onRetry}
          sx={{
            bgcolor: 'var(--danger)',
            '&:hover': { bgcolor: '#B32525' },
            borderRadius: 'var(--radius-pill)',
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          {retryLabel}
        </Button>
      )}
    </Box>
  )
}
