// app/(mobile)/bills/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Card, CardContent,
  Divider, Button, LinearProgress, Chip,
} from '@mui/material'
import { ArrowBack } from '@mui/icons-material'
import { getBill, getBillItems } from '@/lib/api/bills'
import { getPaymentsByBill, createPayment } from '@/lib/api/payments'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { calculateBillPaymentHealth, DEFAULT_DAILY_INTEREST_RATE } from '@/lib/billHealth'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO } from 'date-fns'
import type { Bill, BillItem, CreditCard, Payment } from '@/lib/types'

type BillWithCard = Bill & {
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'>
}

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [bill, setBill] = useState<BillWithCard | null>(null)
  const [items, setItems] = useState<BillItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentFormOpen, setPaymentFormOpen] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [billData, itemData, pmts] = await Promise.all([
        getBill(id) as Promise<BillWithCard>,
        getBillItems(id),
        getPaymentsByBill(id),
      ])
      setBill(billData)
      setItems(itemData)
      setPayments(pmts)
    } catch {
      setBill(null)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <Skeleton variant="rounded" height={300} sx={{ m: 2 }} />
  if (!bill) return <Typography sx={{ p: 2 }}>账单不存在</Typography>

  const card = bill.credit_cards
  const paymentHealth = calculateBillPaymentHealth(bill, items, payments)
  const totalPaid = paymentHealth.totalPaid
  const remaining = paymentHealth.remainingBalance
  const paidPercent = Number(bill.bill_amount) > 0
    ? Math.min((totalPaid / Number(bill.bill_amount)) * 100, 100)
    : 0
  const daysLeft = differenceInDays(parseISO(bill.due_date), new Date())
  const itemTotal = items.reduce((sum, item) => sum + Number(item.amount), 0)

  const handlePayment = async (data: { amount: number; paid_at: string; note?: string; channel: string }) => {
    await createPayment(id, data.amount, data.paid_at, data.note, data.channel)
    await loadData()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton aria-label="返回" onClick={() => router.back()}>
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

      {/* 还款健康 */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
            还款健康
          </Typography>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography color="text.secondary">最低还款</Typography>
            <Chip
              label={paymentHealth.minPaymentCovered ? '已覆盖' : '未覆盖'}
              size="small"
              color={paymentHealth.minPaymentCovered ? 'success' : 'warning'}
            />
          </Box>

          {!paymentHealth.minPaymentCovered && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography color="text.secondary">还差</Typography>
              <Typography fontWeight={700} color="warning.main">
                {formatAmount(paymentHealth.minPaymentShortfall, card.currency)}
              </Typography>
            </Box>
          )}

          <Divider sx={{ my: 1.5 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography color="text.secondary">预估利息</Typography>
            <Typography fontWeight={800} color={paymentHealth.estimatedInterest > 0 ? 'error.main' : 'success.main'}>
              {formatAmount(paymentHealth.estimatedInterest, card.currency)}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" display="block">
            按逐笔交易日计息，日利率 {(DEFAULT_DAILY_INTEREST_RATE * 100).toFixed(2)}%，估算至 {paymentHealth.estimatedThrough}
          </Typography>
          {paymentHealth.usedFallbackDates && (
            <Typography variant="caption" color="text.secondary" display="block">
              部分明细缺少交易日，已用入账日或账单日期估算。
            </Typography>
          )}
          {paymentHealth.interestItemCount === 0 && (
            <Typography variant="caption" color="text.secondary" display="block">
              暂无可计息账单明细，当前利息仅作为占位估算。
            </Typography>
          )}
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

      {/* 账单明细列表 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          账单明细 ({items.length})
        </Typography>
        {items.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            合计 {formatAmount(itemTotal, card.currency)}
          </Typography>
        )}
      </Box>

      {items.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ py: 3, mb: 1 }}>
          暂无账单明细
        </Typography>
      ) : (
        <Box sx={{ mb: 3 }}>
          {items.map(item => (
            <Card key={item.id} sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {item.merchant_name || item.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.transaction_date || item.post_date || '未记录日期'}
                      {item.category ? ` · ${item.category}` : ''}
                      {item.source === 'llm' && item.confidence != null ? ` · ${(item.confidence * 100).toFixed(0)}%` : ''}
                    </Typography>
                    {item.merchant_name && item.description !== item.merchant_name && (
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {item.description}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                    {formatAmount(Number(item.amount), item.currency || card.currency)}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
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
