'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton, Stack, Container } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { getHolders, createHolder } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { useAuth } from '@/lib/auth'
import { db } from '@/lib/insforge'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders()
      setHolders(data)

      // 联查每个持卡人的信用卡数量
      if (data.length > 0) {
        const holderIds = data.map(h => h.id)
        const { data: cards } = await db
          .from('credit_cards')
          .select('holder_id')
          .in('holder_id', holderIds)
        const counts: Record<string, number> = {}
        cards?.forEach((c: { holder_id: string }) => {
          counts[c.holder_id] = (counts[c.holder_id] || 0) + 1
        })
        setCardCounts(counts)
      }
    } catch (err) {
      console.error('Failed to load holders:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHolders()
  }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; avatar_color: string }) => {
    if (!user) return
    await createHolder({ ...data, created_by: user.id })
    loadHolders()
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        持卡人
      </Typography>

      {loading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={88} sx={{ borderRadius: 3 }} />
          ))}
        </Stack>
      ) : holders.length === 0 ? (
        <Box sx={{ mt: 8, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body1" gutterBottom>还没有持卡人记录</Typography>
          <Typography variant="body2">点击右下角按钮添加您的第一个持卡人</Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {holders.map(h => (
            <HolderCard
              key={h.id}
              holder={h}
              cardCount={cardCounts[h.id] || 0}
              onClick={() => router.push(`/holders/${h.id}`)}
            />
          ))}
        </Stack>
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 80, right: 24 }}
        onClick={() => setFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      <HolderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />
    </Container>
  )
}
