// components/mobile/NotificationPermissionGuide.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/obsidian/controls'
import { BellIcon } from '@/components/icons/WcIcon'
import { requestNotificationPermission } from '@/lib/notifications'

interface Props {
  onPermissionGranted?: () => void
}

export function NotificationPermissionGuide({ onPermissionGranted }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])

  const handleRequestPermission = useCallback(async () => {
    setLoading(true)
    try {
      const granted = await requestNotificationPermission()
      setPermission(granted ? 'granted' : 'denied')
      if (granted && onPermissionGranted) {
        onPermissionGranted()
      }
    } catch (error) {
      console.error('Failed to request notification permission:', error)
    } finally {
      setLoading(false)
    }
  }, [onPermissionGranted])

  // Don't show if dismissed or not supported
  if (dismissed) return null
  if (typeof window === 'undefined' || !('Notification' in window)) return null
  if (permission === 'granted') return null

  return (
    // 左侧 1px 语义 info 强调线（语义提示，非分层）
    <div className='mb-2 rounded-2xl border-l-4 border-d-accent bg-d-surface p-2.5'>
      <div className='flex items-start gap-2'>
        <span className='flex shrink-0 text-d-accent-light'>
          <BellIcon size={24} />
        </span>

        <div className='min-w-0 flex-1'>
          <p className='mb-1.5 text-[19px] font-semibold leading-6 text-d-text'>
            {permission === 'denied' ? '通知权限已关闭' : '开启还款提醒'}
          </p>

          {permission === 'denied' ? (
            <>
              <p className='mb-1.5 text-[14px] leading-[18px] text-d-text'>
                您已拒绝浏览器通知权限。如需接收还款提醒，请在浏览器设置中重新开启通知权限。
              </p>
              <p className='text-[14px] leading-[18px] text-d-muted'>
                提示：在地址栏左侧点击锁图标 → 网站设置 → 通知 → 允许
              </p>
            </>
          ) : (
            <>
              <p className='mb-1.5 text-[14px] leading-[18px] text-d-text'>
                开启浏览器通知后，我们将在账单到期前和逾期时及时提醒您，避免忘记还款。
              </p>
              {/* 两个按钮都是可点目标：nowrap 不收缩；窄屏放不下时整行下移 */}
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' variant='primary' onClick={handleRequestPermission} disabled={loading} className='whitespace-nowrap'>
                  {loading ? '请求中...' : '开启通知'}
                </Button>
                <Button size='sm' variant='secondary' onClick={() => setDismissed(true)} className='whitespace-nowrap'>
                  暂不开启
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
