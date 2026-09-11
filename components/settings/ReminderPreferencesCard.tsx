'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  Divider,
  Chip,
  TextField,
  Button,
  Snackbar,
  Alert
} from '@mui/material'
import NotificationIcon from '@mui/icons-material/NotificationsActive'
import ClockIcon from '@mui/icons-material/AccessTime'
import SendIcon from '@mui/icons-material/Send'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import type { UserReminderConfig } from '@/lib/types'

interface ReminderPreferencesCardProps {
  config: UserReminderConfig
  onChange: (updates: Partial<UserReminderConfig>) => void
  disabled?: boolean
}

export function ReminderPreferencesCard({ config, onChange, disabled }: ReminderPreferencesCardProps) {
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false,
    message: '',
    severity: 'success'
  })

  const handleToggleDay = (day: number) => {
    const current = config.remind_days_before || []
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => b - a)
    onChange({ remind_days_before: updated })
  }

  const handleSendTestPush = async () => {
    setTesting(true)
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        let perm = Notification.permission
        if (perm === 'default') {
          perm = await Notification.requestPermission()
        }

        if (perm === 'granted') {
          new Notification('🔔 WorldCredit 适时提醒', {
            body: '这是一条测试还款提醒！您的提醒节点与免打扰时间配置已生效。',
            icon: '/pwa-192x192.png',
            tag: 'worldcredit-test-reminder'
          })
          setTestNotice({
            open: true,
            message: '测试通知已成功推送到您的设备系统通知栏！',
            severity: 'success'
          })
        } else {
          setTestNotice({
            open: true,
            message: '未开启浏览器通知权限，请在浏览器地址栏允许通知后再试。',
            severity: 'info'
          })
        }
      } else {
        setTestNotice({
          open: true,
          message: '【测试提醒】您的应用还款提醒机制正常（当前设备暂不支持系统 Push API）。',
          severity: 'info'
        })
      }
    } catch (err) {
      setTestNotice({ open: true, message: '测试发送失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'warning.light',
              color: 'warning.dark'
            }}
          >
            <NotificationIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              还款适时提醒规则
            </Typography>
            <Typography variant="body2" color="text.secondary">
              定制到期前的提醒时间节点与夜间免打扰时段
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

        <Stack spacing={2.5}>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 1.5 }}>
              提醒提前时间节点 (支持多选)：
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ gap: 1 }}>
              {[7, 5, 3, 1, 0].map(day => {
                const active = (config.remind_days_before || []).includes(day)
                const label = day === 0 ? '到期当天' : `提前 ${day} 天`
                return (
                  <Chip
                    key={day}
                    label={label}
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    disabled={disabled}
                    onClick={() => handleToggleDay(day)}
                    sx={{
                      cursor: 'pointer',
                      fontWeight: 700,
                      px: 1,
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        transform: 'translateY(-1px)'
                      }
                    }}
                  />
                )
              })}
            </Stack>
          </Box>

          <Divider sx={{ borderStyle: 'dashed' }} />

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <ClockIcon fontSize="small" color="action" />
              <Typography variant="caption" color="text.secondary" fontWeight={700}>
                免打扰时段 (Quiet Hours)：
              </Typography>
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField
                size="small"
                label="开始时间"
                type="time"
                disabled={disabled}
                value={config.quiet_hours_start || '22:00'}
                onChange={e => onChange({ quiet_hours_start: e.target.value })}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 140 }}
              />
              <Typography variant="body2" color="text.secondary" fontWeight={600}>至</Typography>
              <TextField
                size="small"
                label="结束时间"
                type="time"
                disabled={disabled}
                value={config.quiet_hours_end || '08:00'}
                onChange={e => onChange({ quiet_hours_end: e.target.value })}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 140 }}
              />
            </Stack>
          </Box>

          <Divider sx={{ borderStyle: 'dashed' }} />

          <Box sx={{ bgcolor: 'background.default', borderRadius: 3, p: 2 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={700}>
                  验证设备连通性
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  点此发送一条测试推送，验证系统通知是否正常到达
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<SendIcon fontSize="small" />}
                disabled={testing || disabled}
                onClick={handleSendTestPush}
                sx={{ borderRadius: 2.5, whiteSpace: 'nowrap' }}
              >
                {testing ? '测试中...' : '测试通知'}
              </Button>
            </Stack>
          </Box>
        </Stack>

        <Snackbar
          open={testNotice.open}
          autoHideDuration={4000}
          onClose={() => setTestNotice(prev => ({ ...prev, open: false }))}
        >
          <Alert
            severity={testNotice.severity}
            icon={testNotice.severity === 'success' ? <CheckIcon fontSize="small" /> : undefined}
            onClose={() => setTestNotice(prev => ({ ...prev, open: false }))}
          >
            {testNotice.message}
          </Alert>
        </Snackbar>
      </CardContent>
    </Card>
  )
}
