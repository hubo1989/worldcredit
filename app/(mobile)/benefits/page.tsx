'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Container, Typography, Box, Stack, Paper,
  Button, Skeleton, Card, CardContent, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  IconButton, Tooltip, Alert
} from '@mui/material'
import BenefitIcon from '@mui/icons-material/Star'
import AddIcon from '@mui/icons-material/Add'
import TravelIcon from '@mui/icons-material/FlightTakeoff'
import HealthIcon from '@mui/icons-material/HealthAndSafety'
import LifestyleIcon from '@mui/icons-material/SportsGolf'
import AiIcon from '@mui/icons-material/AutoAwesome'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AlertIcon from '@mui/icons-material/AccessTime'
import {
  getAllMyBenefits,
  recordBenefitUsage,
  autoEnrichCardBenefits,
  createBenefit,
  updateBenefit,
  deleteBenefit
} from '@/lib/api/benefits'
import { BenefitEditDialog } from '@/components/mobile/BenefitEditDialog'
import type { Benefit, CardProduct } from '@/lib/types'

import { useAuth } from '@/lib/auth'

type BenefitWithStats = Benefit & { 
  card_product?: CardProduct, 
  usage_count: number 
}

export default function BenefitsPage() {
  const { user } = useAuth()
  const [benefits, setBenefits] = useState<BenefitWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [collectingAi, setCollectingAi] = useState(false)
  const [selectedBenefit, setSelectedBenefit] = useState<BenefitWithStats | null>(null)
  
  // Usage Record Dialog State
  const [useOpen, setUseOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Edit Dialog State
  const [editOpen, setEditOpen] = useState(false)
  const [editingBenefit, setEditingBenefit] = useState<BenefitWithStats | null>(null)

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      const data = await getAllMyBenefits(user.id)
      setBenefits(data as BenefitWithStats[])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const handleUseBenefit = async () => {
    if (!selectedBenefit) return
    setSubmitting(true)
    try {
      await recordBenefitUsage({
        benefit_id: selectedBenefit.id,
        used_at: new Date().toISOString().split('T')[0],
        note: note || undefined
      })
      setUseOpen(false)
      setNote('')
      loadData()
    } catch (err) {
      alert('登记失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleAutoCollectAi = async () => {
    if (benefits.length === 0) {
      alert('请先添加至少一张信用卡后再尝试 AI 自动搜集权益。')
      return
    }

    // 默认针对当前第一张卡产品的发卡行和卡名进行搜集
    const sampleCard = benefits[0]?.card_product
    if (!sampleCard) {
      alert('未检测到关联卡片产品')
      return
    }

    setCollectingAi(true)
    try {
      const added = await autoEnrichCardBenefits(sampleCard.id, sampleCard.bank_name, sampleCard.card_name)
      if (added.length > 0) {
        alert(`✨ AI 自动搜集成功！已成功检索并添加了 ${added.length} 项专属权益。`)
        loadData()
      } else {
        alert('未检索到更多新权益。')
      }
    } catch (err) {
      alert('AI 自动搜集失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCollectingAi(false)
    }
  }

  const handleDeleteBenefit = async (id: string) => {
    if (!confirm('确定要删除这项权益吗？')) return
    try {
      await deleteBenefit(id)
      loadData()
    } catch (err) {
      alert('删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const getCategoryIcon = (name: string) => {
    if (name.includes('机场') || name.includes('接送') || name.includes('贵宾')) return <TravelIcon />
    if (name.includes('体检') || name.includes('健康')) return <HealthIcon />
    return <LifestyleIcon />
  }

  // 计算到期/重置预警 (近 30 天内重置且尚有额度未享用)
  const expiringBenefits = benefits.filter(b => {
    const remaining = Number(b.quota) - b.usage_count
    return remaining > 0 && b.period === 'yearly' && b.reset_month
  })

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      {/* 页头与 AI 搜集/手动新增按钮 */}
      {/* 标题块与两个操作按钮同排：360 下按钮要占 243px，标题块只剩 85px，
          而「我的权益」单行需要 85.9px——差不到 1px 就被折成「我的权 / 益」。
          标题是语义单元，用 nowrap 固定住，标题块的 flex 收缩下限因此抬到
          标题自身宽度：390 下与按钮相加仍能同排（视觉不变），360 下按钮
          整颗换行到下一行，两个单元都不再互相抢宽度。 */}
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          columnGap: 1,
          rowGap: 1.5,
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="h5"
            sx={{
              fontSize: 'var(--type-title-size)',
              lineHeight: 'var(--type-title-line)',
              fontWeight: 'var(--type-title-weight)',
              letterSpacing: 'var(--type-title-tracking)',
              color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}
          >
            我的权益
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
            }}
          >
            智能追踪与享用您的信用卡专属权益
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, ml: 'auto' }}>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            startIcon={<AiIcon />}
            disabled={collectingAi}
            onClick={handleAutoCollectAi}
            sx={{ borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap' }}
          >
            {collectingAi ? 'AI 搜集中...' : 'AI 搜集权益'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditingBenefit(null)
              setEditOpen(true)
            }}
            sx={{ borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap' }}
          >
            手动添加
          </Button>
        </Stack>
      </Box>

      {/* 权益到期/重置预警 Banner */}
      {expiringBenefits.length > 0 && (
        <Alert severity="warning" icon={<AlertIcon fontSize="small" />} sx={{ mb: 3, borderRadius: 'var(--radius-depth-2)' }}>
          提示：您有 <strong>{expiringBenefits.length}</strong> 项专属权益（如 {expiringBenefits[0].name}）仍有剩余额度未享用，请注意及时使用。
        </Alert>
      )}

      {loading ? (
        <Stack spacing={2}>
          {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={120} sx={{ borderRadius: 'var(--radius-depth-3)' }} />)}
        </Stack>
      ) : benefits.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 4, textAlign: 'center', borderRadius: 'var(--radius-depth-3)',
            bgcolor: 'var(--paper)', border: '1px dashed', borderColor: 'var(--track)',
          }}
        >
          <BenefitIcon sx={{ fontSize: 48, color: 'var(--text-disabled)', mb: 2 }} />
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            暂无可用权益
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              display: 'block',
              mt: 0.5,
              mb: 2,
            }}
          >
            点击“AI 搜集权益”自动检索卡片权益或手动添加
          </Typography>
          <Button variant="contained" color="secondary" startIcon={<AiIcon />} onClick={handleAutoCollectAi}>
            一键 AI 自动搜集
          </Button>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {benefits.map(b => {
            const remaining = Math.max(0, Number(b.quota) - b.usage_count)
            const progress = (b.usage_count / Number(b.quota)) * 100

            return (
              <Card
                key={b.id}
                elevation={0}
                sx={{ borderRadius: 'var(--radius-depth-3)', border: 0, boxShadow: 'var(--shadow-e2)' }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: 'var(--radius-depth-1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: 'rgba(30,58,138,0.08)', color: 'var(--strong)'
                    }}>
                      {getCategoryIcon(b.name)}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: 'var(--type-body-size)',
                          lineHeight: 'var(--type-body-line)',
                          letterSpacing: 'var(--type-body-tracking)',
                          fontWeight: 600,
                          color: 'var(--muted)',
                        }}
                      >
                        {b.card_product?.bank_name} · {b.card_product?.card_name}
                      </Typography>
                      <Typography
                        variant="h6"
                        sx={{
                          fontSize: 'var(--type-section-size)',
                          lineHeight: 'var(--type-section-line)',
                          fontWeight: 'var(--type-section-weight)',
                          letterSpacing: 'var(--type-section-tracking)',
                          color: 'var(--text)',
                        }}
                      >
                        {b.name}
                      </Typography>
                      {b.description && (
                        <Typography
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            color: 'var(--muted)',
                            display: 'block',
                            mt: 0.25,
                          }}
                        >
                          {b.description}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="编辑">
                        <IconButton
                          aria-label="编辑权益"
                          size="small"
                          onClick={() => {
                            setEditingBenefit(b)
                            setEditOpen(true)
                          }}
                          sx={{ border: 0, color: 'var(--strong)', boxShadow: 'var(--shadow-e1)' }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          aria-label="删除权益"
                          size="small"
                          color="error"
                          onClick={() => handleDeleteBenefit(b.id)}
                          sx={{ border: 0, boxShadow: 'var(--shadow-e1)' }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>

                  <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <Box>
                      <Typography
                        sx={{
                          fontSize: 'var(--type-body-size)',
                          lineHeight: 'var(--type-body-line)',
                          letterSpacing: 'var(--type-body-tracking)',
                          fontWeight: 600,
                          color: remaining > 0 ? 'var(--strong)' : 'var(--text-disabled)',
                        }}
                      >
                        可用剩余：{remaining} / {b.quota} 次
                      </Typography>
                      {b.reset_month ? (
                        <Typography sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)', ml: 1 }}>
                          每年 {b.reset_month} 月重置
                        </Typography>
                      ) : b.expiry_date ? (
                        <Typography sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)', ml: 1 }}>
                          截止：{b.expiry_date}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>

                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(100, progress)} 
                    sx={{ height: 6, borderRadius: 'var(--radius-pill)', mb: 2 }}
                  />

                  <Button 
                    variant="contained" 
                    fullWidth 
                    size="small"
                    startIcon={<AddIcon />}
                    disabled={remaining <= 0}
                    onClick={() => {
                      setSelectedBenefit(b)
                      setUseOpen(true)
                    }}
                    sx={{ borderRadius: 'var(--radius-pill)' }}
                  >
                    登记享用权益
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </Stack>
      )}

      {/* 登记享用 Dialog */}
      <Dialog open={useOpen} onClose={() => setUseOpen(false)} fullWidth maxWidth="xs">
        {/* Dialog 走 portal，不在 .phone 作用域内：需显式声明角色令牌 */}
        <DialogTitle
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
          }}
        >
          登记权益享用
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
                fontFamily: 'var(--font-body)',
              }}
            >
              正在登记享用: <strong>{selectedBenefit?.name}</strong>
            </Typography>
            <TextField
              label="使用场景与备注 (选填)"
              placeholder="例如: 浦东机场 T2 专车接送"
              fullWidth
              multiline
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUseOpen(false)}>取消</Button>
          <Button 
            variant="contained" 
            onClick={handleUseBenefit} 
            disabled={submitting}
          >
            {submitting ? '登记中...' : '确认登记享用'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 手动新增/编辑 Dialog */}
      <BenefitEditDialog
        open={editOpen}
        cardProductId={editingBenefit?.card_product_id || (benefits[0]?.card_product_id || '')}
        benefit={editingBenefit}
        onClose={() => setEditOpen(false)}
        onSaved={loadData}
        onSave={async (data) => {
          if (editingBenefit) {
            await updateBenefit(editingBenefit.id, data)
          } else {
            await createBenefit(data)
          }
        }}
      />
    </Container>
  )
}
