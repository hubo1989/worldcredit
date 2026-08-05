'use client'

import { Box, Typography, Paper, Chip, Stack } from '@mui/material'
import {
  LocalOffer as PromoIcon,
  CheckCircle as ActiveIcon,
  Cancel as ExpiredIcon
} from '@mui/icons-material'
import type { PromoItem } from '@/lib/api/dashboard'

interface PromoOverviewProps {
  data: PromoItem[]
}

const DISCOUNT_COLORS: Record<string, string> = {
  '满减': '#fbbf24',
  '折扣': '#34d399',
  '积分': '#818cf8',
  '返现': '#f472b6',
}

export function PromoOverview({ data }: PromoOverviewProps) {
  const activeCount = data.filter(p => p.is_active).length

  return (
    <Paper sx={{
      p: 3, borderRadius: 3,
      bgcolor: '#181a24',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#e4e6eb', fontWeight: 600 }}>
            优惠活动
          </Typography>
          <Typography variant="caption" sx={{ color: '#6b7280' }}>
            进行中 {activeCount} · 共 {data.length}
          </Typography>
        </Box>
      </Box>

      {data.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <PromoIcon sx={{ fontSize: 40, color: '#374151', mb: 1 }} />
          <Typography variant="body2" sx={{ color: '#6b7280' }}>暂无优惠活动</Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {data.slice(0, 6).map(promo => (
            <Box key={promo.id} sx={{
              display: 'flex', alignItems: 'center', gap: 2,
              p: 2, borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.03)',
              transition: 'border-color 0.2s',
              '&:hover': { borderColor: 'rgba(255,255,255,0.08)' },
            }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="body2" sx={{ color: '#e4e6eb', fontWeight: 500, fontSize: 13 }} noWrap>
                    {promo.title}
                  </Typography>
                  {promo.is_active ? (
                    <ActiveIcon sx={{ fontSize: 14, color: '#4ade80' }} />
                  ) : (
                    <ExpiredIcon sx={{ fontSize: 14, color: '#6b7280' }} />
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 11 }}>
                    {promo.bank_name}
                  </Typography>
                  {promo.discount_type && (
                    <Chip
                      label={promo.discount_type}
                      size="small"
                      sx={{
                        height: 18, fontSize: 10,
                        bgcolor: `${DISCOUNT_COLORS[promo.discount_type] || '#6b7280'}18`,
                        color: DISCOUNT_COLORS[promo.discount_type] || '#6b7280',
                        fontWeight: 600,
                      }}
                    />
                  )}
                  {promo.end_date && (
                    <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 11 }}>
                      截止 {promo.end_date}
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="body2" sx={{ color: '#e4e6eb', fontWeight: 700, fontSize: 15 }}>
                  {promo.usage_count}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 10 }}>
                  已使用
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  )
}
