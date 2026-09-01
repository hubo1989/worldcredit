// components/mobile/UpcomingBills.tsx
'use client'

import { Card, CardContent, Typography, Box, Chip } from '@mui/material'
import { AccessTime as TimeIcon } from '@mui/icons-material'
import { formatAmount, daysUntilDue, getBillStatusColor } from '@/lib/utils'

interface BillItem {
  id: string
  bill_amount: number
  status: string
  due_date: string
  card_id: string
  card?: { bank_name: string; card_name: string; currency: string }
}

interface Props {
  bills: BillItem[]
}

export function UpcomingBills({ bills }: Props) {
  const upcoming = bills
    .filter(b => b.status !== 'paid')
    .map(b => ({ ...b, days: daysUntilDue(b.due_date) }))
    .filter(b => b.days <= 7)
    .sort((a, b) => a.days - b.days)

  if (upcoming.length === 0) return null

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        即将到期
      </Typography>
      {upcoming.map(bill => {
        const isUrgent = bill.days <= 1
        const isWarning = bill.days <= 3
        return (
          <Card key={bill.id} sx={{
            mb: 1, borderRadius: 3,
            border: isUrgent ? '1px solid #f44336' : isWarning ? '1px solid #ff9800' : 'none',
            bgcolor: isUrgent ? '#fff5f5' : isWarning ? '#fff8e1' : '#fff'
          }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 40, height: 40, borderRadius: 2,
                bgcolor: isUrgent ? 'error.main' : isWarning ? 'warning.main' : '#1976d2',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                <TimeIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {bill.card?.bank_name || '未知银行'} {(bill.card as any)?.card_name || ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  还款日 {bill.due_date}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight={700}>
                  {formatAmount(bill.bill_amount, (bill.card as any)?.currency || 'CNY')}
                </Typography>
                <Chip
                  label={bill.days <= 0 ? '已逾期' : `${bill.days} 天后`}
                  size="small"
                  sx={{
                    bgcolor: getBillStatusColor(bill.days <= 0 ? 'overdue' : bill.days <= 3 ? 'partial' : 'unpaid'),
                    color: '#fff', fontSize: 11, height: 20
                  }}
                />
              </Box>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}
