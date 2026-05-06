// app/(mobile)/holders/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton, IconButton } from '@mui/material'
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { getHolders, createHolder, updateHolder, deleteHolder } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { useAuth } from '@/lib/auth'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingHolder, setEditingHolder] = useState<CardHolder | undefined>(undefined)
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders()
      setHolders(data)
      // Load card counts for each holder
      const counts: Record<string, number> = {}
      await Promise.all(
        data.map(async (h) => {
          try {
            const cards = await getCardsByHolder(h.id)
            counts[h.id] = cards.length
          } catch {
            counts[h.id] = 0
          }
        })
      )
      setCardCounts(counts)
    } catch (err) {
      console.error('Failed to load holders:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHolders() }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; avatar_color: string }) => {
    if (!user) return
    await createHolder({ ...data, managed_by: user.id } as any)
    loadHolders()
  }

  const handleEdit = async (data: { name: string; phone?: string; avatar_color: string }) => {
    if (!editingHolder) return
    await updateHolder(editingHolder.id, data)
    setEditingHolder(undefined)
    loadHolders()
  }

  const handleDelete = async (holder: CardHolder) => {
    if (!confirm(`确定删除持卡人「${holder.name}」吗？其下所有信用卡和账单也将被删除。`)) return
    try {
      await deleteHolder(holder.id)
      loadHolders()
    } catch (err) {
      alert('删除失败：' + (err as any).message)
    }
  }

  return (
    <Box sx={{ p: 2, pb: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>持卡人</Typography>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={80} sx={{ mb: 1.5, borderRadius: 3 }} />
        ))
      ) : holders.length === 0 ? (
        <Box sx={{
          textAlign: 'center', p: 4, bgcolor: '#fff', borderRadius: 4,
          border: '2px dashed #eee', mt: 4
        }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            还没有持卡人，点击右下角添加
          </Typography>
        </Box>
      ) : (
        holders.map(h => (
          <Box key={h.id} sx={{ position: 'relative' }}>
            <HolderCard
              holder={h}
              cardCount={cardCounts[h.id] || 0}
              onClick={() => router.push(`/holders/${h.id}`)}
            />
            <Box sx={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); setEditingHolder(h); setFormOpen(true) }}
                sx={{ bgcolor: 'rgba(255,255,255,0.9)' }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); handleDelete(h) }}
                sx={{ bgcolor: 'rgba(255,255,255,0.9)' }}
              >
                <DeleteIcon fontSize="small" color="error" />
              </IconButton>
            </Box>
          </Box>
        ))
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => { setEditingHolder(undefined); setFormOpen(true) }}
      >
        <AddIcon />
      </Fab>

      <HolderForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingHolder(undefined) }}
        onSubmit={editingHolder ? handleEdit : handleCreate}
        initial={editingHolder}
      />
    </Box>
  )
}
