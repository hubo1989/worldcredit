// components/mobile/DashboardSummary.tsx
'use client'

import { Card, CardContent, Typography, Box, LinearProgress } from '@mui/material'
import { formatAmount } from '@/lib/utils'

interface BillWithPayments {
  id: string
  bill_amount: number
  status: string
  due_date: string
  card_id: string
  paid_amount?: number
}

interface Props {
  bills: BillWithPayments[]
  currency?: string
}

export function DashboardSummary({ bills, currency = 'CNY' }: Props) {
  const unpaidBills = bills.filter(b => b.status !== 'paid')
  const totalAmount = unpaidBills.reduce((sum, b) => sum + b.bill_amount, 0)
  const totalPaid = unpaidBills.reduce((sum, b) => sum + (b.paid_amount || 0), 0)
  const paidPercent = totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0
  const overdueCount = bills.filter(b => b.status === 'overdue').length

  return (
    <Card sx={{
      background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
      color: 'white',
      borderRadius: 4,
      mb: 3,
      boxShadow: '0 8px 16px rgba(25, 118, 210, 0.2)'
    }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="body2" sx={{ opacity: 0.8, mb: 0.5 }}>
          本月待还总额
        </Typography>
        <Typography variant="h4" fontWeight={800}>
          {formatAmount(totalAmount - totalPaid, currency)}
        </Typography>

        <Box sx={{ mt: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              还款进度 {paidPercent.toFixed(0)}%
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {formatAmount(totalPaid, currency)} / {formatAmount(totalAmount, currency)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(paidPercent, 100)}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'rgba(255,255,255,0.2)',
              '& .MuiLinearProgress-bar': { bgcolor: 'white' }
            }}
          />
        </Box>

        {overdueCount > 0 && (
          <Box sx={{
            mt: 2, p: 1.5, bgcolor: 'rgba(244,67,54,0.3)',
            borderRadius: 2, textAlign: 'center'
          }}>
            <Typography variant="body2" fontWeight={600}>
              ⚠️ {overdueCount} 笔账单已逾期
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
