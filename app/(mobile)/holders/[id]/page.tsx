// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Fab,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from '@mui/material'
import { ArrowBack, Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { getHolder, updateHolder, deleteHolder } from '@/lib/api/holders'
import { getCardsByHolder, createCard } from '@/lib/api/cards'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import { CardForm } from '@/components/mobile/CardForm'
import { HolderForm } from '@/components/mobile/HolderForm'
import type { CardHolder, CreditCard } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCard[]>([])
  const [loading, setLoading] = useState(true)
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [editFormOpen, setEditFormOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
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

  const handleEditHolder = async (data: { name: string; phone?: string; avatar_color: string }) => {
    await updateHolder(id, data)
    loadData()
  }

  const handleDeleteHolder = async () => {
    await deleteHolder(id)
    router.push('/holders')
  }

  if (!holder && loading) return <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />
  if (!holder) return <Typography sx={{ p: 2 }}>持卡人不存在</Typography>

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{holder.name}</Typography>
        <IconButton onClick={() => setEditFormOpen(true)}>
          <EditIcon />
        </IconButton>
        <IconButton onClick={() => setDeleteDialogOpen(true)} color="error">
          <DeleteIcon />
        </IconButton>
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
        onClick={() => setCardFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      <CardForm
        open={cardFormOpen}
        onClose={() => setCardFormOpen(false)}
        onSubmit={handleCreateCard}
        holderId={id}
      />

      <HolderForm
        open={editFormOpen}
        onClose={() => setEditFormOpen(false)}
        onSubmit={handleEditHolder}
        initial={holder}
      />

      {/* 删除确认 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除持卡人「{holder.name}」吗？关联的信用卡和账单也将被删除，此操作不可逆。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleDeleteHolder}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
