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
      color: 'var(--text-on-dark)',
      // 深度 3：大卡 18px 圆角 + 分层阴影，无边框
      borderRadius: 'var(--radius-depth-3)',
      mb: 3,
      boxShadow: 'var(--shadow-e3)',
      border: 0,
    }}>
      <CardContent sx={{ p: 3 }}>
        <Typography className="type-label" sx={{ color: 'inherit', opacity: 0.8, mb: 0.5 }}>
          本月待还总额
        </Typography>
        <Typography className="type-title num-tabular" sx={{ color: 'inherit' }}>
          {formatAmount(totalAmount - totalPaid, currency)}
        </Typography>

        <Box sx={{ mt: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography className="type-label" sx={{ color: 'inherit', opacity: 0.8 }}>
              还款进度 {paidPercent.toFixed(0)}%
            </Typography>
            <Typography className="type-label" sx={{ color: 'inherit', opacity: 0.8 }}>
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
              '& .MuiLinearProgress-bar': { bgcolor: 'var(--text-on-dark)' }
            }}
          />
        </Box>

        {overdueCount > 0 && (
          <Box sx={{
            // 语义逾期警示：保留 danger 语义色底，不是分层边框
            mt: 2, p: 1.5, bgcolor: 'rgba(244,67,54,0.3)',
            borderRadius: 'var(--radius-depth-1)', textAlign: 'center'
          }}>
            <Typography className="type-body" sx={{ color: 'inherit', fontWeight: 600 }}>
              ⚠️ {overdueCount} 笔账单已逾期
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
