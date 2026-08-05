// app/(mobile)/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Typography, Skeleton, Alert, Button } from '@mui/material'
import { Refresh as RefreshIcon } from '@mui/icons-material'
import { DashboardSummary } from '@/components/mobile/DashboardSummary'
import { UpcomingBills } from '@/components/mobile/UpcomingBills'
import { ReminderStream } from '@/components/mobile/ReminderStream'
import { NotificationPermissionGuide } from '@/components/mobile/NotificationPermissionGuide'
import { getUnpaidBills } from '@/lib/api/bills'
import { getHoldersWithStats } from '@/lib/api/holders'
import type { HolderWithStats } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { useAuth } from '@/lib/auth'
import { asRole, getErrorMessage } from '@/lib/permissions'
import { useRouter } from 'next/navigation'
import type { Bill, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'> }

export default function HomePage() {
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [holders, setHolders] = useState<HolderWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user, profile } = useAuth()
  const router = useRouter()

  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    setError(null)
    try {
      const [billsData, holdersData] = await Promise.all([
        getUnpaidBills(),
        getHoldersWithStats(profile.id, asRole(profile)),
      ])
      setBills(billsData as BillWithCard[])
      setHolders(holdersData)
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [user, profile])

  useEffect(() => { loadData() }, [loadData])

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
        <Alert
          severity="error"
          action={
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadData}>
              重试
            </Button>
          }
        >
          {error}
        </Alert>
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

      <NotificationPermissionGuide />

      <ReminderStream />

      {holders.length > 0 && (
        <Box sx={{ mt: 3, mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={700}>持卡人</Typography>
            <Typography
              variant="body2"
              color="primary"
              sx={{ cursor: 'pointer' }}
              onClick={() => router.push('/holders')}
            >
              查看全部
            </Typography>
          </Box>
          {holders.map(holder => (
            <HolderCard
              key={holder.id}
              holder={holder}
              onClick={() => router.push(`/holders/${holder.id}`)}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
