'use client'

import { Box, Typography, Paper, Stack } from '@mui/material'
import {
  PersonAdd as PersonAddIcon,
  Payment as PaymentIcon,
  CreditCard as CardIcon,
  CardGiftcard as BenefitIcon
} from '@mui/icons-material'
import type { UserActivity } from '@/lib/api/dashboard'

const ACTIVITY_ITEMS = [
  { key: 'recentNewUsers' as const, label: '新增用户', icon: <PersonAddIcon fontSize="small" />, color: '#818cf8' },
  { key: 'recentPayments' as const, label: '还款操作', icon: <PaymentIcon fontSize="small" />, color: '#34d399' },
  { key: 'recentCardOpenings' as const, label: '新开卡', icon: <CardIcon fontSize="small" />, color: '#fbbf24' },
  { key: 'recentBenefitUsages' as const, label: '权益使用', icon: <BenefitIcon fontSize="small" />, color: '#f472b6' },
]

interface UserActivityStatsProps {
  data: UserActivity
}

export function UserActivityStats({ data }: UserActivityStatsProps) {
  return (
    <Paper sx={{
      p: 3, borderRadius: 3,
      bgcolor: '#181a24',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <Typography variant="subtitle2" sx={{ color: '#e4e6eb', fontWeight: 600, mb: 2.5 }}>
        近 7 天用户活跃度
      </Typography>

      <Stack spacing={2}>
        {ACTIVITY_ITEMS.map(item => {
          const count = data[item.key]
          return (
            <Box key={item.key} sx={{
              display: 'flex', alignItems: 'center', gap: 2,
              p: 1.5, borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.02)',
              transition: 'background-color 0.2s',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
            }}>
              <Box sx={{
                width: 36, height: 36, borderRadius: 2,
                bgcolor: `${item.color}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: item.color,
              }}>
                {item.icon}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: 13 }}>
                  {item.label}
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ color: '#e4e6eb', fontWeight: 700, fontSize: 18 }}>
                {count}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}
