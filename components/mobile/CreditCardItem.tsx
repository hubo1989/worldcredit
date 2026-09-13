'use client'

import { Card, CardContent, Typography, Box, Stack, Divider } from '@mui/material'
import CardIcon from '@mui/icons-material/CreditCard'
import BillIcon from '@mui/icons-material/Event'
import type { CreditCard, CardProduct } from '@/lib/types'
import { formatCardTail } from '@/lib/utils'

interface Props {
  card: CreditCard & { card_product: CardProduct }
  onClick?: () => void
}

export function CreditCardItem({ card, onClick }: Props) {
  const product = card.card_product

  return (
    <Card 
      onClick={onClick}
      sx={{ 
        mb: 2, 
        borderRadius: '10px', 
        background: 'linear-gradient(135deg, #030059 0%, #004f78 100%)',
        color: '#FFFFFF',
        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.15)' } : {}
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              {product.bank_name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {product.card_name}
            </Typography>
          </Box>
          <CardIcon sx={{ fontSize: 32, opacity: 0.5 }} />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" sx={{ letterSpacing: 4, fontFamily: 'monospace' }}>
             **** **** **** {formatCardTail(card.card_number_last4) || '****'}
          </Typography>
        </Box>

        <Divider sx={{ bgcolor: 'rgba(255,255,255,0.1)', mb: 2 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>额度</Typography>
            <Typography variant="subtitle1" fontWeight={700}>
               ¥{Number(card.credit_limit).toLocaleString()}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>账单日</Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <BillIcon sx={{ fontSize: 14, opacity: 0.7 }} />
              <Typography variant="subtitle2" fontWeight={700}>
                {card.billing_day} 日
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
