// app/(mobile)/holders/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { getHolders, createHolder } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { useAuth } from '@/lib/auth'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders()
      setHolders(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHolders() }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; avatar_color: string }) => {
    if (!user) throw new Error('未登录')
    await createHolder({ ...data, managed_by: user.id })
    loadHolders()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>持卡人</Typography>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={80} sx={{ mb: 1.5 }} />
        ))
      ) : holders.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          还没有持卡人，点击右下角添加
        </Typography>
      ) : (
        holders.map(h => (
          <HolderCard
            key={h.id}
            holder={h}
            cardCount={0}  // TODO: 从 credit_cards 查询
            onClick={() => router.push(`/holders/${h.id}`)}
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

      <HolderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />
    </Box>
  )
}
