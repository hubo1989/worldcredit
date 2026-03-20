// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Box, Typography, IconButton, Skeleton, Fab } from '@mui/material'
import { ArrowBack, Add as AddIcon } from '@mui/icons-material'
import { getHolder } from '@/lib/api/holders'
import { getCardsByHolder, createCard } from '@/lib/api/cards'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import { CardForm } from '@/components/mobile/CardForm'
import type { CardHolder, CreditCard } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCard[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      const h = await getHolder(id)
      setHolder(h)
      const c = await getCardsByHolder(id)
      setCards(c)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  const handleCreateCard = async (data: Omit<CreditCard, 'id' | 'created_at'>) => {
    await createCard(data)
    loadData()
  }

  if (!holder && loading) return <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />
  if (!holder) return <Typography sx={{ p: 2 }}>持卡人不存在</Typography>

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>{holder.name}</Typography>
      </Box>

      {cards.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          还没有信用卡，点击右下角添加
        </Typography>
      ) : (
        cards.map(c => (
          <CreditCardVisual
            key={c.id}
            card={c}
            onClick={() => router.push(`/cards/${c.id}`)}
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

      <CardForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreateCard}
        holderId={id}
      />
    </Box>
  )
}
