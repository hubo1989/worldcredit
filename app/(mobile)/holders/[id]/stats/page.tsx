// app/(mobile)/holders/[id]/stats/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Box, Typography, IconButton, Skeleton, Alert,
  Card, CardContent, LinearProgress, Tooltip,
} from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/Edit'
import { getHolder, getHolderStatsPageData } from '@/lib/api/holders'
import type { StatsPageData } from '@/lib/api/holders'
import { formatAmount } from '@/lib/utils'
import type { CardHolder } from '@/lib/types'

function formatMonth(monthStr: string) {
  const [, mm] = monthStr.split('-')
  return `${parseInt(mm)}月`
}

export default function HolderStatsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [statsData, setStatsData] = useState<StatsPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, stats] = await Promise.all([
        getHolder(id),
        getHolderStatsPageData(id),
      ])
      setHolder(h)
      setStatsData(stats)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={160} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={120} />
      </Box>
    )
  }

  if (!holder) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6">持卡人不存在</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>请返回重试</Typography>
      </Box>
    )
  }

  const { summary, quickStats, monthlyTrend } = statsData!
  const maxTrendAmount = Math.max(...monthlyTrend.map(t => t.totalAmount), 1)
  const trendTotal = monthlyTrend.reduce((s, t) => s + t.totalAmount, 0)

  return (
    <Box sx={{ p: 2, pb: 10 }}>
      {/* 顶部栏 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton onClick={() => router.back()} size="small">
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" fontWeight={800}>{holder.name}</Typography>
        </Box>
        <IconButton size="small" sx={{ border: '1px solid', borderColor: 'divider' }}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 总额度概览卡 */}
      <Card sx={{
        background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
        color: 'white',
        borderRadius: 3,
        mb: 3,
        boxShadow: '0 8px 16px rgba(25, 118, 210, 0.2)',
      }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ opacity: 0.8, mb: 0.5 }}>信用卡总额度</Typography>
          <Typography variant="h4" fontWeight={800}>{formatAmount(summary.totalLimit)}</Typography>
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>额度使用率 {summary.utilizationRate}%</Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                已用 {formatAmount(summary.totalUsed)} / 可用 {formatAmount(summary.availableLimit)}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={summary.utilizationRate}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: 'rgba(255,255,255,0.2)',
                '& .MuiLinearProgress-bar': { bgcolor: 'white' },
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* 四宫格快捷统计 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 3 }}>
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography color="text.secondary" variant="body2">卡数</Typography>
            <Typography variant="h5" fontWeight={700}>{quickStats.cardCount}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography color="text.secondary" variant="body2">本月账单</Typography>
            <Typography variant="h5" fontWeight={700}>{formatAmount(quickStats.monthlyBills)}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography color="text.secondary" variant="body2">待还款</Typography>
            <Typography variant="h5" fontWeight={700}>{formatAmount(quickStats.pendingPayment)}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography color="text.secondary" variant="body2">逾期数</Typography>
            <Typography
              variant="h5"
              fontWeight={700}
              color={quickStats.overdueCount > 0 ? 'error' : 'text.primary'}
            >
              {quickStats.overdueCount}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 6个月账单趋势 */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>账单趋势</Typography>
      <Card sx={{ borderRadius: 3 }}>
        <CardContent sx={{ p: 3 }}>
          {monthlyTrend.every(t => t.totalAmount === 0) ? (
            <Typography color="text.secondary" textAlign="center" sx={{ py: 3 }}>
              近6个月暂无账单数据
            </Typography>
          ) : (
            <>
              <Box sx={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                height: 120,
                gap: 1,
              }}>
                {monthlyTrend.map(t => {
                  const heightPct = t.totalAmount > 0
                    ? Math.max((t.totalAmount / maxTrendAmount) * 100, 6)
                    : 6
                  return (
                    <Tooltip
                      key={t.month}
                      title={`${formatMonth(t.month)}: ${formatAmount(t.totalAmount)}`}
                      arrow
                    >
                      <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        flex: 1,
                        gap: 0.5,
                        cursor: 'default',
                      }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          {t.totalAmount > 0 ? `${(t.totalAmount / 1000).toFixed(1)}k` : '-'}
                        </Typography>
                        <Box sx={{
                          width: '100%',
                          maxWidth: 32,
                          height: `${heightPct}%`,
                          minHeight: 4,
                          borderRadius: '4px 4px 0 0',
                          background: t.totalAmount > 0
                            ? 'linear-gradient(180deg, #1976d2, #42a5f5)'
                            : '#e0e0e0',
                          transition: 'height 0.3s ease',
                        }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          {formatMonth(t.month)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
              <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                mt: 2,
                pt: 2,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}>
                <Typography variant="body2" color="text.secondary">
                  总计 {formatAmount(trendTotal)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  月均 {formatAmount(trendTotal / 6)}
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
