'use client'

import { useEffect, useState } from 'react'
import { Box, Skeleton, Stack, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import type { AiWelcomeContext } from '@/lib/types'

/** 旋转显示的 AI 能力描述 */
const CAPABILITIES = [
  '智能账单分析',
  '还款提醒管家',
  '用卡风险预警',
  '账单疑问解答',
  '还款计划制定',
]

const CAPABILITY_ROTATE_MS = 4000

/** 根据小时数返回时段问候语 */
function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  return '晚上好'
}

function formatMoney(value: number): string {
  return `¥${Number(value || 0).toLocaleString()}`
}

export interface WelcomeBannerProps {
  /** 真实数据驱动；未加载完成时传 undefined 显示骨架屏 */
  context?: AiWelcomeContext
}

/**
 * Area 1 - 个性化欢迎横幅
 * 渐变蓝色背景 + AI 头像 + 基于时间的问候 + 能力描述轮播
 */
export function WelcomeBanner({ context }: WelcomeBannerProps) {
  const [capIndex, setCapIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCapIndex(i => (i + 1) % CAPABILITIES.length)
    }, CAPABILITY_ROTATE_MS)
    return () => clearInterval(timer)
  }, [])

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = context?.holderName || '朋友'
  const hasData = !!context

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 3,
        background: 'linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)',
        color: '#fff',
        p: 2.5,
        boxShadow: '0 6px 20px rgba(37, 99, 235, 0.25)',
      }}
    >
      {/* 右上装饰圆 */}
      <Box
        sx={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: -50,
          left: -20,
          width: 110,
          height: 110,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
          pointerEvents: 'none',
        }}
      />

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {hasData ? (
            <Typography variant="h6" fontWeight={800} sx={{ fontSize: 18 }}>
              {greeting}，{displayName}！
            </Typography>
          ) : (
            <Skeleton variant="text" width={140} sx={{ bgcolor: 'rgba(255,255,255,0.25)' }} />
          )}
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
            我是你的 WorldCredit AI 助手
          </Typography>
        </Box>
      </Stack>

      {/* 能力轮播 */}
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.15)',
          backdropFilter: 'blur(4px)',
          mb: 1.5,
        }}
      >
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: '#10B981',
            boxShadow: '0 0 6px #10B981',
          }}
        />
        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>
          {CAPABILITIES[capIndex]}
        </Typography>
      </Box>

      {/* 数据摘要：仅在有数据时显示 */}
      {hasData && (
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>
            {context.cardCount} 张卡 · {context.pendingBills} 笔待还款 · {formatMoney(context.totalRemaining)}
          </Typography>
          {context.overdueCount > 0 && (
            <Typography variant="caption" sx={{ color: '#FCA5A5', fontSize: 12, fontWeight: 700 }}>
              ⚠ {context.overdueCount} 笔逾期
            </Typography>
          )}
          {context.dueSoonCount > 0 && context.overdueCount === 0 && (
            <Typography variant="caption" sx={{ color: '#FDE68A', fontSize: 12, fontWeight: 700 }}>
              7天内 {context.dueSoonCount} 笔到期
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  )
}

export default WelcomeBanner
