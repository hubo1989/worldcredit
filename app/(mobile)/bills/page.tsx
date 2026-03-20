// app/(mobile)/bills/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Typography, Tabs, Tab, Skeleton } from '@mui/material'
import { getUnpaidBills, getBills } from '@/lib/api/bills'
import { BillCard } from '@/components/mobile/BillCard'
import type { Bill, CreditCard } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }

export default function BillsPage() {
  const [tab, setTab] = useState(0)
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 0) {
        const data = await getUnpaidBills()
        setBills(data as BillWithCard[])
      } else {
        const data = await getBills()
        setBills(data as BillWithCard[])
      }
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { loadData() }, [loadData])

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>账单管理</Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="未还清" />
        <Tab label="全部账单" />
      </Tabs>

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
          />
        ))
      )}
    </Box>
  )
}
