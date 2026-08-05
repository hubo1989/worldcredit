// components/mobile/CreditCardVisual.tsx
'use client'

import { Card, CardActionArea, CardContent, Typography, Box, LinearProgress } from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { formatAmount } from '@/lib/utils'
import type { CreditCard } from '@/lib/types'

interface Props {
  card: CreditCard
  usedAmount?: number  // 从账单计算得出
  onClick?: () => void
}

export function CreditCardVisual({ card, usedAmount = 0, onClick }: Props) {
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0

  return (
    <Card sx={{ mb: 1.5 }}>
      <CardActionArea onClick={onClick}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CreditCardIcon color="primary" />
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>
                {card.bank_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {card.card_name} {card.card_number_last4 ? `•••• ${card.card_number_last4}` : ''}
              </Typography>
            </Box>
          </Box>

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
