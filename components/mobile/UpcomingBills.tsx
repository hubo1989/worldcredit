// components/mobile/UpcomingBills.tsx
'use client'

import { Typography, Box, Badge } from '@mui/material'
import { BillCard } from './BillCard'
import type { Bill, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }

interface Props {
  bills: BillWithCard[]
}

export function UpcomingBills({ bills }: Props) {
  if (bills.length === 0) {
    return (
      <Box sx={{ mt: 2, textAlign: 'center', p: 4 }}>
        <Typography color="text.secondary">本月暂无待还款项</Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>即将到期</Typography>
        <Badge 
          badgeContent={bills.length} 
          color="error" 
          sx={{ ml: 2 }}
        />
      </Box>
      
      {bills.map((bill) => (
        <BillCard key={bill.id} bill={bill} />
      ))}
    </Box>
  )
}
