// components/mobile/NotificationPreferences.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  Slider,
  TextField,
  Button,
  Stack,
  Divider,
  Alert,
} from '@mui/material'
import {
  Notifications as NotificationsIcon,
  NotificationsNone as NotificationsNoneIcon,
  Save as SaveIcon,
  Check as CheckIcon,
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
  requestNotificationPermission,
  sendBrowserNotification,
} from '@/lib/notifications'

export function NotificationPreferences() {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')

  const [billDueEnabled, setBillDueEnabled] = useState(true)
  const [overdueEnabled, setOverdueEnabled] = useState(true)
  const [dueDaysBefore, setDueDaysBefore] = useState(3)
  const [notifyTime, setNotifyTime] = useState('09:00')

  const loadPreferences = useCallback(async () => {
    if (!profile) return

    setLoading(true)
    setError(null)

    try {
      const prefs = await getNotificationPreferences(profile.id)
      if (prefs) {
        setBillDueEnabled(prefs.bill_due_enabled)
        setOverdueEnabled(prefs.overdue_enabled)
        setDueDaysBefore(prefs.due_days_before)
        setNotifyTime(prefs.notify_time)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载通知偏好失败')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    loadPreferences()

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [loadPreferences])

  const handleSave = async () => {
    if (!profile) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      await upsertNotificationPreferences(profile.id, {
        bill_due_enabled: billDueEnabled,
        overdue_enabled: overdueEnabled,
        due_days_before: dueDaysBefore,
        notify_time: notifyTime,
      })

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleTestNotification = async () => {
    const sent = await sendBrowserNotification(
      '测试通知',
      '如果您看到这条消息，说明通知功能正常！',
      () => {
        window.focus()
      }
    )

    if (!sent) {
      setError('发送测试通知失败，请检查浏览器权限')
    }
  }

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission()
    setPermission(granted ? 'granted' : 'denied')
  }

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>加载中...</Typography>
      </Box>
    )
  }

  const supportsNotifications = typeof window !== 'undefined' && 'Notification' in window

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        通知设置
      </Typography>

      {!supportsNotifications && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          您的浏览器不支持系统通知功能
        </Alert>
      )}

      {supportsNotifications && permission === 'default' && (
        <Paper
          elevation={2}
          sx={{
            p: 2,
            mb: 2,
            borderLeft: 4,
            borderLeftColor: 'info.main',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <NotificationsIcon color="info" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                开启浏览器通知
              </Typography>
              <Typography variant="body2" color="text.secondary">
                请先允许浏览器通知权限
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              onClick={handleRequestPermission}
            >
              允许通知
            </Button>
          </Box>
        </Paper>
      )}

      {supportsNotifications && permission === 'denied' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          通知权限已被拒绝。请在浏览器设置中重新开启通知权限。
        </Alert>
      )}

      {supportsNotifications && permission === 'granted' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckIcon fontSize="small" />
            <Typography variant="body2">通知权限已开启</Typography>
          </Box>
        </Alert>
      )}

      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          通知类型
        </Typography>

        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={billDueEnabled}
                onChange={(e) => setBillDueEnabled(e.target.checked)}
                disabled={!supportsNotifications || permission !== 'granted'}
              />
            }
            label={
              <Box>
                <Typography variant="body2">还款临近提醒</Typography>
                <Typography variant="caption" color="text.secondary">
                  在账单到期前发送提醒
                </Typography>
              </Box>
            }
          />

          <FormControlLabel
            control={
              <Switch
                checked={overdueEnabled}
                onChange={(e) => setOverdueEnabled(e.target.checked)}
                disabled={!supportsNotifications || permission !== 'granted'}
              />
            }
            label={
              <Box>
                <Typography variant="body2">逾期提醒</Typography>
                <Typography variant="caption" color="text.secondary">
                  账单逾期后发送提醒
                </Typography>
              </Box>
            }
          />
        </Stack>
      </Paper>

      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          提醒设置
        </Typography>

        <Stack spacing={3}>
          <Box>
            <Typography variant="body2" gutterBottom>
              提前提醒天数：{dueDaysBefore} 天
            </Typography>
            <Slider
              value={dueDaysBefore}
              onChange={(e, value) => setDueDaysBefore(value as number)}
              min={1}
              max={7}
              marks
              step={1}
              disabled={!billDueEnabled}
              valueLabelDisplay="auto"
            />
          </Box>

          <TextField
            label="每日通知时间"
            type="time"
            value={notifyTime}
            onChange={(e) => setNotifyTime(e.target.value)}
            InputLabelProps={{
              shrink: true,
            }}
            inputProps={{
              step: 300, // 5 min
            }}
            fullWidth
            disabled={!supportsNotifications || permission !== 'granted'}
          />
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          保存成功
        </Alert>
      )}

      <Stack direction="row" spacing={2}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving || !supportsNotifications || permission !== 'granted'}
          fullWidth
        >
          {saving ? '保存中...' : '保存设置'}
        </Button>

        {supportsNotifications && permission === 'granted' && (
          <Button
            variant="outlined"
            onClick={handleTestNotification}
            fullWidth
          >
            测试通知
          </Button>
        )}
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Typography variant="body2" color="text.secondary">
        注意：通知功能需要浏览器支持。在移动设备上，请确保已将应用添加到主屏幕并允许通知。
      </Typography>
    </Box>
  )
}
