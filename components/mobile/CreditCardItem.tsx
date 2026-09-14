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

// MUI Typography 自带样式注入在 globals.css 之后，同特异性下角色 class 会被覆盖，
// 因此把 phone 排版令牌直接写进 sx，确保 22/28 与 14.5/18 真正生效。
const TITLE = {
  fontSize: 'var(--type-title-size)',
  lineHeight: 'var(--type-title-line)',
  fontWeight: 'var(--type-title-weight)',
  letterSpacing: 'var(--type-title-tracking)',
}
const BODY = {
  fontSize: 'var(--type-body-size)',
  lineHeight: 'var(--type-body-line)',
  fontWeight: 'var(--type-body-weight)',
  letterSpacing: 'var(--type-body-tracking)',
}
const SECTION = {
  fontSize: 'var(--type-section-size)',
  lineHeight: 'var(--type-section-line)',
  fontWeight: 'var(--type-section-weight)',
  letterSpacing: 'var(--type-section-tracking)',
}

export function CreditCardItem({ card, onClick }: Props) {
  const product = card.card_product

  return (
    <Card
      onClick={onClick}
      sx={{
        mb: 2,
        // 卡面保留藏青→深青渐变识别度，只统一到 14px 圆角档与分层阴影
        border: 0,
        borderRadius: 'var(--radius-depth-2)',
        background: 'linear-gradient(135deg, #030059 0%, #004f78 100%)',
        color: 'var(--text-on-dark)',
        boxShadow: 'var(--shadow-e2)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 200ms var(--ease-out), box-shadow 200ms var(--ease-out)',
        '&:hover': onClick
          ? { transform: 'translateY(-2px)', boxShadow: 'var(--shadow-e3)' }
          : {},
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <Box>
            {/* 卡片标题：22/28 · 600 · -0.7px */}
            <Typography sx={{ ...TITLE, color: 'var(--text-on-dark)' }}>
              {product.bank_name}
            </Typography>
            <Typography sx={{ ...BODY, color: 'var(--text-on-dark)', opacity: 0.8 }}>
              {product.card_name}
            </Typography>
          </Box>
          <CardIcon sx={{ fontSize: 32, color: 'var(--text-on-dark)', opacity: 0.5 }} />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography sx={{ ...TITLE, fontFamily: 'var(--font-mono)', color: 'var(--text-on-dark)', letterSpacing: '4px' }}>
             **** **** **** {formatCardTail(card.card_number_last4) || '****'}
          </Typography>
        </Box>

        {/* 深色渐变卡面上的分隔线：--track 在深底不可见，沿用白色低透明语义 */}
        <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.1)', mb: 2 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography sx={{ ...BODY, color: 'var(--text-on-dark)', opacity: 0.7, display: 'block' }}>
              额度
            </Typography>
            <Typography sx={{ ...SECTION, color: 'var(--text-on-dark)' }}>
               ¥{Number(card.credit_limit).toLocaleString()}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ ...BODY, color: 'var(--text-on-dark)', opacity: 0.7, display: 'block' }}>
              账单日
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <BillIcon sx={{ fontSize: 14, color: 'var(--text-on-dark)', opacity: 0.7 }} />
              <Typography sx={{ ...SECTION, color: 'var(--text-on-dark)' }}>
                {card.billing_day} 日
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
