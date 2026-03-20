// app/(mobile)/cards/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Card, CardContent,
  Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button
} from '@mui/material'
import { ArrowBack, Delete as DeleteIcon } from '@mui/icons-material'
import { getCard, deleteCard } from '@/lib/api/cards'
import { formatAmount } from '@/lib/utils'
import type { CreditCard } from '@/lib/types'

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [card, setCard] = useState<CreditCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    getCard(id).then(setCard).catch(() => setCard(null)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <Skeleton variant="rounded" height={300} sx={{ m: 2 }} />
  if (!card) return <Typography sx={{ p: 2 }}>卡片不存在</Typography>

  const handleDelete = async () => {
    await deleteCard(id)
    router.back()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{card.bank_name}</Typography>
        <IconButton onClick={() => setDeleteDialogOpen(true)} color="error"><DeleteIcon /></IconButton>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h5" color="primary" sx={{ mb: 2 }}>
            {card.card_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            卡号后四位: {card.card_number_last4 || '--'}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">总额度</Typography>
            <Typography fontWeight={700}>{formatAmount(card.credit_limit, card.currency)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">账单日</Typography>
            <Typography>每月 {card.billing_day} 号</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">还款日</Typography>
            <Typography>
              {card.payment_due_type === 'fixed' ? `每月 ${card.payment_due_value} 号` : `账单日后 ${card.payment_due_value} 天`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">年费</Typography>
            <Typography>{formatAmount(card.annual_fee, card.currency)}</Typography>
          </Box>
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">免年费条件: </Typography>
            <Typography variant="body2">{card.annual_fee_waiver || '无'}</Typography>
          </Box>
        </CardContent>
      </Card>
      
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        权益与账单 (待实现)
      </Typography>

      {/* 删除确认对话框 — 替代 window.confirm */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除信用卡「{card.card_name}」吗？此操作不可逆。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
