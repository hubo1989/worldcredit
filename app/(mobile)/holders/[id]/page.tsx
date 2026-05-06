// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Fab, Avatar,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Alert, Stack,
} from '@mui/material'
import {
  ArrowBack, Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  BarChart as StatsIcon, CreditCard as CardIcon, AccountBalance as BankIcon,
  Link as LinkIcon,
} from '@mui/icons-material'
import { getHolder, getHolderDetailStats, updateHolder, deleteHolder } from '@/lib/api/holders'
import type { HolderStats } from '@/lib/api/holders'
import { createCard } from '@/lib/api/cards'
import { formatAmount } from '@/lib/utils'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import { CardForm } from '@/components/mobile/CardForm'
import { HolderForm } from '@/components/mobile/HolderForm'
import { HolderBindingDialog } from '@/components/mobile/HolderBindingDialog'
import { usePermission } from '@/lib/hooks/usePermission'
import type { CardHolder, CreditCard } from '@/lib/types'

function StatsCard({ stats }: { stats: HolderStats }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1.5,
        mb: 2,
      }}
    >
      <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'primary.50', border: 1, borderColor: 'primary.100' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <CardIcon sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="caption" color="primary.dark">持卡数量</Typography>
        </Box>
        <Typography variant="h6" fontWeight={700} color="primary.main">{stats.cardCount}</Typography>
      </Box>
      <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'grey.50', border: 1, borderColor: 'grey.200' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <BankIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">发卡银行</Typography>
        </Box>
        <Typography variant="h6" fontWeight={700}>{stats.bankCount}</Typography>
      </Box>
      <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: stats.pendingAmount > 0 ? 'error.50' : 'grey.50', border: 1, borderColor: stats.pendingAmount > 0 ? 'error.100' : 'grey.200' }}>
        <Typography variant="caption" color={stats.pendingAmount > 0 ? 'error.dark' : 'text.secondary'}>
          待还金额
        </Typography>
        <Typography variant="h6" fontWeight={700} color={stats.pendingAmount > 0 ? 'error.main' : 'text.primary'}>
          {formatAmount(stats.pendingAmount)}
        </Typography>
      </Box>
      <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: stats.pendingCardCount > 0 ? 'warning.50' : 'grey.50', border: 1, borderColor: stats.pendingCardCount > 0 ? 'warning.100' : 'grey.200' }}>
        <Typography variant="caption" color={stats.pendingCardCount > 0 ? 'warning.dark' : 'text.secondary'}>
          待还卡数
        </Typography>
        <Typography variant="h6" fontWeight={700} color={stats.pendingCardCount > 0 ? 'warning.main' : 'text.primary'}>
          {stats.pendingCardCount}
        </Typography>
      </Box>
    </Box>
  )
}

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCard[]>([])
  const [stats, setStats] = useState<HolderStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [editFormOpen, setEditFormOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()
  const { canManage } = usePermission()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, detail] = await Promise.all([
        getHolder(id),
        getHolderDetailStats(id),
      ])
      setHolder(h)
      setCards(detail.cards)
      setStats(detail.stats)
    } catch (err: any) {
      setError(err.message || '加载失败')
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
    setDeleting(true)
    try {
      await deleteHolder(id)
      router.push('/holders')
    } catch (err: any) {
      setDeleting(false)
    }
  }

  if (!holder && loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={150} />
      </Box>
    )
  }
  if (!holder) return <Typography sx={{ p: 2 }}>持卡人不存在</Typography>

  return (
    <Box sx={{ p: 2 }}>
      {/* 错误提示 */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 头部 */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()} sx={{ mr: 0.5 }}>
          <ArrowBack />
        </IconButton>
        <Avatar sx={{ bgcolor: holder.avatar_color, width: 36, height: 36, mr: 1, fontSize: '0.9rem', fontWeight: 700 }}>
          {holder.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>{holder.name}</Typography>
            {holder.auth_user_id && (
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: 'success.50',
                  border: 1,
                  borderColor: 'success.200',
                }}
              >
                <LinkIcon sx={{ fontSize: 12, color: 'success.main' }} />
                <Typography variant="caption" color="success.main" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
                  已绑定
                </Typography>
              </Box>
            )}
          </Box>
          {holder.phone && (
            <Typography variant="caption" color="text.secondary">{holder.phone}</Typography>
          )}
          {holder.email && (
            <Typography variant="caption" color="text.secondary" display="block">{holder.email}</Typography>
          )}
        </Box>
        {canManage && (
          <>
            <IconButton onClick={() => setBindingDialogOpen(true)} size="small" color="primary">
              <LinkIcon fontSize="small" />
            </IconButton>
            <IconButton onClick={() => setEditFormOpen(true)} size="small">
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton onClick={() => setDeleteDialogOpen(true)} color="error" size="small">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Box>

      {/* 统计卡片 */}
      {stats && <StatsCard stats={stats} />}

      {/* 历史账单统计入口 */}
      <Box
        onClick={() => router.push(`/holders/${id}/stats`)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          p: 1.5, mb: 2, borderRadius: 2,
          bgcolor: 'background.paper', border: 1, borderColor: 'divider',
          cursor: 'pointer',
          transition: 'all 0.2s',
          '&:hover': { bgcolor: 'grey.50', borderColor: 'primary.main' },
          '&:active': { bgcolor: 'grey.100' },
        }}
      >
        <StatsIcon color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" fontWeight={600}>历史账单统计</Typography>
          <Typography variant="caption" color="text.secondary">查看月度消费趋势和还款记录</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">›</Typography>
      </Box>

      {/* 信用卡列表 */}
      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1 }}>
        信用卡 ({cards.length})
      </Typography>
      {cards.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
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

      {canManage && (
        <Fab
          color="primary"
          sx={{ position: 'fixed', bottom: 80, right: 16 }}
          onClick={() => setCardFormOpen(true)}
        >
          <AddIcon />
        </Fab>
      )}

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

      <HolderBindingDialog
        open={bindingDialogOpen}
        onClose={() => setBindingDialogOpen(false)}
        holderId={id}
        holderName={holder.name}
        holderEmail={holder.email}
        isBound={!!holder.auth_user_id}
        onSuccess={loadData}
      />

      {/* 删除确认 - 前置检查 */}
      {canManage && <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除持卡人「{holder.name}」吗？</Typography>
          {cards.length > 0 && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              该持卡人下有 {cards.length} 张信用卡{stats && stats.pendingAmount > 0 && `，待还款 ${formatAmount(stats.pendingAmount)}`}，关联数据将被一并删除，此操作不可逆。
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>取消</Button>
          <Button color="error" variant="contained" onClick={handleDeleteHolder} disabled={deleting}>
            {deleting ? '删除中…' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>}
    </Box>
  )
}
