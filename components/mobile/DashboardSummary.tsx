// components/mobile/DashboardSummary.tsx
'use client'

import { Card, CardContent, Typography } from '@mui/material'
import { formatAmount } from '@/lib/utils'
import type { Bill, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'currency'> }

interface Props {
  bills: BillWithCard[]
}

export function DashboardSummary({ bills }: Props) {
  const totalUnpaid = bills.reduce((sum, b) => sum + (Number(b.bill_amount) || 0), 0)
  const billCount = bills.length

  return (
    <Card sx={{ mb: 3, borderRadius: 4, background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)', color: 'white' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>本月待还总额</Typography>
        <Typography variant="h3" fontWeight={800} sx={{ mb: 2 }}>
          {formatAmount(totalUnpaid)}
        </Typography>

        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          共 {billCount} 笔待还款账单
        </Typography>
      </CardContent>
    </Card>
  )
}

