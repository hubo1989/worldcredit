// components/mobile/BillCard.tsx
'use client'

import { Card, CardContent, Typography, Box, Chip, Button } from '@mui/material'
import { formatAmount, getBillStatusColor, getBillStatusText, daysUntilDue } from '@/lib/utils'
import type { Bill, CreditCard } from '@/lib/types'

interface Props {
  bill: Bill
  card?: CreditCard
  paidAmount?: number
  onRecordPayment?: () => void
  onClick?: () => void
}

export function BillCard({ bill, card, paidAmount = 0, onRecordPayment, onClick }: Props) {
  const days = daysUntilDue(bill.due_date)
  const currency = card?.currency || 'CNY'

  return (
    <Card sx={{ mb: 1.5, borderRadius: 3, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <CardContent sx={{ pb: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box>
            {card && (
              <Typography variant="subtitle2" fontWeight={600}>
                {card.bank_name} {card.card_name}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {bill.bill_month} 账单
            </Typography>
          </Box>
          <Chip
            label={getBillStatusText(bill.status)}
            size="small"
            sx={{ bgcolor: getBillStatusColor(bill.status), color: '#fff', fontWeight: 600 }}
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2">
            账单: <strong>{formatAmount(bill.bill_amount, currency)}</strong>
          </Typography>
          <Typography variant="body2">
            已还: {formatAmount(paidAmount, currency)}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            还款日: {bill.due_date}
            {bill.status !== 'paid' && days >= 0 && (
              <Typography
                component="span"
                fontWeight={600}
                color={days <= 3 ? 'error' : days <= 7 ? 'warning.main' : 'text.secondary'}
              >
                {' '}(还剩 {days} 天)
              </Typography>
            )}
          </Typography>
          {bill.status !== 'paid' && onRecordPayment && (
            <Button size="small" variant="outlined" sx={{ borderRadius: 2 }} onClick={(e) => { e.stopPropagation(); onRecordPayment() }}>
              还款
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
