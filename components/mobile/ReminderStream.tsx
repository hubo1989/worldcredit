// components/mobile/ReminderStream.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Typography, Paper, Chip, Stack, IconButton, Skeleton, Alert, Button } from '@mui/material'
import {
  Warning as WarningIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  CheckCircle as CheckIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { asRole } from '@/lib/permissions'
import { getReminders, markReminderRead, dismissReminder } from '@/lib/api/reminders'
import type { Reminder, ReminderType } from '@/lib/reminders'

interface ReminderItemProps {
  reminder: Reminder
  onRead: (key: string) => void
  onDismiss: (key: string) => void
}

function ReminderItem({ reminder, onRead, onDismiss }: ReminderItemProps) {
  const router = useRouter()

  const getSeverityIcon = () => {
    switch (reminder.severity) {
      case 'critical':
        return <ErrorIcon color="error" />
      case 'high':
        return <WarningIcon color="warning" />
      case 'medium':
        return <InfoIcon color="info" />
      case 'low':
        return <InfoIcon color="disabled" />
    }
  }

  const getTypeColor = () => {
    switch (reminder.type) {
      case 'bill_overdue':
        return 'error'
      case 'bill_due':
        return 'warning'
      case 'promo_expiring':
        return 'info'
      case 'benefit_expiring':
        return 'secondary'
      case 'annual_fee_attention':
        return 'default'
    }
  }

  const getTypeLabel = () => {
    switch (reminder.type) {
      case 'bill_overdue':
        return '已逾期'
      case 'bill_due':
        return '还款提醒'
      case 'promo_expiring':
        return '优惠到期'
      case 'benefit_expiring':
        return '权益到期'
      case 'annual_fee_attention':
        return '年费关注'
    }
  }

  const handleClick = () => {
    onRead(reminder.key)
    router.push(reminder.actionUrl)
  }

  return (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        mb: 1.5,
        cursor: 'pointer',
        transition: 'all 0.2s',
        '&:hover': {
          elevation: 3,
          transform: 'translateY(-2px)',
        },
        borderLeft: 4,
        borderLeftColor: (theme) => {
          switch (reminder.severity) {
            case 'critical':
              return theme.palette.error.main
            case 'high':
              return theme.palette.warning.main
            case 'medium':
              return theme.palette.info.main
            case 'low':
              return theme.palette.grey[400]
          }
        },
      }}
      onClick={handleClick}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        {getSeverityIcon()}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Chip
              label={getTypeLabel()}
              size="small"
              color={getTypeColor() as any}
              variant="outlined"
            />
            <Typography variant="body2" color="text.secondary" noWrap>
              {reminder.holderName}
            </Typography>
          </Box>

          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            {reminder.title}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {reminder.description}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {reminder.bankName}
            </Typography>
            {reminder.cardName && (
              <>
                <Typography variant="caption" color="text.secondary">•</Typography>
                <Typography variant="caption" color="text.secondary">
                  {reminder.cardName}
                </Typography>
              </>
            )}
            {reminder.amount && (
              <>
                <Typography variant="caption" color="text.secondary">•</Typography>
                <Typography variant="caption" fontWeight={600} color="error.main">
                  {reminder.amount} {reminder.currency}
                </Typography>
              </>
            )}
          </Box>
        </Box>

        <IconButton
          aria-label="忽略此提醒"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(reminder.key)
          }}
          sx={{ flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Paper>
  )
}

interface ReminderStreamProps {
  holderId?: string
  cardId?: string
  type?: ReminderType
}

export function ReminderStream({ holderId, cardId, type }: ReminderStreamProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user, profile } = useAuth()

  const loadReminders = useCallback(async () => {
    if (!user || !profile) return

    setLoading(true)
    setError(null)

    try {
      const role = asRole(profile)
      const managedHolderIds = role === 'member'
        ? [profile.id]
        : undefined

      const data = await getReminders(
        profile.id,
        role,
        managedHolderIds,
        { status: 'unread', holderId, cardId, type }
      )

      setReminders(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载提醒失败')
    } finally {
      setLoading(false)
    }
  }, [user, profile, holderId, cardId, type])

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  const handleRead = async (key: string) => {
    if (!profile) return

    try {
      await markReminderRead(profile.id, key)
      // Remove from local state
      setReminders(prev => prev.filter(r => r.key !== key))
    } catch (err) {
      console.error('Failed to mark reminder as read:', err)
    }
  }

  const handleDismiss = async (key: string) => {
    if (!profile) return

    try {
      await dismissReminder(profile.id, key)
      // Remove from local state
      setReminders(prev => prev.filter(r => r.key !== key))
    } catch (err) {
      console.error('Failed to dismiss reminder:', err)
    }
  }

  if (loading) {
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
          提醒中心
        </Typography>
        <Skeleton variant="rounded" height={80} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={80} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={80} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
          提醒中心
        </Typography>
        <Alert
          severity="error"
          action={
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadReminders}>
              重试
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    )
  }

  if (reminders.length === 0) {
    return null
  }

  return (
    <Box sx={{ mt: 3, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            提醒中心
          </Typography>
          <Chip
            label={reminders.length}
            size="small"
            color="error"
            sx={{ height: 20, minWidth: 20, fontSize: '0.75rem' }}
          />
        </Box>
        <IconButton aria-label="刷新" size="small" onClick={loadReminders}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>

      <Stack>
        {reminders.map(reminder => (
          <ReminderItem
            key={reminder.key}
            reminder={reminder}
            onRead={handleRead}
            onDismiss={handleDismiss}
          />
        ))}
      </Stack>
    </Box>
  )
}
