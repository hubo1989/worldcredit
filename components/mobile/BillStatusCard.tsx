'use client'

import { Card, CardContent, Typography, Box, Stack, Chip, Divider } from '@mui/material'
import PaidIcon from '@mui/icons-material/CheckCircle'
import OverdueIcon from '@mui/icons-material/Warning'
import PendingIcon from '@mui/icons-material/AccessTime'
import AlertIcon from '@mui/icons-material/ErrorOutline'
import MoreIcon from '@mui/icons-material/ChevronRight'
import BankIcon from '@mui/icons-material/AccountBalance'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import { format } from 'date-fns'
import type { BillDashboardItem } from '@/lib/api/bills'

interface Props {
  bill: BillDashboardItem
  onClick?: () => void
}

export function BillStatusCard({ bill, onClick }: Props) {
  const getDueStatus = () => {
    if (bill.computed_status === 'paid') return { label: '已结清', color: 'success' as const, icon: <PaidIcon fontSize="small" /> }
    if (bill.days_until_due < 0) return { label: `逾期${Math.abs(bill.days_until_due)}天`, color: 'error' as const, icon: <OverdueIcon fontSize="small" /> }
    if (bill.days_until_due <= 3) return { label: `剩余${bill.days_until_due}天`, color: 'warning' as const, icon: <AlertIcon fontSize="small" /> }
    if (bill.computed_status === 'partial') return { label: `已还¥${bill.paid_amount.toLocaleString()}`, color: 'info' as const, icon: <PendingIcon fontSize="small" /> }
    return { label: `剩余${bill.days_until_due}天`, color: 'primary' as const, icon: <PendingIcon fontSize="small" /> }
  }

  const status = getDueStatus()
  const isPaid = bill.computed_status === 'paid'
  const product = bill.card?.card_product
  const cardTail = bill.card?.card_number_last4 ? `尾号 ${bill.card.card_number_last4}` : '未记录尾号'

  return (
    <Card 
      onClick={onClick}
      sx={{ 
        mb: 2, 
        borderRadius: '5px', 
        border: '1px solid #DDDDDD',
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
        bgcolor: '#FFFFFF',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 200ms ease',
        '&:hover': onClick ? { boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)' } : {}
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <BankIcon color="action" fontSize="small" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={800} noWrap>
                {product?.bank_name || '未知银行'} {product?.card_name || ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {cardTail} · {bill.bill_month} 账单
              </Typography>
            </Box>
          </Stack>
          <Chip 
            label={status.label} 
            size="small" 
            color={status.color}
            icon={status.icon}
            sx={{ fontWeight: 600, height: 24, flexShrink: 0 }}
          />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">账单额</Typography>
            <Typography variant="h6" fontWeight={800} color={isPaid ? 'text.secondary' : 'text.primary'}>
              ¥{Number(bill.bill_amount).toLocaleString()}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary">剩余欠款</Typography>
            <Typography variant="h6" fontWeight={800} color={bill.remaining_amount > 0 ? 'error.main' : 'success.main'}>
              ¥{bill.remaining_amount.toLocaleString()}
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, alignItems: 'center' }}>
          <Box>
            <Typography variant="caption" color="text.secondary">最低还款</Typography>
            <Typography variant="body2" fontWeight={600}>¥{Number(bill.min_payment || 0).toLocaleString()}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">已还</Typography>
            <Typography variant="body2" fontWeight={600}>¥{bill.paid_amount.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary">到期日</Typography>
            <Typography variant="body2" fontWeight={700}>{format(new Date(bill.due_date), 'MM-dd')}</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              免息期剩余：{bill.interest_free_days_left} 天
            </Typography>
            {!!bill.attachments?.length && (
              <Chip
                size="small"
                variant="outlined"
                icon={<AttachFileIcon sx={{ fontSize: 14 }} />}
                label={`${bill.attachments.length} 个附件`}
                sx={{ height: 22, '& .MuiChip-label': { px: 0.75 } }}
              />
            )}
          </Stack>
          {onClick && <MoreIcon color="action" sx={{ fontSize: 18 }} />}
        </Box>
      </CardContent>
    </Card>
  )
}
