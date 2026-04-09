// app/(mobile)/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { DashboardSummary } from '@/components/mobile/DashboardSummary'
import { UpcomingBills } from '@/components/mobile/UpcomingBills'
import { getUnpaidBills } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import { HolderCard } from '@/components/mobile/HolderCard'
import { useRouter } from 'next/navigation'
import type { Bill, CardHolder, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'> }

export default function HomePage() {
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    Promise.all([
      getUnpaidBills(),
      getHolders()
    ]).then(async ([billsData, holdersData]) => {
      setBills(billsData as BillWithCard[])
      setHolders(holdersData)
      // 查询每个持卡人的卡数量
      const counts: Record<string, number> = {}
      await Promise.all(
        holdersData.map(async (h) => {
          const cards = await getCardsByHolder(h.id)
          counts[h.id] = cards.length
        })
      )
      setCardCounts(counts)
    }).catch((err) => {
      setError(err.message || '数据加载失败')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={180} sx={{ mb: 3 }} />
        <Skeleton variant="text" width="60%" height={40} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={100} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={100} sx={{ mb: 2 }} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', mt: 4 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={800}>WorldCredit</Typography>
      </Box>

      <DashboardSummary bills={bills} />

      <UpcomingBills bills={bills} />

      <Box sx={{ mt: 4, mb: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>持卡人</Typography>
        {holders.map((holder) => (
          <HolderCard
            key={holder.id}
            holder={holder}
            cardCount={cardCounts[holder.id] ?? 0}
            onClick={() => router.push(`/holders/${holder.id}`)}
          />
        ))}
      </Box>
    </Box>
  )
}
