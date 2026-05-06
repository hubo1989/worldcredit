// components/mobile/CreditCardVisual.tsx
'use client'

import { Card, CardActionArea, CardContent, Typography, Box, LinearProgress } from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { formatAmount } from '@/lib/utils'
import type { CreditCard } from '@/lib/types'

interface Props {
  card: CreditCard
  usedAmount?: number
  onClick?: () => void
}

const BANK_COLORS: Record<string, string> = {
  '招商银行': '#e53935',
  '工商银行': '#c62828',
  '建设银行': '#1565c0',
  '中国银行': '#c62828',
  '农业银行': '#2e7d32',
  '交通银行': '#0d47a1',
  '浦发银行': '#1976d2',
  '民生银行': '#00897b',
  '兴业银行': '#00695c',
  '中信银行': '#e65100',
  '光大银行': '#7b1fa2',
  '华夏银行': '#d32f2f',
  '平安银行': '#f57c00',
  '广发银行': '#c62828',
  '汇丰银行': '#c62828',
  '花旗银行': '#0d47a1',
}

export function CreditCardVisual({ card, usedAmount = 0, onClick }: Props) {
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0
  const bankColor = BANK_COLORS[card.bank_name] || '#1976d2'

  return (
    <Card sx={{ mb: 1.5, borderRadius: 3, overflow: 'hidden' }}>
      <CardActionArea onClick={onClick}>
        {/* Card Header with bank color */}
        <Box sx={{
          background: `linear-gradient(135deg, ${bankColor} 0%, ${bankColor}dd 100%)`,
          color: 'white', p: 2, pb: 1.5
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CreditCardIcon fontSize="small" />
            <Typography variant="subtitle2" fontWeight={600}>
              {card.bank_name}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            {card.card_name} {card.card_number_last4 ? `•••• ${card.card_number_last4}` : ''}
          </Typography>
        </Box>

        {/* Usage info */}
        <CardContent sx={{ pt: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              已用 {formatAmount(usedAmount, card.currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              额度 {formatAmount(card.credit_limit, card.currency)}
            </Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={Math.min(usagePercent, 100)}
            color={usagePercent > 80 ? 'error' : usagePercent > 50 ? 'warning' : 'primary'}
            sx={{ height: 6, borderRadius: 3 }}
          />

          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            可用 {formatAmount(available, card.currency)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
