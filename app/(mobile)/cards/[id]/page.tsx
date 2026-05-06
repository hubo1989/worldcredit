// app/(mobile)/cards/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Card, CardContent,
  Divider, Button, Fab, Chip
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
} from '@mui/icons-material'
import { getCard } from '@/lib/api/cards'
import { getBillsByCard } from '@/lib/api/bills'
import { getPaymentsByBill, createPayment, recalcBillStatus } from '@/lib/api/payments'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { formatAmount, getBillStatusColor, getBillStatusText, daysUntilDue } from '@/lib/utils'
import type { CreditCard, Bill, Payment } from '@/lib/types'

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [card, setCard] = useState<CreditCard | null>(null)
  const [bills, setBills] = useState<(Bill & { payments: Payment[] })[]>([])
  const [payFormOpen, setPayFormOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const router = useRouter()

  const loadData = async () => {
    try {
      const c = await getCard(id)
      setCard(c)
      const b = await getBillsByCard(id)
      // Load payments for each bill
      const billsWithPayments = await Promise.all(
        b.map(async (bill) => {
          const payments = await getPaymentsByBill(bill.id).catch(() => [] as Payment[])
          const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
          return { ...bill, payments, totalPaid }
        })
      )
      // Sort: unpaid/overdue first, then by due_date
      billsWithPayments.sort((a, b) => {
        const statusOrder = { overdue: 0, unpaid: 1, partial: 2, paid: 3 }
        const so = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
        if (so !== 0) return so
        return new Date(b.due_date).getTime() - new Date(a.due_date).getTime()
      })
      setBills(billsWithPayments as any)
    } catch (err) {
      console.error('Failed to load card:', err)
    }
  }

  useEffect(() => { loadData() }, [id])

  const handlePayment = async (data: { amount: number; paid_at: string; channel: string; note?: string }) => {
    if (!selectedBill) return
    try {
      await createPayment({
        bill_id: selectedBill.id,
        ...data,
      })
      await recalcBillStatus(selectedBill.id, selectedBill.bill_amount)
      loadData()
      setPayFormOpen(false)
    } catch (err) {
      alert('还款失败：' + (err as any).message)
    }
  }

  if (!card) {
    return <Box sx={{ p: 2 }}><Typography>加载中...</Typography></Box>
  }

  const totalUsed = bills
    .filter(b => b.status !== 'paid')
    .reduce((sum, b) => sum + b.bill_amount - (b.totalPaid || 0), 0)

  return (
    <Box sx={{ p: 2, pb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, ml: 1 }}>
          <Typography variant="h6" fontWeight={700}>{card.bank_name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {card.card_name} {card.card_number_last4 ? `•••• ${card.card_number_last4}` : ''}
          </Typography>
        </Box>
        <Chip
          label={card.status === 'active' ? '正常' : card.status === 'frozen' ? '冻结' : '已注销'}
          color={card.status === 'active' ? 'success' : 'default'}
          size="small"
        />
      </Box>

      {/* Credit Limit Card */}
      <Card sx={{ borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">信用额度</Typography>
          <Typography variant="h5" fontWeight={700}>{formatAmount(card.credit_limit, card.currency)}</Typography>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">已用</Typography>
              <Typography variant="body2" fontWeight={600} color="error">
                {formatAmount(totalUsed, card.currency)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">可用</Typography>
              <Typography variant="body2" fontWeight={600} color="success.main">
                {formatAmount(card.credit_limit - totalUsed, card.currency)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">账单日</Typography>
              <Typography variant="body2" fontWeight={600}>每月 {card.billing_day} 号</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Annual Fee Info */}
      {card.annual_fee > 0 && (
        <Card sx={{ borderRadius: 3, mb: 2 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                年费 {formatAmount(card.annual_fee, card.currency)}
              </Typography>
              {card.annual_fee_waiver && (
                <Typography variant="body2" color="primary">
                  {card.annual_fee_waiver}
                </Typography>
              )}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Bills */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>账单记录</Typography>
      {bills.length === 0 ? (
        <Box sx={{
          textAlign: 'center', p: 3, bgcolor: '#fff', borderRadius: 4,
          border: '2px dashed #eee'
        }}>
          <Typography color="text.secondary">暂无账单记录</Typography>
        </Box>
      ) : (
        <List disablePadding>
          {bills.map(bill => {
            const days = daysUntilDue(bill.due_date)
            const paidAmount = bill.payments?.reduce((s: number, p: Payment) => s + p.amount, 0) || 0
            return (
              <Card key={bill.id} sx={{ mb: 1.5, borderRadius: 3 }}>
                <CardContent sx={{ pb: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {bill.bill_month} 账单
                    </Typography>
                    <Chip
                      label={getBillStatusText(bill.status)}
                      size="small"
                      sx={{ bgcolor: getBillStatusColor(bill.status), color: '#fff' }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2">
                      账单: {formatAmount(bill.bill_amount, card.currency)}
                    </Typography>
                    <Typography variant="body2">
                      已还: {formatAmount(paidAmount, card.currency)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    还款日: {bill.due_date}
                    {bill.status !== 'paid' && days >= 0 && (
                      <Typography component="span" color={days <= 3 ? 'error' : 'text.secondary'}>
                        {' '}(还剩 {days} 天)
                      </Typography>
                    )}
                  </Typography>

                  {/* Payment records */}
                  {bill.payments?.length > 0 && (
                    <Box sx={{ mt: 1, pl: 1, borderLeft: '2px solid #e0e0e0' }}>
                      {bill.payments.map((p: Payment) => (
                        <Typography key={p.id} variant="caption" display="block" color="text.secondary">
                          {p.paid_at} {formatAmount(p.amount, card.currency)} ({p.channel})
                        </Typography>
                      ))}
                    </Box>
                  )}

                  {bill.status !== 'paid' && (
                    <Button
                      size="small" variant="outlined" sx={{ mt: 1, borderRadius: 2 }}
                      onClick={() => { setSelectedBill(bill); setPayFormOpen(true) }}
                    >
                      记录还款
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </List>
      )}

      {/* Add bill placeholder - TODO: implement BillForm */}
      <Fab
        color="primary"
        size="medium"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => alert('账单录入功能将在后续版本实现')}
      >
        <AddIcon />
      </Fab>

      {selectedBill && (
        <PaymentForm
          open={payFormOpen}
          onClose={() => setPayFormOpen(false)}
          onSubmit={handlePayment}
          billAmount={selectedBill.bill_amount}
          paidAmount={selectedBill.payments?.reduce((s: number, p: Payment) => s + p.amount, 0) || 0}
          currency={card.currency}
        />
      )}
    </Box>
  )
}
