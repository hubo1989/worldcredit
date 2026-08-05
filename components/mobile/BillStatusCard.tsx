'use client'

import { Paper, Box, Typography, Chip, Stack } from '@mui/material'
import type { Bill, CreditCard, CardProduct } from '@/lib/types'
import { format } from 'date-fns'

interface Props {
  bill: Bill & { card?: CreditCard & { card_product?: CardProduct } }
  onClick?: () => void
}

export function BillStatusCard({ bill, onClick }: Props) {
  const isPaid = bill.status === 'paid'
  const isPartial = bill.status === 'partial'
  const isOverdue = bill.status === 'overdue'

  const cardProduct = bill.card?.card_product
  const bankName = cardProduct?.bank_name || '信用卡账户'
  const cardName = cardProduct?.card_name || ''
  const last4 = bill.card?.card_number_last4 ? `(*${bill.card.card_number_last4})` : ''

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        bgcolor: isPaid ? 'grey.50' : 'background.paper',
        '&:hover': onClick ? { boxShadow: 2 } : {}
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {bankName} {cardName} {last4}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            还款日: {bill.due_date ? format(new Date(bill.due_date), 'yyyy-MM-dd') : '未设置'}
          </Typography>
        </Box>

        <Chip
          label={isPaid ? '已结清' : isPartial ? '部分还款' : isOverdue ? '已逾期' : '待还款'}
          color={isPaid ? 'success' : isPartial ? 'info' : isOverdue ? 'error' : 'warning'}
          size="small"
          sx={{ fontWeight: 700 }}
        />
      </Box>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          最低还款: ¥{bill.min_payment || 0}
        </Typography>
        <Typography variant="h6" fontWeight={800} color={isPaid ? 'text.secondary' : 'error.main'}>
          ¥ {Number(bill.bill_amount).toFixed(2)}
        </Typography>
      </Stack>
    </Paper>
  )
}
