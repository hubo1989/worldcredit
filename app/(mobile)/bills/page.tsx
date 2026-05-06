// app/(mobile)/bills/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Skeleton, Chip, Stack } from '@mui/material'
import { getUnpaidBills } from '@/lib/api/bills'
import { getAllCards } from '@/lib/api/cards'
import { getPaymentsByBill, createPayment, recalcBillStatus } from '@/lib/api/payments'
import { BillCard } from '@/components/mobile/BillCard'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { formatAmount } from '@/lib/utils'
import type { CreditCard, Bill, Payment } from '@/lib/types'

export default function BillsPage() {
  const [bills, setBills] = useState<any[]>([])
  const [cards, setCards] = useState<Record<string, CreditCard>>({})
  const [payments, setPayments] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'overdue' | 'paid'>('all')
  const [payFormOpen, setPayFormOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<any>(null)
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      const [allCards, allBills] = await Promise.all([
        getAllCards(),
        getUnpaidBills(),
      ])

      const cardMap: Record<string, CreditCard> = {}
      allCards.forEach(c => { cardMap[c.id] = c })
      setCards(cardMap)

      // Load payments for unpaid bills
      const paymentMap: Record<string, number> = {}
      await Promise.all(
        allBills.map(async (b: any) => {
          try {
            const p = await getPaymentsByBill(b.id)
            paymentMap[b.id] = p.reduce((s: number, pmt: Payment) => s + pmt.amount, 0)
          } catch { paymentMap[b.id] = 0 }
        })
      )
      setPayments(paymentMap)
      setBills(allBills)
    } catch (err) {
      console.error('Failed to load bills:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handlePayment = async (data: { amount: number; paid_at: string; channel: string; note?: string }) => {
    if (!selectedBill) return
    try {
      await createPayment({ bill_id: selectedBill.id, ...data })
      await recalcBillStatus(selectedBill.id, selectedBill.bill_amount)
      loadData()
      setPayFormOpen(false)
    } catch (err) {
      alert('还款失败：' + (err as any).message)
    }
  }

  const totalUnpaid = bills
    .filter((b: any) => b.status !== 'paid')
    .reduce((sum: number, b: any) => sum + (b.bill_amount - (payments[b.id] || 0)), 0)

  const filteredBills = filter === 'all' ? bills : bills.filter((b: any) => {
    if (filter === 'unpaid') return b.status === 'unpaid' || b.status === 'partial'
    return b.status === filter
  })

  return (
    <Box sx={{ p: 2, pb: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>账单</Typography>

      {/* Summary */}
      <Box sx={{
        p: 2, bgcolor: 'primary.main', color: 'white', borderRadius: 3, mb: 2
      }}>
        <Typography variant="body2" sx={{ opacity: 0.8 }}>待还总额</Typography>
        <Typography variant="h5" fontWeight={700}>
          {formatAmount(totalUnpaid)}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
          共 {bills.filter((b: any) => b.status !== 'paid').length} 笔待还
        </Typography>
      </Box>

      {/* Filter */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {[
          { key: 'all' as const, label: '全部' },
          { key: 'unpaid' as const, label: '待还' },
          { key: 'overdue' as const, label: '逾期' },
          { key: 'paid' as const, label: '已还' },
        ].map(f => (
          <Chip
            key={f.key}
            label={f.label}
            variant={filter === f.key ? 'filled' : 'outlined'}
            color={filter === f.key ? 'primary' : 'default'}
            onClick={() => setFilter(f.key)}
            size="small"
          />
        ))}
      </Stack>

      {/* Bill List */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={100} sx={{ mb: 1.5, borderRadius: 3 }} />
        ))
      ) : filteredBills.length === 0 ? (
        <Box sx={{
          textAlign: 'center', p: 4, bgcolor: '#fff', borderRadius: 4,
          border: '2px dashed #eee'
        }}>
          <Typography color="text.secondary">
            {filter === 'all' ? '暂无账单记录' : '暂无符合条件的账单'}
          </Typography>
        </Box>
      ) : (
        filteredBills.map((bill: any) => (
          <BillCard
            key={bill.id}
            bill={bill}
            card={cards[bill.card_id]}
            paidAmount={payments[bill.id] || 0}
            onRecordPayment={() => { setSelectedBill(bill); setPayFormOpen(true) }}
            onClick={() => router.push(`/cards/${bill.card_id}`)}
          />
        ))
      )}

      {selectedBill && (
        <PaymentForm
          open={payFormOpen}
          onClose={() => setPayFormOpen(false)}
          onSubmit={handlePayment}
          billAmount={selectedBill.bill_amount}
          paidAmount={payments[selectedBill.id] || 0}
          currency={cards[selectedBill.card_id]?.currency || 'CNY'}
        />
      )}
    </Box>
  )
}
