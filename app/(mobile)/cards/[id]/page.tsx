// app/(mobile)/cards/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Card, CardContent,
  Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Chip, LinearProgress,
} from '@mui/material'
import { ArrowBack, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material'
import { getCard, deleteCard } from '@/lib/api/cards'
import { getBills } from '@/lib/api/bills'
import { getBenefitsWithUsage, recordBenefitUsage } from '@/lib/api/benefits'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO } from 'date-fns'
import type { CreditCard, Bill, Benefit } from '@/lib/types'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }
type BenefitWithUsage = Benefit & { used_count: number }

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [card, setCard] = useState<CreditCard | null>(null)
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [benefits, setBenefits] = useState<BenefitWithUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      const c = await getCard(id)
      setCard(c)
      const [billsData, benefitsData] = await Promise.all([
        getBills(id) as Promise<BillWithCard[]>,
        getBenefitsWithUsage(id),
      ])
      setBills(billsData)
      setBenefits(benefitsData)
    } catch {
      setCard(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <Skeleton variant="rounded" height={300} sx={{ m: 2 }} />
  if (!card) return <Typography sx={{ p: 2 }}>卡片不存在</Typography>

  const handleDelete = async () => {
    await deleteCard(id)
    router.back()
  }

  // 计算已用额度（未还清账单金额之和）
  const usedAmount = bills
    .filter(b => b.status !== 'paid')
    .reduce((sum, b) => sum + Number(b.bill_amount), 0)
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0

  // 最近账单
  const recentBills = bills.slice(0, 5)

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{card.bank_name}</Typography>
        <IconButton onClick={() => setDeleteDialogOpen(true)} color="error"><DeleteIcon /></IconButton>
      </Box>

      {/* 卡片基本信息 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h5" color="primary" sx={{ mb: 1 }}>
            {card.card_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            卡号后四位: {card.card_number_last4 || '--'} · {card.currency}
          </Typography>

          <Divider sx={{ my: 2 }} />

          {/* 额度使用 */}
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>额度使用</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              已用 {formatAmount(usedAmount, card.currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              总额 {formatAmount(card.credit_limit, card.currency)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(usagePercent, 100)}
            color={usagePercent > 80 ? 'error' : usagePercent > 50 ? 'warning' : 'primary'}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            可用 {formatAmount(available, card.currency)}
          </Typography>

          <Divider sx={{ my: 2 }} />

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">免年费条件</Typography>
            <Typography>{card.annual_fee_waiver || '无'}</Typography>
          </Box>
        </CardContent>
      </Card>

      {/* 近期账单 */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>近期账单</Typography>
          <Button size="small" onClick={() => router.push('/bills')}>查看全部</Button>
        </Box>

        {recentBills.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" sx={{ py: 2 }}>
            暂无账单记录
          </Typography>
        ) : (
          recentBills.map(b => {
            const daysLeft = differenceInDays(parseISO(b.due_date), new Date())
            return (
              <Card key={b.id} sx={{ mb: 1, cursor: 'pointer' }}
                onClick={() => router.push(`/bills/${b.id}`)}
              >
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="body2" fontWeight={600}>{b.bill_month}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        截止 {b.due_date}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" fontWeight={700}>
                        {formatAmount(Number(b.bill_amount), card.currency)}
                      </Typography>
                      <Chip
                        label={
                          b.status === 'paid' ? '已还清' :
                          daysLeft < 0 ? `逾期` :
                          `${daysLeft}天后截止`
                        }
                        size="small"
                        color={
                          b.status === 'paid' ? 'success' :
                          daysLeft < 0 ? 'error' :
                          daysLeft <= 3 ? 'warning' : 'default'
                        }
                        variant="outlined"
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            )
          })
        )}
      </Box>

      {/* 权益列表 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>权益</Typography>

        {benefits.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" sx={{ py: 2 }}>
            暂无权益记录
          </Typography>
        ) : (
          benefits.map(b => (
            <Card key={b.id} sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={600}>{b.name}</Typography>
                    {b.description && (
                      <Typography variant="caption" color="text.secondary">{b.description}</Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {b.used_count}/{b.quota} 次
                    </Typography>
                    {b.used_count < b.quota && (
                      <Button
                        size="small" variant="outlined"
                        onClick={async () => {
                          await recordBenefitUsage(b.id)
                          loadData()
                        }}
                      >
                        使用
                      </Button>
                    )}
                  </Box>
                </Box>
                {b.expiry_date && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    有效期至 {b.expiry_date}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </Box>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除信用卡「{card.card_name}」吗？关联的账单和权益也将被删除，此操作不可逆。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
