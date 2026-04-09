// app/(mobile)/bills/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Card, CardContent,
  Divider, Button, LinearProgress, Chip,
} from '@mui/material'
import { ArrowBack } from '@mui/icons-material'
import { getBill } from '@/lib/api/bills'
import { getPaymentsByBill, createPayment } from '@/lib/api/payments'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO, format } from 'date-fns'
import type { Bill, CreditCard, Payment } from '@/lib/types'

type BillWithCard = Bill & {
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'>
}

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [bill, setBill] = useState<BillWithCard | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentFormOpen, setPaymentFormOpen] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const billData = await getBill(id) as BillWithCard
      setBill(billData)
      const pmts = await getPaymentsByBill(id)
      setPayments(pmts)
    } catch {
      setBill(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <Skeleton variant="rounded" height={300} sx={{ m: 2 }} />
  if (!bill) return <Typography sx={{ p: 2 }}>账单不存在</Typography>

  const card = bill.credit_cards
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const remaining = Number(bill.bill_amount) - totalPaid
  const paidPercent = Number(bill.bill_amount) > 0
    ? Math.min((totalPaid / Number(bill.bill_amount)) * 100, 100)
    : 0
  const daysLeft = differenceInDays(parseISO(bill.due_date), new Date())

  const handlePayment = async (data: { amount: number; paid_at: string; note?: string; channel: string }) => {
    await createPayment(id, data.amount, data.paid_at, data.note, data.channel)
    await loadData()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          {card.bank_name} · {bill.bill_month}
        </Typography>
      </Box>

      {/* 账单概览 */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">{card.card_name} {card.card_number_last4 ? `•••• ${card.card_number_last4}` : ''}</Typography>
          <Typography variant="h4" fontWeight={800} sx={{ my: 1 }}>
            {formatAmount(Number(bill.bill_amount), card.currency)}
          </Typography>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">已还 {formatAmount(totalPaid, card.currency)}</Typography>
            <Typography variant="body2" color="text.secondary">{paidPercent.toFixed(0)}%</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={paidPercent}
            color={paidPercent >= 100 ? 'success' : 'primary'}
            sx={{ height: 8, borderRadius: 4 }}
          />

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">最低还款额</Typography>
            <Typography>{formatAmount(Number(bill.min_payment), card.currency)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">还款截止日</Typography>
            <Typography>{bill.due_date}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography color="text.secondary">状态</Typography>
            <Chip
              label={
                bill.status === 'paid' ? '已还清' :
                bill.status === 'partial' ? `部分还款 (剩余 ${formatAmount(remaining, card.currency)})` :
                bill.status === 'overdue' ? '逾期' :
                daysLeft < 0 ? `逾期 ${Math.abs(daysLeft)} 天` :
                daysLeft === 0 ? '今天截止' :
                `${daysLeft} 天后截止`
              }
              size="small"
              color={
                bill.status === 'paid' ? 'success' :
                bill.status === 'overdue' || daysLeft < 0 ? 'error' :
                daysLeft <= 3 ? 'warning' : 'default'
              }
            />
          </Box>
        </CardContent>
      </Card>

      {/* 还款按钮 */}
      {bill.status !== 'paid' && (
        <Button
          fullWidth variant="contained" size="large"
          sx={{ mb: 3 }}
          onClick={() => setPaymentFormOpen(true)}
        >
          记录还款
        </Button>
      )}

      {/* 还款记录列表 */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        还款记录 ({payments.length})
      </Typography>

      {payments.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ py: 3 }}>
          暂无还款记录
        </Typography>
      ) : (
        payments.map(p => (
          <Card key={p.id} sx={{ mb: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {formatAmount(Number(p.amount), card.currency)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.paid_at} · {p.channel}
                  </Typography>
                </Box>
                {p.note && (
                  <Typography variant="caption" color="text.secondary">{p.note}</Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        ))
      )}

      <PaymentForm
        open={paymentFormOpen}
        onClose={() => setPaymentFormOpen(false)}
        onSubmit={handlePayment}
        bill={bill}
      />
    </Box>
  )
}
