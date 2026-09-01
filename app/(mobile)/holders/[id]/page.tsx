// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Fab,
  Avatar
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  CreditCard as CreditCardIcon
} from '@mui/icons-material'
import { getHolder } from '@/lib/api/holders'
import { createCard, getCardsByHolder, updateCard, type CreditCardWithProduct } from '@/lib/api/cards'
import { CardForm } from '@/components/mobile/CardForm'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import type { CardHolder } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCardWithProduct[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardWithProduct | undefined>(undefined)
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([getHolder(id), getCardsByHolder(id)])
      setHolder(h)
      setCards(c)
    } catch (err) {
      console.error('Failed to load holder:', err)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (!holder) return <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />

  return (
    <Box sx={{ p: 2, pb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton aria-label="返回" onClick={() => router.back()}>
          <ArrowBackIcon />
        </IconButton>
        <Avatar sx={{ bgcolor: holder.avatar_color, width: 40, height: 40, ml: 1, mr: 1.5 }}>
          {holder.name.charAt(0)}
        </Avatar>
        <Typography variant="h6" fontWeight={700}>{holder.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          ({cards.length} 张卡)
        </Typography>
      </Box>

      {/* Card List */}
      {cards.length === 0 ? (
        <Box sx={{
          textAlign: 'center', p: 4, bgcolor: '#fff', borderRadius: 4,
          border: '2px dashed', borderColor: 'divider'
        }}>
          <CreditCardIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">暂无信用卡，点击右下角添加</Typography>
        </Box>
      ) : (
        cards.map(card => (
          <CreditCardVisual
            key={card.id}
            card={card}
            usedAmount={0}
            onClick={() => router.push(`/cards/${card.id}`)}
          />
        ))
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => { setEditingCard(undefined); setFormOpen(true) }}
      >
        <AddIcon />
      </Fab>

      <CardForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingCard(undefined) }}
        holderId={id}
        onSubmit={async (data) => {
          if (editingCard) {
            await updateCard(editingCard.id, data)
          } else {
            await createCard(data)
          }
          await loadData()
        }}
        initial={editingCard}
      />
    </Box>
  )
}
