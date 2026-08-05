'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  Box, Typography, Container, IconButton, Paper,
  Stack, Divider, Button, Skeleton, Alert, Fab
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import PhoneIcon from '@mui/icons-material/Phone'
import CalendarIcon from '@mui/icons-material/CalendarMonth'
import AddIcon from '@mui/icons-material/Add'
import StatsIcon from '@mui/icons-material/BarChart'
import CardIcon from '@mui/icons-material/CardGiftcard'
import BankIcon from '@mui/icons-material/AccountBalance'
import { getHolder, getHolderDetailStats, updateHolder, deleteHolder } from '@/lib/api/holders'
import type { HolderStats } from '@/lib/api/holders'
import { formatAmount } from '@/lib/utils'
import { getCardsByHolder, createCard, updateCard, deleteCard } from '@/lib/api/cards'
import { HolderForm } from '@/components/mobile/HolderForm'
import { CreditCardItem } from '@/components/mobile/CreditCardItem'
import { CardForm } from '@/components/mobile/CardForm'
import type { CardHolder, CreditCard, CardProduct } from '@/lib/types'
import { format } from 'date-fns'

export default function HolderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<(CreditCard & { card_product: CardProduct })[]>([])
  const [stats, setStats] = useState<HolderStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  const [editHolderOpen, setEditHolderOpen] = useState(false)
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCard | undefined>(undefined)
  
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [holderData, cardsData, detailData] = await Promise.all([
        getHolder(id),
        getCardsByHolder(id),
        getHolderDetailStats(id),
      ])
      setHolder(holderData)
      setCards(cardsData)
      setStats(detailData.stats)
    } catch (err: any) {
      setError(err.message || '加载详情失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  const handleUpdateHolder = async (data: { name: string; phone?: string; avatar_color: string }) => {
    if (!holder) return
    await updateHolder(holder.id, data)
    loadData()
  }

  const handleDeleteHolder = async () => {
    if (!holder) return
    if (window.confirm(`确定要删除持卡人 "${holder.name}" 吗？此操作不可撤销，且会删除名下所有信用卡。`)) {
      try {
        await deleteHolder(holder.id)
        router.push('/holders')
      } catch (err: any) {
        alert('删除失败: ' + err.message)
      }
    }
  }

  const handleCardSubmit = async (data: Omit<CreditCard, 'id' | 'created_at'>) => {
    if (editingCard) {
      await updateCard(editingCard.id, data)
    } else {
      await createCard(data)
    }
    loadData()
  }

  const handleEditCard = (card: CreditCard & { card_product: CardProduct }) => {
    setEditingCard(card)
    setCardFormOpen(true)
  }

  const handleAddCard = () => {
    setEditingCard(undefined)
    setCardFormOpen(true)
  }

  if (loading) {
    return (
      <Container sx={{ py: 3 }}>
        <Skeleton variant="circular" width={40} height={40} sx={{ mb: 2 }} />
        <Skeleton variant="text" height={40} width="60%" sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={200} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="text" height={32} width="40%" sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={120} sx={{ borderRadius: 3 }} />
      </Container>
    )
  }

  if (error || !holder) {
    return (
      <Container sx={{ py: 3 }}>
        <IconButton onClick={() => router.back()} sx={{ mb: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Alert severity="error">{error || '找不到该持卡人'}</Alert>
      </Container>
    )
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      {/* 顶部导航 */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => router.back()} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          账户详情
        </Typography>
        <IconButton onClick={() => setEditHolderOpen(true)} color="primary">
          <EditIcon />
        </IconButton>
      </Box>

      {/* 持卡人卡片 */}
      <Paper sx={{ p: 3, borderRadius: 4, mb: 4, bgcolor: 'background.paper' }}>
        <Stack spacing={3}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{
              width: 56, height: 56, borderRadius: '50%',
              bgcolor: holder.avatar_color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700
            }}>
              {holder.name.charAt(0)}
            </Box>
            <Box>
              <Typography variant="h5" fontWeight={700}>{holder.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {cards.length} 张信用卡
              </Typography>
            </Box>
          </Box>

          <Divider />

          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <PhoneIcon color="action" sx={{ fontSize: 20 }} />
              <Typography variant="body2">{holder.phone || '未填写手机号'}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CalendarIcon color="action" sx={{ fontSize: 20 }} />
              <Typography variant="body2">
                加入时间：{format(new Date(holder.created_at), 'yyyy/MM/dd')}
              </Typography>
            </Box>
          </Stack>
        </Stack>
      </Paper>

      {/* 统计卡片 */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 3 }}>
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
      )}

      {/* 历史账单统计入口 */}
      <Paper
        onClick={() => router.push(`/holders/${id}/stats`)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          p: 2, mb: 3, borderRadius: 3,
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
      </Paper>

      {/* 信用卡列表 */}
      <Box sx={{ px: 1, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          名下信用卡
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={handleAddCard}>
          添加卡片
        </Button>
      </Box>

      {cards.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 4, bgcolor: 'grey.50', border: '1px dashed', borderColor: 'divider' }}>
          <Typography color="text.secondary" variant="body2">
            暂无信用卡，点击上方按钮添加
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {cards.map(card => (
            <CreditCardItem 
              key={card.id} 
              card={card} 
              onClick={() => handleEditCard(card)} 
            />
          ))}
        </Stack>
      )}

      {/* 危险区域 */}
      <Box sx={{ mt: 6, textAlign: 'center' }}>
        <Button
          startIcon={<DeleteIcon />}
          color="error"
          size="small"
          onClick={handleDeleteHolder}
          sx={{ opacity: 0.6 }}
        >
          删除此账户及所有卡片
        </Button>
      </Box>

      {/* 弹窗 */}
      <HolderForm
        open={editHolderOpen}
        onClose={() => setEditHolderOpen(false)}
        onSubmit={handleUpdateHolder}
        initial={holder}
      />

      <CardForm
        open={cardFormOpen}
        onClose={() => setCardFormOpen(false)}
        onSubmit={handleCardSubmit}
        holderId={id}
        initial={editingCard}
      />
    </Container>
  )
}
