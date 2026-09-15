// components/mobile/CreditCardVisual.tsx
'use client'

import { Card, CardActionArea, CardContent, Typography, Box, LinearProgress } from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { formatAmount, formatCardTail } from '@/lib/utils'
import type { CreditCard, CardProduct } from '@/lib/types'

interface Props {
  card: CreditCard & { card_product?: CardProduct; bank_name?: string; card_name?: string }
  usedAmount?: number
  onClick?: () => void
}

// 银行品牌色表：数据性用色（每个银行一个可识别色），不进设计体系色板
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

// MUI Typography 自带样式注入在 globals.css 之后，同特异性下角色 class 会被覆盖，
// 因此排版令牌直接写进 sx。
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

export function CreditCardVisual({ card, usedAmount = 0, onClick }: Props) {
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0
  const bankName = card.bank_name ?? card.card_product?.bank_name ?? '银行卡'
  const cardName = card.card_name ?? card.card_product?.card_name ?? '信用卡'
  const bankColor = BANK_COLORS[bankName] || '#1976d2'
  const currency = card.card_product?.currency ?? 'CNY'

  return (
    <Card
      sx={{
        mb: 1.5,
        // 无边框 + 分层阴影，浮层/大卡走 18px 档
        border: 0,
        borderRadius: 'var(--radius-depth-3)',
        boxShadow: 'var(--shadow-e2)',
        overflow: 'hidden',
      }}
    >
      <CardActionArea onClick={onClick}>
        {/* 卡面头部：保留银行品牌色渐变识别度 */}
        <Box sx={{
          background: `linear-gradient(135deg, ${bankColor} 0%, ${bankColor}dd 100%)`,
          color: 'var(--text-on-dark)', p: 2, pb: 1.5
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CreditCardIcon sx={{ fontSize: 20, color: 'var(--text-on-dark)' }} />
            <Typography sx={{ ...SECTION, color: 'var(--text-on-dark)' }}>
              {bankName}
            </Typography>
          </Box>
          {/*
            卡名与卡尾号拆成两个 element：合在一个文本节点里时，长卡名折行会把
            「•••• 0444」孤立成第二行（实测 2 行）。卡尾号是识别同一款卡不同张的
            关键信息，必须整段留在同一行，因此 flexShrink: 0 + nowrap，卡名负责省略。
          */}
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0 }}>
            <Typography
              sx={{
                ...BODY,
                color: 'var(--text-on-dark)',
                opacity: 0.8,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cardName}
            </Typography>
            {formatCardTail(card.card_number_last4) && (
              <Typography
                component="span"
                sx={{ ...BODY, color: 'var(--text-on-dark)', opacity: 0.8, flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                •••• {formatCardTail(card.card_number_last4)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* 额度使用情况 */}
        <CardContent sx={{ pt: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ ...BODY, color: 'var(--muted)' }}>
              已用 {formatAmount(usedAmount, currency)}
            </Typography>
            <Typography sx={{ ...BODY, color: 'var(--muted)' }}>
              额度 {formatAmount(card.credit_limit, currency)}
            </Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={Math.min(usagePercent, 100)}
            color={usagePercent > 80 ? 'error' : usagePercent > 50 ? 'warning' : 'primary'}
            sx={{ height: 6, borderRadius: 'var(--radius-pill)' }}
          />

          <Typography sx={{ ...BODY, color: 'var(--muted)', mt: 0.5 }}>
            可用 {formatAmount(available, currency)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
