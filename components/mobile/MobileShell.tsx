'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { BottomNav } from './BottomNav'
import { PushPermission } from './PushPermission'
import { checkAndSendReminders } from '@/lib/reminders'

/**
 * MobileShell 负责路由保护和移动端布局包装。
 * 如果用户未登录，自动重定向到 /login。
 * 外壳走 ObsidianUI 暗色 token，避免浅色 MUI 底从暗色页四周漏出来。
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
      // One-shot auto reload when a newly installed service worker takes
      // control: fixes the stale-precache first load after each deploy.
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      })
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
      <div className='obsidian-dashboard flex min-h-dvh flex-col items-center justify-center gap-3 bg-d-bg text-d-text'>
        <span
          role='status'
          aria-label='正在加载'
          className='h-10 w-10 animate-spin rounded-full border-2 border-d-border border-t-d-accent'
        />
        <p className='text-[13px] leading-5 text-d-muted'>正在加载 WorldCredit...</p>
      </div>
    )
  }

  // 未登录时不渲染内容，等待重定向
  if (!user) {
    return null
  }

  return (
    <div className='obsidian-dashboard relative min-h-dvh bg-d-bg pb-24 text-d-text'>
      <div className='mx-auto max-w-[600px]'>
        {children}
      </div>
      <BottomNav />
      <PushPermission />
    </div>
  )
}
