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
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
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
        <Typography
          sx={{
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-line)',
            letterSpacing: 'var(--type-body-tracking)',
            color: 'var(--muted)',
            mt: 1,
          }}
        >
          请返回重试
        </Typography>
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
          <IconButton
            aria-label="返回"
            onClick={() => router.back()}
            sx={{
              width: 'var(--button-size)',
              height: 'var(--button-size)',
              background: 'var(--button-face)',
              color: 'var(--text-on-dark)',
              boxShadow: 'var(--button-shadow)',
              '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
              '&:active': { boxShadow: 'var(--button-shadow-press)' },
            }}
          >
            <ArrowBack />
          </IconButton>
          <Typography
            variant="h6"
            sx={{
              fontSize: 'var(--type-section-size)',
              lineHeight: 'var(--type-section-line)',
              fontWeight: 'var(--type-section-weight)',
              letterSpacing: 'var(--type-section-tracking)',
              color: 'var(--text)',
              ml: 0.5,
            }}
          >
            {holder.name}
          </Typography>
        </Box>
        {/* 行内小图标按钮：保持 ≤32px 尺寸，只把描边换成柔和投影 */}
        <IconButton
          aria-label="编辑持卡人"
          size="small"
          sx={{ border: 0, bgcolor: 'var(--paper)', boxShadow: 'var(--shadow-e1)', color: 'var(--strong)' }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 总额度概览卡 */}
      <Card sx={{
        background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
        color: 'white',
        border: 0,
        borderRadius: 'var(--radius-depth-3)',
        mb: 3,
        // 品牌色投影：hero 卡用品牌蓝光，不套中性分层阴影
        boxShadow: '0 8px 16px rgba(25, 118, 210, 0.2)',
      }}>
        <CardContent sx={{ p: 3 }}>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'rgba(255,255,255,0.78)',
              mb: 0.5,
            }}
          >
            信用卡总额度
          </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#FFFFFF' }}>
              {formatAmount(summary.totalLimit)}
            </Typography>
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography
                sx={{
                  fontSize: 'var(--type-body-size)',
                  lineHeight: 'var(--type-body-line)',
                  letterSpacing: 'var(--type-body-tracking)',
                  color: 'rgba(255,255,255,0.78)',
                }}
              >
                额度使用率 {summary.utilizationRate}%
              </Typography>
              <Typography
                sx={{
                  fontSize: 'var(--type-body-size)',
                  lineHeight: 'var(--type-body-line)',
                  letterSpacing: 'var(--type-body-tracking)',
                  color: 'rgba(255,255,255,0.78)',
                }}
              >
                已用 {formatAmount(summary.totalUsed)} / 可用 {formatAmount(summary.availableLimit)}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={summary.utilizationRate}
              sx={{
                height: 8,
                borderRadius: 'var(--radius-pill)',
                bgcolor: 'rgba(255,255,255,0.2)',
                '& .MuiLinearProgress-bar': { bgcolor: 'white' },
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* 四宫格快捷统计 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 3 }}>
        <Card sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
              }}
            >
              卡数
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{quickStats.cardCount}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
              }}
            >
              本月账单
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{formatAmount(quickStats.monthlyBills)}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
              }}
            >
              待还款
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{formatAmount(quickStats.pendingPayment)}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
              }}
            >
              逾期数
            </Typography>
            <Typography
              variant="h5"
              fontWeight={700}
              sx={{ color: quickStats.overdueCount > 0 ? 'var(--danger)' : 'var(--strong)' }}
            >
              {quickStats.overdueCount}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 6个月账单趋势 */}
      <Typography
        sx={{
          fontSize: 'var(--type-section-size)',
          lineHeight: 'var(--type-section-line)',
          fontWeight: 'var(--type-section-weight)',
          letterSpacing: 'var(--type-section-tracking)',
          color: 'var(--text)',
          mb: 1.5,
        }}
      >
        账单趋势
      </Typography>
      <Card sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
        <CardContent sx={{ p: 3 }}>
          {monthlyTrend.every(t => t.totalAmount === 0) ? (
            <Typography
              textAlign="center"
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'var(--muted)',
                py: 3,
              }}
            >
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
                        {/* 柱状图刻度标注：图形标注字号，不套正文字阶 */}
                        <Typography variant="caption" sx={{ fontSize: 10, color: 'var(--muted)' }}>
                          {t.totalAmount > 0 ? `${(t.totalAmount / 1000).toFixed(1)}k` : '-'}
                        </Typography>
                        <Box sx={{
                          width: '100%',
                          maxWidth: 32,
                          height: `${heightPct}%`,
                          minHeight: 4,
                          // 柱顶圆角是图表几何：用最小圆角令牌收口，不套卡片深度
                          borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
                          background: t.totalAmount > 0
                            ? 'linear-gradient(180deg, #1976d2, #42a5f5)'
                            : '#e0e0e0',
                        }} />
                        <Typography variant="caption" sx={{ fontSize: 10, color: 'var(--muted)' }}>
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
                borderColor: 'var(--track)',
              }}>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                  }}
                >
                  总计 {formatAmount(trendTotal)}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                  }}
                >
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
