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
        <IconButton
          aria-label="返回"
          onClick={() => router.back()}
          sx={{
            width: 'var(--button-size)',
            height: 'var(--button-size)',
            background: 'var(--button-face)',
            color: 'var(--text-on-dark)',
            boxShadow: 'var(--button-shadow)',
            '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
            '&:active': { boxShadow: 'var(--button-shadow-press)' },
          }}
        >
          <ArrowBackIcon />
        </IconButton>
        <Avatar sx={{ bgcolor: holder.avatar_color, width: 40, height: 40, ml: 1, mr: 1.5 }}>
          {holder.name.charAt(0)}
        </Avatar>
        <Typography
          variant="h6"
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
          }}
        >
          {holder.name}
        </Typography>
        <Typography
          sx={{
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-line)',
            letterSpacing: 'var(--type-body-tracking)',
            color: 'var(--muted)',
            ml: 1,
          }}
        >
          ({cards.length} 张卡)
        </Typography>
      </Box>

      {/* Card List */}
      {cards.length === 0 ? (
        <Box sx={{
          textAlign: 'center', p: 4, bgcolor: 'var(--paper)', borderRadius: 'var(--radius-depth-3)',
          border: '2px dashed', borderColor: 'var(--track)',
        }}>
          <CreditCardIcon sx={{ fontSize: 48, color: 'var(--text-disabled)', mb: 1 }} />
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
            }}
          >
            暂无信用卡，点击右下角添加
          </Typography>
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
        aria-label="添加信用卡"
        sx={{
          position: 'fixed', bottom: 72, right: 16,
          width: 'var(--button-size)', height: 'var(--button-size)', minHeight: 'var(--button-size)',
          background: 'var(--button-face)', color: 'var(--text-on-dark)',
          boxShadow: 'var(--button-shadow)', border: 0,
          '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
          '&:active': { boxShadow: 'var(--button-shadow-press)' },
        }}
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
