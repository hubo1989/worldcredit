'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useAuth } from '@/lib/auth'
import { BottomNav } from './BottomNav'
import { PushPermission } from './PushPermission'
import { checkAndSendReminders } from '@/lib/reminders'

/**
 * MobileShell 负责路由保护和移动端布局包装
 * 如果用户未登录，自动重定向到 /login
 */
export function MobileShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  // Register service worker + trigger reminder check once user is authenticated
  useEffect(() => {
    if (!user || loading) return

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[SW] registration failed:', err))
    }

    // Check & send due reminders
    checkAndSendReminders(user.id).catch(err =>
      console.warn('[reminders] check failed:', err)
    )
  }, [user, loading])

  // 加载状态显示全屏加载动画
  if (loading) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        gap: 2
      }}>
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          正在加载 WorldCredit...
        </Typography>
      </Box>
    )
  }

  // 未登录时不渲染内容，等待重定向
  if (!user) {
    return null
  }

  return (
    <Box sx={{
      pb: 9, // 为底部导航栏留出空间
      minHeight: '100vh',
      bgcolor: 'background.default',
      position: 'relative'
    }}>
      <Box sx={{ maxWidth: 600, mx: 'auto' }}>
        {children}
      </Box>
      <BottomNav />
      <PushPermission />
    </Box>
  )
}
