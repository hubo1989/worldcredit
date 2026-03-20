// components/mobile/BillCard.tsx
'use client'

import { Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO } from 'date-fns'
import type { Bill, CreditCard } from '@/lib/types'

interface Props {
  bill: Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }
  onClick?: () => void
}

export function BillCard({ bill, onClick }: Props) {
  const card = bill.credit_cards
  const daysLeft = differenceInDays(parseISO(bill.due_date), new Date())

  const getStatusColor = () => {
    if (bill.status === 'paid') return 'success'
    if (bill.status === 'overdue' || daysLeft < 0) return 'error'
    if (daysLeft <= 3) return 'warning'
    return 'default'
  }

  const getStatusText = () => {
    if (bill.status === 'paid') return '已还清'
    if (daysLeft < 0) return `逾期 ${Math.abs(daysLeft)} 天`
    if (daysLeft === 0) return '今天最后期限'
    return `${daysLeft} 天后截止`
  }

  return (
    <Card sx={{ mb: 1.5, borderLeft: 6, borderColor: `${getStatusColor()}.main` }}>
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ py: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>
                {card.bank_name} · {card.card_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {bill.bill_month} 账单 · {bill.due_date} 截止
              </Typography>
            </Box>
            <Chip
              label={getStatusText()}
              size="small"
              color={getStatusColor() as any}
              variant="outlined"
            />
          </Box>

          <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={700}>
              {formatAmount(bill.bill_amount, (card as any).currency)}
            </Typography>
            {bill.status === 'partial' && (
              <Typography variant="caption" color="warning.main">
                部分还款
              </Typography>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
