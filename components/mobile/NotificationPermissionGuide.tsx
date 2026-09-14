// components/mobile/NotificationPermissionGuide.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Typography, Button, Paper, Stack } from '@mui/material'
import {
  Notifications as NotificationsIcon,
  NotificationsNone as NotificationsNoneIcon,
} from '@mui/icons-material'
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
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 2,
        // 分层阴影代替边框；左侧 1px 语义 info 强调线（语义提示，非分层）
        borderRadius: 'var(--radius-depth-2)',
        boxShadow: 'var(--shadow-e2)',
        borderLeft: 4,
        borderLeftColor: 'var(--info)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ color: 'var(--strong)', display: 'flex' }}>
          {permission === 'denied' ? (
            <NotificationsNoneIcon fontSize="large" />
          ) : (
            <NotificationsIcon fontSize="large" />
          )}
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography className="type-section" gutterBottom>
            {permission === 'denied' ? '通知权限已关闭' : '开启还款提醒'}
          </Typography>

          {permission === 'denied' ? (
            <>
              <Typography className="type-body" sx={{ mb: 1.5, color: 'var(--text)' }}>
                您已拒绝浏览器通知权限。如需接收还款提醒，请在浏览器设置中重新开启通知权限。
              </Typography>
              <Typography className="type-label">
                提示：在地址栏左侧点击锁图标 → 网站设置 → 通知 → 允许
              </Typography>
            </>
          ) : (
            <>
              <Typography className="type-body" sx={{ mb: 1.5, color: 'var(--text)' }}>
                开启浏览器通知后，我们将在账单到期前和逾期时及时提醒您，避免忘记还款。
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<NotificationsIcon />}
                  onClick={handleRequestPermission}
                  disabled={loading}
                >
                  {loading ? '请求中...' : '开启通知'}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setDismissed(true)}
                >
                  暂不开启
                </Button>
              </Stack>
            </>
          )}
        </Box>
      </Box>
    </Paper>
  )
}
