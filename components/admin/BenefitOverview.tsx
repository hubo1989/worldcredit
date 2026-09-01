'use client'

import { Box, Typography, Paper, Stack, LinearProgress, Chip } from '@mui/material'
import type { BenefitStat } from '@/lib/api/dashboard'

interface BenefitOverviewProps {
  data: BenefitStat[]
}

const PERIOD_LABEL: Record<string, string> = {
  yearly: '年度',
  monthly: '月度',
  one_time: '一次性',
}

const PERIOD_COLOR: Record<string, string> = {
  yearly: '#818cf8',
  monthly: '#34d399',
  one_time: '#fbbf24',
}

export function BenefitOverview({ data }: BenefitOverviewProps) {
  return (
    <Paper sx={{
      p: 3, borderRadius: 3,
      bgcolor: '#181a24',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <Typography variant="subtitle2" sx={{ color: '#e4e6eb', fontWeight: 600, mb: 2.5 }}>
        权益使用概览
      </Typography>

      {data.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>暂无权益数据</Typography>
        </Box>
      ) : (
        <Stack spacing={2}>
          {data.map(b => {
            const usageRate = b.quota > 0 ? Math.min((b.usage_count / b.quota) * 100, 100) : 0
            const periodColor = PERIOD_COLOR[b.period] || '#9ca3af'

            return (
              <Box key={b.id} sx={{
                p: 2, borderRadius: 2,
                bgcolor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.03)',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: '#e4e6eb', fontWeight: 500, fontSize: 13 }}>
                      {b.name}
                    </Typography>
                    <Chip
                      label={PERIOD_LABEL[b.period] || b.period}
                      size="small"
                      sx={{
                        height: 18, fontSize: 10,
                        bgcolor: `${periodColor}18`,
                        color: periodColor,
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 11 }}>
                    {b.usage_count}/{b.quota}
                  </Typography>
                </Box>

                <LinearProgress
                  variant="determinate"
                  value={usageRate}
                  sx={{
                    height: 6, borderRadius: 3, mb: 1,
                    bgcolor: 'rgba(255,255,255,0.05)',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 3,
                      background: `linear-gradient(90deg, ${periodColor}, ${periodColor}cc)`,
                    },
                  }}
                />

                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: 11 }}>
                  {b.bank_name} · {b.card_product_name}
                </Typography>
              </Box>
            )
          })}
        </Stack>
      )}
    </Paper>
  )
}
