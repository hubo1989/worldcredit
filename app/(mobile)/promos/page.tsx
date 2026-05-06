// app/(mobile)/promos/page.tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box, Typography, Fab, Skeleton, Card, CardContent,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Stack, Tabs, Tab,
} from '@mui/material'
import { Add as AddIcon, LocalOffer as PromoIcon, FilterList as FilterIcon, Lightbulb as RecommenderIcon } from '@mui/icons-material'
import { getOpportunities, getOpportunitiesForHolder, type Opportunity, type OpportunityFilters } from '@/lib/api/opportunities'
import { createPromo, deletePromo, recordPromoUsage } from '@/lib/api/promos'
import { getHolders } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import { usePermission } from '@/lib/hooks/usePermission'
import { asRole, getErrorMessage } from '@/lib/permissions'
import type { Promo, CreditCard } from '@/lib/types'
import { CardRecommender } from '@/components/mobile/CardRecommender'

export default function PromosPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { canManage, profile } = usePermission()

  const [filters, setFilters] = useState<OpportunityFilters>({
    type: (searchParams.get('type') as OpportunityFilters['type']) || 'all',
    bank_name: searchParams.get('bank_name') || undefined,
    card_id: searchParams.get('card_id') || undefined,
    status: (searchParams.get('status') as OpportunityFilters['status']) || undefined,
    discount_type: (searchParams.get('discount_type') as OpportunityFilters['discount_type']) || undefined,
  })

  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [allBanks, setAllBanks] = useState<string[]>([])
  const [allCards, setAllCards] = useState<CreditCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [currentTab, setCurrentTab] = useState<'opportunities' | 'recommender'>('opportunities')

  const loadData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    try {
      let data: Opportunity[]
      if (canManage) {
        data = await getOpportunities(profile.id, filters)
      } else {
        const holders = await getHolders(profile.id, asRole(profile))
        if (holders.length > 0) {
          data = await getOpportunitiesForHolder(holders[0].id, filters)
        } else {
          data = []
        }
      }
      setOpportunities(data)
      const banks = [...new Set(data.map(o => o.bank_name))].sort()
      setAllBanks(banks)

      const holders = await getHolders(profile.id, asRole(profile))
      const cardsByHolder = await Promise.all(holders.map(h => getCardsByHolder(h.id)))
      setAllCards(cardsByHolder.flat())
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [canManage, profile, filters])

  useEffect(() => { loadData() }, [loadData])

  const updateFilters = (newFilters: Partial<OpportunityFilters>) => {
    const updated = { ...filters, ...newFilters }
    setFilters(updated)
    const params = new URLSearchParams()
    if (updated.type && updated.type !== 'all') params.set('type', updated.type)
    if (updated.bank_name) params.set('bank_name', updated.bank_name)
    if (updated.card_id) params.set('card_id', updated.card_id)
    if (updated.status) params.set('status', updated.status)
    if (updated.discount_type) params.set('discount_type', updated.discount_type)
    const queryString = params.toString()
    router.push(queryString ? `/promos?${queryString}` : '/promos', { scroll: false })
  }

  const clearFilters = () => {
    setFilters({
      type: 'all',
      bank_name: undefined,
      card_id: undefined,
      status: undefined,
      discount_type: undefined,
    })
    router.push('/promos', { scroll: false })
  }

  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(([k, v]) => k !== 'type' && v !== undefined).length
  }, [filters])

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>机会中心</Typography>
        {currentTab === 'opportunities' && (
          <Button
            startIcon={<FilterIcon />}
            size="small"
            onClick={() => setFilterOpen(!filterOpen)}
            color={activeFilterCount > 0 ? 'primary' : 'secondary'}
          >
            筛选 {activeFilterCount > 0 && `(${activeFilterCount})`}
          </Button>
        )}
      </Box>

      <Tabs
        value={currentTab}
        onChange={(_, newValue) => setCurrentTab(newValue)}
        sx={{ mb: 2 }}
        variant="fullWidth"
      >
        <Tab label="机会列表" value="opportunities" />
        <Tab label="用卡建议" value="recommender" />
      </Tabs>

      {currentTab === 'recommender' ? (
        <CardRecommender />
      ) : (
        <>
      {filterOpen && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>类型</InputLabel>
                <Select
                  value={filters.type}
                  onChange={e => updateFilters({ type: e.target.value as OpportunityFilters['type'] })}
                  label="类型"
                >
                  <MenuItem value="all">全部</MenuItem>
                  <MenuItem value="promo">优惠</MenuItem>
                  <MenuItem value="benefit">权益</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>银行</InputLabel>
                <Select
                  value={filters.bank_name || ''}
                  onChange={e => updateFilters({ bank_name: e.target.value || undefined })}
                  label="银行"
                >
                  <MenuItem value="">全部银行</MenuItem>
                  {allBanks.map(bank => (
                    <MenuItem key={bank} value={bank}>{bank}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {allCards.length > 0 && (
                <FormControl fullWidth size="small">
                  <InputLabel>卡片</InputLabel>
                  <Select
                    value={filters.card_id || ''}
                    onChange={e => updateFilters({ card_id: e.target.value || undefined })}
                    label="卡片"
                  >
                    <MenuItem value="">全部卡片</MenuItem>
                    {allCards.map(card => (
                      <MenuItem key={card.id} value={card.id}>
                        {card.bank_name} - {card.card_name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControl fullWidth size="small">
                <InputLabel>状态</InputLabel>
                <Select
                  value={filters.status || ''}
                  onChange={e => updateFilters({ status: e.target.value as OpportunityFilters['status'] || undefined })}
                  label="状态"
                >
                  <MenuItem value="">全部状态</MenuItem>
                  <MenuItem value="available">可用</MenuItem>
                  <MenuItem value="expiring">即将到期</MenuItem>
                  <MenuItem value="expired">已过期</MenuItem>
                  <MenuItem value="used_up">已用尽</MenuItem>
                  <MenuItem value="not_started">未开始</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>优惠类型</InputLabel>
                <Select
                  value={filters.discount_type || ''}
                  onChange={e => updateFilters({ discount_type: e.target.value as OpportunityFilters['discount_type'] || undefined })}
                  label="优惠类型"
                >
                  <MenuItem value="">全部类型</MenuItem>
                  <MenuItem value="满减">满减</MenuItem>
                  <MenuItem value="折扣">折扣</MenuItem>
                  <MenuItem value="积分">积分</MenuItem>
                  <MenuItem value="返现">返现</MenuItem>
                </Select>
              </FormControl>

              <Button onClick={clearFilters} size="small" color="secondary">
                清除筛选
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {error && (
        <Typography color="error" variant="body2" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={140} sx={{ mb: 1.5 }} />
        ))
      ) : opportunities.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <PromoIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
          <Typography color="text.secondary">
            {activeFilterCount > 0 ? '没有符合条件的机会' : '暂无机会'}
          </Typography>
        </Box>
      ) : (
        opportunities.map(opp => (
          <OpportunityCard key={opp.id} opportunity={opp} onRefresh={loadData} />
        ))
      )}

      {canManage && (
        <Fab
          color="primary"
          sx={{ position: 'fixed', bottom: 72, right: 16 }}
          onClick={() => setFormOpen(true)}
        >
          <AddIcon />
        </Fab>
      )}

      <PromoFormDialog open={formOpen} onClose={() => setFormOpen(false)} onCreated={loadData} />
        </>
      )}
    </Box>
  )
}

function OpportunityCard({ opportunity, onRefresh }: { opportunity: Opportunity; onRefresh: () => void }) {
  const { canManage } = usePermission()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [recordDialogOpen, setRecordDialogOpen] = useState(false)

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

  const isPromo = opportunity.type === 'promo'
  const canRecord = opportunity.status === 'available' || opportunity.status === 'expiring'

  return (
    <Card sx={{ mb: 1.5 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <Typography variant="subtitle1" fontWeight={600}>{opportunity.title}</Typography>
              <Chip label={isPromo ? '优惠' : '权益'} size="small" variant="outlined" />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {opportunity.bank_name}
              {opportunity.card_name && ` · ${opportunity.card_name}`}
            </Typography>
          </Box>
          <Chip
            label={statusLabelMap[opportunity.status]}
            size="small"
            color={statusColorMap[opportunity.status]}
            variant="outlined"
          />
        </Box>

        {opportunity.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {opportunity.description}
          </Typography>
        )}

        {opportunity.reason_tags.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
            {opportunity.reason_tags.map(tag => (
              <Chip key={tag} label={tag} size="small" color="warning" variant="filled" />
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {opportunity.starts_at && opportunity.ends_at
              ? `${opportunity.starts_at} ~ ${opportunity.ends_at}`
              : opportunity.ends_at
                ? `截止 ${opportunity.ends_at}`
                : opportunity.starts_at
                  ? `从 ${opportunity.starts_at} 开始`
                  : '长期有效'}
          </Typography>

          {opportunity.quota !== undefined && opportunity.used_count !== undefined && (
            <Typography variant="caption" color="text.secondary">
              已用 {opportunity.used_count} / {opportunity.quota}
            </Typography>
          )}
        </Box>

        {opportunity.conditions && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            条件: {opportunity.conditions}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {isPromo && canRecord && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<PromoIcon />}
              onClick={() => setRecordDialogOpen(true)}
            >
              记录使用
            </Button>
          )}

          {canManage && opportunity.type === 'promo' && (
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={() => setDeleteDialogOpen(true)}
            >
              删除
            </Button>
          )}
        </Box>
      </CardContent>

      {isPromo && (
        <RecordUsageDialog
          open={recordDialogOpen}
          onClose={() => setRecordDialogOpen(false)}
          opportunity={opportunity}
          onSuccess={() => {
            setRecordDialogOpen(false)
            onRefresh()
          }}
        />
      )}

      {canManage && opportunity.type === 'promo' && (
        <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
          <DialogTitle>确认删除</DialogTitle>
          <DialogContent>
            <Typography>确定要删除「{opportunity.title}」吗？</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button
              color="error"
              variant="contained"
              onClick={async () => {
                const promoId = opportunity.id.replace('promo-', '')
                await deletePromo(promoId)
                setDeleteDialogOpen(false)
                onRefresh()
              }}
            >
              删除
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  )
}

function RecordUsageDialog({
  open,
  onClose,
  opportunity,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  opportunity: Opportunity
  onSuccess: () => void
}) {
  const { profile, canManage } = usePermission()
  const [cards, setCards] = useState<CreditCard[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(opportunity.card_id)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !profile) return

    const loadCards = async () => {
      try {
        const holders = await getHolders(profile.id, profile.role)
        const cardsByHolder = await Promise.all(
          holders.map(holder => getCardsByHolder(holder.id))
        )
        const userCards = cardsByHolder.flat()

        if (opportunity.card_id) {
          setCards(userCards.filter(c => c.id === opportunity.card_id))
        } else {
          setCards(userCards.filter(c => c.bank_name === opportunity.bank_name))
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err))
      }
    }

    loadCards()
  }, [open, profile, opportunity.card_id, opportunity.bank_name])

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const promoId = opportunity.id.replace('promo-', '')
      await recordPromoUsage(promoId, {
        card_id: selectedCardId,
        used_at: new Date().toISOString().split('T')[0],
        note: note.trim() || undefined,
      })
      onSuccess()
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const isCardRequired = cards.length > 0

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>记录使用</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {opportunity.title}
        </Typography>

        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        {cards.length > 0 && (
          <FormControl fullWidth margin="normal" required={isCardRequired}>
            <InputLabel>选择信用卡</InputLabel>
            <Select
              value={selectedCardId || ''}
              onChange={e => setSelectedCardId(e.target.value || undefined)}
              label="选择信用卡"
            >
              {cards.map(card => (
                <MenuItem key={card.id} value={card.id}>
                  {card.bank_name} - {card.card_name}
                  {card.card_number_last4 && ` (*${card.card_number_last4})`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <TextField
          fullWidth
          label="备注"
          multiline
          rows={3}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="订单号、商户、节省金额等"
          margin="normal"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>取消</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || (isCardRequired && !selectedCardId)}
        >
          {loading ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function PromoFormDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [bankName, setBankName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [discountType, setDiscountType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [conditions, setConditions] = useState('')
  const [maxUses, setMaxUses] = useState('')

  const resetForm = () => {
    setBankName('')
    setTitle('')
    setDescription('')
    setDiscountType('')
    setStartDate('')
    setEndDate('')
    setConditions('')
    setMaxUses('')
  }

  const handleSubmit = async () => {
    if (!bankName.trim() || !title.trim()) return
    await createPromo({
      bank_name: bankName.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
      discount_type: (discountType || undefined) as Promo['discount_type'],
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      conditions: conditions.trim() || undefined,
      max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
    })
    resetForm()
    onClose()
    onCreated()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>添加优惠活动</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="银行名称" margin="normal" value={bankName}
          onChange={e => setBankName(e.target.value)} required autoFocus
        />
        <TextField
          fullWidth label="活动标题" margin="normal" value={title}
          onChange={e => setTitle(e.target.value)} required
        />
        <TextField
          fullWidth label="活动描述" margin="normal" value={description}
          onChange={e => setDescription(e.target.value)} multiline rows={2}
        />
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>优惠类型</InputLabel>
          <Select value={discountType} onChange={e => setDiscountType(e.target.value)} label="优惠类型">
            <MenuItem value="">无</MenuItem>
            <MenuItem value="满减">满减</MenuItem>
            <MenuItem value="折扣">折扣</MenuItem>
            <MenuItem value="积分">积分</MenuItem>
            <MenuItem value="返现">返现</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label="开始日期" type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }} fullWidth
          />
          <TextField
            label="结束日期" type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)}
            InputLabelProps={{ shrink: true }} fullWidth
          />
        </Box>
        <TextField
          fullWidth label="使用条件" margin="normal" value={conditions}
          onChange={e => setConditions(e.target.value)}
          placeholder="如：满200减50"
        />
        <TextField
          fullWidth label="最大使用次数" margin="normal" value={maxUses}
          onChange={e => setMaxUses(e.target.value)}
          type="number"
          placeholder="留空表示无限制"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { resetForm(); onClose() }}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!bankName.trim() || !title.trim()}>
          添加
        </Button>
      </DialogActions>
    </Dialog>
  )
}
