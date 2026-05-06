// app/(mobile)/cards/[id]/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Card, CardContent,
  Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Chip, LinearProgress, Stack,
} from '@mui/material'
import { ArrowBack, Delete as DeleteIcon, Add as AddIcon, Edit as EditIcon, LocalOffer as PromoIcon } from '@mui/icons-material'
import { getCard, deleteCard } from '@/lib/api/cards'
import { getBills } from '@/lib/api/bills'
import { getBenefitsWithUsage, recordBenefitUsage, createBenefit, updateBenefit, deleteBenefit, getBenefitUsages } from '@/lib/api/benefits'
import { getCardOpportunities, type Opportunity } from '@/lib/api/opportunities'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO, isPast } from 'date-fns'
import type { CreditCard, Bill, Benefit } from '@/lib/types'
import { usePermission } from '@/lib/hooks/usePermission'
import { BenefitForm } from '@/components/mobile/BenefitForm'
import { BenefitUsageDialog } from '@/components/mobile/BenefitUsageDialog'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }
type BenefitWithUsage = Benefit & { used_count: number }

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [card, setCard] = useState<CreditCard | null>(null)
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [benefits, setBenefits] = useState<BenefitWithUsage[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [benefitFormOpen, setBenefitFormOpen] = useState(false)
  const [editingBenefit, setEditingBenefit] = useState<Benefit | undefined>(undefined)
  const [benefitDeleteOpen, setBenefitDeleteOpen] = useState(false)
  const [benefitToDelete, setBenefitToDelete] = useState<Benefit | undefined>(undefined)
  const [usageDialogOpen, setUsageDialogOpen] = useState(false)
  const [selectedBenefit, setSelectedBenefit] = useState<BenefitWithUsage | undefined>(undefined)
  const router = useRouter()
  const { canManage } = usePermission()

  const loadData = useCallback(async () => {
    try {
      const c = await getCard(id)
      setCard(c)
      const [billsData, benefitsData, opportunitiesData] = await Promise.all([
        getBills(id) as Promise<BillWithCard[]>,
        getBenefitsWithUsage(id),
        getCardOpportunities(id),
      ])
      setBills(billsData)
      setBenefits(benefitsData)
      setOpportunities(opportunitiesData)
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

  const handleAddBenefit = () => {
    setEditingBenefit(undefined)
    setBenefitFormOpen(true)
  }

  const handleEditBenefit = (benefit: Benefit) => {
    setEditingBenefit(benefit)
    setBenefitFormOpen(true)
  }

  const handleBenefitSubmit = async (data: Omit<Benefit, 'id' | 'created_at'>) => {
    if (editingBenefit) {
      await updateBenefit(editingBenefit.id, data)
    } else {
      await createBenefit({ ...data, card_id: id })
    }
    loadData()
  }

  const handleDeleteBenefitClick = (benefit: Benefit) => {
    setBenefitToDelete(benefit)
    setBenefitDeleteOpen(true)
  }

  const handleConfirmDeleteBenefit = async () => {
    if (!benefitToDelete) return
    await deleteBenefit(benefitToDelete.id)
    setBenefitDeleteOpen(false)
    setBenefitToDelete(undefined)
    loadData()
  }

  const handleUsageClick = (benefit: BenefitWithUsage) => {
    setSelectedBenefit(benefit)
    setUsageDialogOpen(true)
  }

  const handleUsageSubmit = async (data: { used_at: string; note?: string }) => {
    if (!selectedBenefit) return
    await recordBenefitUsage(selectedBenefit.id, data)
    setUsageDialogOpen(false)
    loadData()
  }

  const isBenefitExpired = (benefit: BenefitWithUsage) => {
    if (!benefit.expiry_date) return false
    return isPast(parseISO(benefit.expiry_date))
  }

  const isBenefitQuotaReached = (benefit: BenefitWithUsage) => {
    return benefit.used_count >= benefit.quota
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
        {canManage && <IconButton onClick={() => setDeleteDialogOpen(true)} color="error"><DeleteIcon /></IconButton>}
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>权益</Typography>
          {canManage && (
            <Button size="small" startIcon={<AddIcon />} onClick={handleAddBenefit}>
              添加权益
            </Button>
          )}
        </Box>

        {benefits.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" sx={{ py: 2 }}>
            暂无权益记录
          </Typography>
        ) : (
          benefits.map(b => {
            const expired = isBenefitExpired(b)
            const quotaReached = isBenefitQuotaReached(b)
            const canUse = !expired && !quotaReached

            return (
              <Card key={b.id} sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={600}>{b.name}</Typography>
                        {expired && <Chip label="已过期" size="small" color="error" variant="outlined" />}
                        {quotaReached && !expired && <Chip label="已用尽" size="small" color="warning" variant="outlined" />}
                      </Box>
                      {b.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {b.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          使用: {b.used_count}/{b.quota} 次
                        </Typography>
                        {b.period !== 'one_time' && (
                          <Typography variant="caption" color="text.secondary">
                            · {b.period === 'yearly' ? '按年' : '按月'}
                            {b.period === 'yearly' && b.reset_month && `(${b.reset_month}月重置)`}
                          </Typography>
                        )}
                        {b.expiry_date && (
                          <Typography variant="caption" color="text.secondary">
                            · 有效期至 {b.expiry_date}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                      {canManage && (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton size="small" onClick={() => handleEditBenefit(b)} aria-label="编辑权益">
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDeleteBenefitClick(b)} color="error" aria-label="删除权益">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      )}
                      <Button
                        size="small"
                        variant={canUse ? "outlined" : "text"}
                        disabled={!canUse}
                        onClick={() => handleUsageClick(b)}
                      >
                        使用
                      </Button>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            )
          })
        )}
      </Box>

      {/* 机会列表 */}
      {opportunities.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>相关机会</Typography>
            <Button size="small" onClick={() => router.push('/promos')}>查看全部</Button>
          </Box>

          {opportunities.slice(0, 3).map(opp => {
            const statusColorMap: Record<Opportunity['status'], 'success' | 'warning' | 'error' | 'default'> = {
              available: 'success',
              expiring: 'warning',
              expired: 'error',
              used_up: 'error',
              not_started: 'default',
            }

            const statusLabelMap: Record<Opportunity['status'], string> = {
              available: '可用',
              expiring: '即将到期',
              expired: '已过期',
              used_up: '已用尽',
              not_started: '未开始',
            }

            return (
              <Card key={opp.id} sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={600}>{opp.title}</Typography>
                        <Chip label={opp.type === 'promo' ? '优惠' : '权益'} size="small" variant="outlined" />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {opp.bank_name}
                        {opp.card_name && ` · ${opp.card_name}`}
                      </Typography>
                    </Box>
                    <Chip
                      label={statusLabelMap[opp.status]}
                      size="small"
                      color={statusColorMap[opp.status]}
                      variant="outlined"
                    />
                  </Box>

                  {opp.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {opp.description}
                    </Typography>
                  )}

                  {opp.reason_tags.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
                      {opp.reason_tags.map(tag => (
                        <Chip key={tag} label={tag} size="small" color="warning" variant="filled" />
                      ))}
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      {opp.starts_at && opp.ends_at
                        ? `${opp.starts_at} ~ ${opp.ends_at}`
                        : opp.ends_at
                          ? `截止 ${opp.ends_at}`
                          : opp.starts_at
                            ? `从 ${opp.starts_at} 开始`
                            : '长期有效'}
                    </Typography>

                    {opp.quota !== undefined && opp.used_count !== undefined && (
                      <Typography variant="caption" color="text.secondary">
                        已用 {opp.used_count} / {opp.quota}
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </Card>
            )
          })}
        </Box>
      )}

      {/* 删除确认对话框 */}
      {canManage && <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除信用卡「{card.card_name}」吗？关联的账单和权益也将被删除，此操作不可逆。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>删除</Button>
        </DialogActions>
      </Dialog>}

      {/* 权益表单对话框 */}
      {canManage && (
        <BenefitForm
          open={benefitFormOpen}
          onClose={() => setBenefitFormOpen(false)}
          onSubmit={handleBenefitSubmit}
          initial={editingBenefit}
        />
      )}

      {/* 删除权益确认对话框 */}
      {canManage && benefitToDelete && <Dialog open={benefitDeleteOpen} onClose={() => setBenefitDeleteOpen(false)}>
        <DialogTitle>确认删除权益</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>
            确定要删除权益「{benefitToDelete.name}」吗？
          </Typography>
          <Typography variant="caption" color="error">
            该权益的所有使用记录也将被删除，此操作不可逆。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBenefitDeleteOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDeleteBenefit}>删除</Button>
        </DialogActions>
      </Dialog>}

      {/* 权益使用对话框 */}
      <BenefitUsageDialog
        open={usageDialogOpen}
        onClose={() => setUsageDialogOpen(false)}
        onSubmit={handleUsageSubmit}
      />
    </Box>
  )
}
