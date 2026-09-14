'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton, Stack, Container, Button, Snackbar, Alert } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import MergeTypeIcon from '@mui/icons-material/MergeType'
import { getHolders, createHolder, updateHolder, getHolderCardCounts } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { MergeHoldersDialog } from '@/components/mobile/MergeHoldersDialog'
import { useAuth } from '@/lib/auth'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CardHolder | undefined>(undefined)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [toast, setToast] = useState<{ open: boolean; message: string }>({ open: false, message: '' })
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders(user?.id)
      setHolders(data)

      // 联查每个持卡人的信用卡数量
      if (data.length > 0) {
        const holderIds = data.map(h => h.id)
        setCardCounts(await getHolderCardCounts(holderIds))
      }
    } catch (err) {
      console.error('Failed to load holders:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadHolders()
  }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; email?: string; avatar_color: string }) => {
    if (!user) return
    await createHolder({ ...data, created_by: user.id })
    setFormOpen(false)
    loadHolders()
  }

  const handleUpdate = async (data: { name: string; phone?: string; email?: string; avatar_color: string }) => {
    if (!editing) return
    await updateHolder(editing.id, data)
    setEditing(undefined)
    setFormOpen(false)
    loadHolders()
  }

  const handleMergeSuccess = () => {
    setToast({ open: true, message: '🎉 持卡人已成功归拢合并！名下信用卡已全部转移。' })
    loadHolders()
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography
          variant="h5"
          sx={{
            fontSize: 'var(--type-title-size)',
            lineHeight: 'var(--type-title-line)',
            fontWeight: 'var(--type-title-weight)',
            letterSpacing: 'var(--type-title-tracking)',
            color: 'var(--text)',
          }}
        >
          持卡人管理
        </Typography>
        {holders.length > 1 && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<MergeTypeIcon />}
            onClick={() => setMergeDialogOpen(true)}
            sx={{
              borderRadius: 'var(--radius-pill)',
              fontWeight: 700,
              fontSize: 'var(--type-body-size)',
              letterSpacing: 'var(--type-body-tracking)',
              textTransform: 'none',
              borderColor: 'var(--navy-600)',
              color: 'var(--navy-600)',
            }}
          >
            合并归拢
          </Button>
        )}
      </Box>

      {loading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={88} sx={{ borderRadius: 'var(--radius-depth-2)' }} />
          ))}
        </Stack>
      ) : holders.length === 0 ? (
        <Box sx={{ mt: 8, textAlign: 'center', color: 'var(--muted)' }}>
          <Typography
            gutterBottom
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--text)',
            }}
          >
            还没有持卡人记录
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
            }}
          >
            点击右下角按钮添加您的第一个持卡人
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {holders.map(h => (
            <HolderCard
              key={h.id}
              holder={h}
              cardCount={cardCounts[h.id] || 0}
            onClick={() => router.push(`/holders/${h.id}`)}
            onEdit={() => { setEditing(h); setFormOpen(true) }}
          />
          ))}
        </Stack>
      )}

      <Fab
        aria-label="添加持卡人"
        sx={{
          position: 'fixed', bottom: 80, right: 24,
          width: 'var(--button-size)', height: 'var(--button-size)', minHeight: 'var(--button-size)',
          background: 'var(--button-face)', color: 'var(--text-on-dark)',
          boxShadow: 'var(--button-shadow)', border: 0,
          '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
          '&:active': { boxShadow: 'var(--button-shadow-press)' },
        }}
        onClick={() => setFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      <HolderForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined) }}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
      />

      <MergeHoldersDialog
        open={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        holders={holders}
        cardCounts={cardCounts}
        onSuccess={handleMergeSuccess}
      />

      <Snackbar
        open={toast.open}
        autoHideDuration={3500}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      >
        <Alert severity="success" sx={{ borderRadius: 'var(--radius-depth-1)', fontWeight: 600 }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
