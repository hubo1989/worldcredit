'use client'

import { Box, Typography, Button } from '@mui/material'
import { RetryIcon } from '@/components/icons/WcIcon'
import type { ReactNode } from 'react'

/**
 * WorldCredit 通用状态组件：骨架屏 / 空态 / 错误态。
 * 所有列表与详情页必须覆盖这三态（§7.5）。
 */

/** 骨架卡片（shimmer） */
export function WcSkeleton({ height = 96, count = 3, radius = 'var(--radius-depth-1)' }: { height?: number; count?: number; radius?: number | string }) {
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
          // 空态色块走令牌即可，不做第二套色阶
          background: 'linear-gradient(135deg, var(--track), var(--border))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 2,
          color: 'var(--strong)',
          boxShadow: 'var(--shadow-e1)',
        }}
      >
        {icon ?? (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        )}
      </Box>
      <Typography className="type-title" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {description && (
        <Typography className="type-label" sx={{ mb: 2, maxWidth: 280 }}>
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button
          variant="contained"
          disableElevation
          onClick={onAction}
          sx={{
            borderRadius: 'var(--radius-pill)',
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
        // 语义错误态：保留 danger 语义色底与 1px 语义描边（非分层边框）
        background: 'rgba(207, 46, 46, 0.06)',
        border: '1px solid rgba(207, 46, 46, 0.20)',
        borderRadius: 'var(--radius-depth-2)',
        p: 3,
        textAlign: 'center',
      }}
    >
      <Typography className="type-body" sx={{ color: 'var(--danger)', mb: 1.5 }}>
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
