// app/(mobile)/promos/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Box, Typography, Fab, Skeleton, Card, CardContent,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material'
import { Add as AddIcon, LocalOffer as PromoIcon } from '@mui/icons-material'
import { getActivePromos, getPromos, createPromo, deletePromo } from '@/lib/api/promos'
import { formatAmount } from '@/lib/utils'
import { differenceInDays, parseISO } from 'date-fns'
import type { Promo } from '@/lib/types'

export default function PromosPage() {
  const [tab, setTab] = useState(0) // 0=进行中, 1=全部
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = tab === 0 ? await getActivePromos() : await getPromos()
      setPromos(data)
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { loadData() }, [loadData])

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>优惠活动</Typography>

      {/* Tab 切换 */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {['进行中', '全部'].map((label, i) => (
          <Chip
            key={label}
            label={label}
            variant={tab === i ? 'filled' : 'outlined'}
            color={tab === i ? 'primary' : 'default'}
            onClick={() => setTab(i)}
          />
        ))}
      </Box>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={120} sx={{ mb: 1.5 }} />
        ))
      ) : promos.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <PromoIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
          <Typography color="text.secondary">
            {tab === 0 ? '目前没有进行中的优惠活动' : '还没有任何优惠活动记录'}
          </Typography>
        </Box>
      ) : (
        promos.map(promo => (
          <PromoCard key={promo.id} promo={promo} onDelete={() => setDeleteId(promo.id)} />
        ))
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => setFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      {/* 添加优惠表单 */}
      <PromoFormDialog open={formOpen} onClose={() => setFormOpen(false)} onCreated={loadData} />

      {/* 删除确认 */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除这个优惠活动吗？</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>取消</Button>
          <Button
            color="error" variant="contained"
            onClick={async () => {
              if (deleteId) {
                await deletePromo(deleteId)
                setDeleteId(null)
                loadData()
              }
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── 优惠卡片 ────────────────────────────────────────

function PromoCard({ promo, onDelete }: { promo: Promo; onDelete: () => void }) {
  const daysLeft = promo.end_date ? differenceInDays(parseISO(promo.end_date), new Date()) : null

  return (
    <Card sx={{ mb: 1.5 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{promo.title}</Typography>
            <Typography variant="caption" color="text.secondary">{promo.bank_name}</Typography>
          </Box>
          {promo.discount_type && (
            <Chip label={promo.discount_type} size="small" color="primary" variant="outlined" />
          )}
        </Box>

        {promo.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {promo.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {promo.start_date && promo.end_date
              ? `${promo.start_date} ~ ${promo.end_date}`
              : promo.end_date
                ? `截止 ${promo.end_date}`
                : '长期有效'}
          </Typography>
          {daysLeft !== null && daysLeft >= 0 && (
            <Chip
              label={daysLeft === 0 ? '今天截止' : `${daysLeft} 天后截止`}
              size="small"
              color={daysLeft <= 3 ? 'warning' : 'default'}
              variant="outlined"
            />
          )}
          {daysLeft !== null && daysLeft < 0 && (
            <Chip label="已过期" size="small" color="error" variant="outlined" />
          )}
        </Box>

        {promo.conditions && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            条件: {promo.conditions}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 优惠表单 ────────────────────────────────────────

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

  const resetForm = () => {
    setBankName('')
    setTitle('')
    setDescription('')
    setDiscountType('')
    setStartDate('')
    setEndDate('')
    setConditions('')
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
