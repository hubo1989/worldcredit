// app/(mobile)/bills/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { getUnpaidBills, getBills, createBill } from '@/lib/api/bills'
import { getCardsByHolder } from '@/lib/api/cards'
import { getHolders } from '@/lib/api/holders'
import { BillCard } from '@/components/mobile/BillCard'
import { BillForm } from '@/components/mobile/BillForm'
import { useAuth } from '@/lib/auth'
import type { Bill, CreditCard, CardHolder } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }

export default function BillsPage() {
  const [tab, setTab] = useState(0)
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [cardOptions, setCardOptions] = useState<{ id: string; label: string; card: CreditCard }[]>([])
  const { user } = useAuth()
  const router = useRouter()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = tab === 0 ? await getUnpaidBills() : await getBills()
      setBills(data as BillWithCard[])
    } finally {
      setLoading(false)
    }
  }, [tab])

  const loadCardOptions = useCallback(async () => {
    if (!user) return
    try {
      const holders = await getHolders()
      const allCards: { id: string; label: string; card: CreditCard }[] = []
      await Promise.all(
        holders.map(async (h) => {
          const cards = await getCardsByHolder(h.id)
          cards.forEach(c => {
            allCards.push({
              id: c.id,
              label: `${h.name} - ${c.bank_name} ${c.card_name}`,
              card: c,
            })
          })
        })
      )
      setCardOptions(allCards)
    } catch {
      // ignore — user may not have data yet
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadCardOptions() }, [loadCardOptions])

  const handleCreateBill = async (data: Omit<Bill, 'id' | 'created_at' | 'status'>) => {
    await createBill({ ...data, status: 'unpaid' })
    loadData()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>账单管理</Typography>

      {/* Tab 切换 */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {['未还清', '全部账单'].map((label, i) => (
          <Box
            key={label}
            onClick={() => setTab(i)}
            sx={{
              px: 2, py: 0.5, borderRadius: 2, cursor: 'pointer',
              bgcolor: tab === i ? 'primary.main' : 'grey.200',
              color: tab === i ? 'white' : 'text.primary',
              fontWeight: tab === i ? 700 : 400,
              fontSize: '0.875rem',
              transition: 'all 0.2s',
            }}
          >
            {label}
          </Box>
        ))}
      </Box>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={100} sx={{ mb: 1.5 }} />
        ))
      ) : bills.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          {tab === 0 ? '目前没有需要还款的账单' : '还没有任何账单记录'}
        </Typography>
      ) : (
        bills.map(b => (
          <BillCard
            key={b.id}
            bill={b}
            onClick={() => router.push(`/bills/${b.id}`)}
          />
        ))
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => setFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      <BillForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreateBill}
        cards={cardOptions}
      />
    </Box>
  )
}
