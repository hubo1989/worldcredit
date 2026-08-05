// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Fab,
  Avatar, Card, CardContent
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  CreditCard as CreditCardIcon
} from '@mui/icons-material'
import { getHolder } from '@/lib/api/holders'
import { getCardsByHolder, deleteCard } from '@/lib/api/cards'
import { CardForm } from '@/components/mobile/CardForm'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import type { CardHolder, CreditCard } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCard[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCard | undefined>(undefined)
  const router = useRouter()

  const loadData = async () => {
    try {
      const [h, c] = await Promise.all([getHolder(id), getCardsByHolder(id)])
      setHolder(h)
      setCards(c)
    } catch (err) {
      console.error('Failed to load holder:', err)
    }
  }

  useEffect(() => { loadData() }, [id])

  const handleDeleteCard = async (card: CreditCard) => {
    if (!confirm(`确定删除「${card.bank_name} ${card.card_name}」吗？相关账单也将被删除。`)) return
    try {
      await deleteCard(card.id)
      loadData()
    } catch (err) {
      alert('删除失败：' + (err as any).message)
    }
  }

  if (!holder) return <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />

  return (
    <Box sx={{ p: 2, pb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => router.back()}>
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
          border: '2px dashed #eee'
        }}>
          <CreditCardIcon sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
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
        onSaved={loadData}
        initial={editingCard}
      />
    </Box>
  )
}
