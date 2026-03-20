// app/(mobile)/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Box, Typography, Skeleton, Grid } from '@mui/material'
import { DashboardSummary } from '@/components/mobile/DashboardSummary'
import { UpcomingBills } from '@/components/mobile/UpcomingBills'
import { getUnpaidBills } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { useRouter } from 'next/navigation'
import type { Bill, CardHolder, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'> }

export default function HomePage() {
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    Promise.all([
      getUnpaidBills(),
      getHolders()
    ]).then(([billsData, holdersData]) => {
      setBills(billsData as BillWithCard[])
      setHolders(holdersData)
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
        <Grid container spacing={2}>
          {holders.map((holder) => (
            <Grid key={holder.id} size={12}>
              <HolderCard 
                holder={holder} 
                cardCount={0} 
                onClick={() => router.push(`/holders/${holder.id}`)} 
              />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  )
}
