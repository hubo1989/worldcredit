// app/(mobile)/analytics/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Card, CardContent, Stack, Select, MenuItem,
  FormControl, InputLabel, Button, Alert, Skeleton, IconButton,
} from '@mui/material'
import { Warning, FileDownload } from '@mui/icons-material'
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { getAnalyticsSummary, getMonthlyDebtTrend, getCategoryBreakdown } from '@/lib/api/analytics'
import { getHolders } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import type { CreditCardWithProduct } from '@/lib/api/cards'
import { useAuth } from '@/lib/auth'
import { ExportDialog } from '@/components/mobile/ExportDialog'
import type { AnalyticsSummary, MonthlyDebtPoint, CategoryBreakdown } from '@/lib/api/analytics'
import type { CardHolder } from '@/lib/types'

interface Filters {
  months: number
  holderId?: string
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

export default function AnalyticsPage() {
  const { user } = useAuth()
  const [filters, setFilters] = useState<Filters>({ months: 6 })
  const [holderOptions, setHolderOptions] = useState<Array<{ id: string; name: string }>>([])
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [trend, setTrend] = useState<MonthlyDebtPoint[]>([])
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardOptions, setCardOptions] = useState<Array<{ id: string; label: string; card: CreditCardWithProduct }>>([])

  const loadHolders = useCallback(async () => {
    if (!user) return
    try {
      const holdersData = await getHolders(user.id)
      setHolders(holdersData)
      setHolderOptions(holdersData.map(h => ({ id: h.id, name: h.name })))

      // Load card options for export
      const allCards: Array<{ id: string; label: string; card: CreditCardWithProduct }> = []
      await Promise.all(
        holdersData.map(async (h) => {
          const cards = await getCardsByHolder(h.id)
          cards.forEach(c => {
            allCards.push({
              id: c.id,
              label: `${h.name} - ${c.card_product?.bank_name ?? ''} ${c.card_product?.card_name ?? ''}`,
              card: c,
            })
          })
        })
      )
      setCardOptions(allCards)
    } catch (err) {
      console.error('Failed to load holders:', err)
    }
  }, [user])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryData, trendData, categoryData] = await Promise.all([
        getAnalyticsSummary({ holder_id: filters.holderId }),
        getMonthlyDebtTrend({ holder_id: filters.holderId }, filters.months),
        getCategoryBreakdown({ holder_id: filters.holderId }),
      ])

      setSummary(summaryData)
      setTrend(trendData)
      setCategoryBreakdown(categoryData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    loadHolders()
  }, [loadHolders])

  useEffect(() => {
    loadData()
  }, [loadData])

  const formatCurrency = (amount: number) => {
    return `¥${amount.toFixed(2)}`
  }

  const formatChartCurrency = (value: unknown) => {
    return formatCurrency(typeof value === 'number' ? value : Number(value) || 0)
  }

  const getRiskAlerts = () => {
    const alerts = []

    const utilization = summary?.utilization_rate
    if (utilization != null && utilization > 70) {
      alerts.push(`额度使用率过高 (${utilization.toFixed(1)}%)`)
    }

    const overdueCount = summary?.overdue_count
    if (overdueCount != null && overdueCount > 0) {
      alerts.push(`有 ${overdueCount} 笔逾期账单`)
    }

    if (trend.length > 1) {
      const lastMonth = trend[trend.length - 1]
      const prevMonth = trend[trend.length - 2]
      if (lastMonth && prevMonth && lastMonth.bill_amount > prevMonth.bill_amount * 1.2) {
        alerts.push('上月消费激增')
      }
    }

    return alerts
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography
          variant="h6"
          sx={{
            fontSize: 'var(--type-title-size)',
            lineHeight: 'var(--type-title-line)',
            fontWeight: 'var(--type-title-weight)',
            letterSpacing: 'var(--type-title-tracking)',
            color: 'var(--text)',
          }}
        >
          消费与负债分析
        </Typography>
        <IconButton
          onClick={() => setExportOpen(true)}
          aria-label="导出数据"
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
          <FileDownload />
        </IconButton>
      </Box>

      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>时间范围</InputLabel>
          <Select
            value={filters.months}
            onChange={e => setFilters({ ...filters, months: Number(e.target.value) })}
            label="时间范围"
          >
            <MenuItem value={6}>近 6 个月</MenuItem>
            <MenuItem value={12}>近 12 个月</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>成员</InputLabel>
          <Select
            value={filters.holderId || 'all'}
            onChange={e => setFilters({ ...filters, holderId: e.target.value === 'all' ? undefined : e.target.value })}
            label="成员"
          >
            <MenuItem value="all">全部</MenuItem>
            {holderOptions.map(h => (
              <MenuItem key={h.id} value={h.id}>{h.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Button size="small" onClick={loadData}>重试</Button>
        }>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={100} />
          <Skeleton variant="rounded" height={300} />
          <Skeleton variant="rounded" height={300} />
        </Stack>
      ) : summary && (
        <Stack spacing={2}>
          {/* Risk Alerts */}
          {getRiskAlerts().length > 0 && (
          <Alert severity="warning" icon={<Warning />}>
              <Typography
                sx={{
                  fontSize: 'var(--type-section-size)',
                  lineHeight: 'var(--type-section-line)',
                  fontWeight: 'var(--type-section-weight)',
                  letterSpacing: 'var(--type-section-tracking)',
                  color: 'var(--text)',
                }}
              >
                风险提示
              </Typography>
              {getRiskAlerts().map((alert, i) => (
                <Typography
                  key={i}
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--text)',
                  }}
                >
                  • {alert}
                </Typography>
              ))}
            </Alert>
          )}

          {/* Summary Cards */}
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
            {/* 横向滚动条里的卡片：flexShrink:0 让每个语义单元保持完整宽度，
                不让 flex 把「额度使用率」这类标签压到折行。 */}
            <Card elevation={0} sx={{ minWidth: 140, flex: 1, flexShrink: 0, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
              <CardContent>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  账单总额
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {formatCurrency(summary.total_bill_amount)}
                </Typography>
              </CardContent>
            </Card>

            <Card elevation={0} sx={{ minWidth: 140, flex: 1, flexShrink: 0, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
              <CardContent>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  待还金额
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                  {formatCurrency(summary.pending_amount)}
                </Typography>
              </CardContent>
            </Card>

            <Card elevation={0} sx={{ minWidth: 140, flex: 1, flexShrink: 0, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
              <CardContent>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  已还金额
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                  {formatCurrency(summary.paid_amount)}
                </Typography>
              </CardContent>
            </Card>

            <Card elevation={0} sx={{ minWidth: 140, flex: 1, flexShrink: 0, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
              <CardContent>
                <Typography
                  sx={{
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-line)',
                    letterSpacing: 'var(--type-body-tracking)',
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  额度使用率
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: summary.utilization_rate > 70 ? 'var(--danger)' : 'var(--strong)', whiteSpace: 'nowrap' }}>
                  {summary.utilization_rate.toFixed(1)}%
                </Typography>
              </CardContent>
            </Card>
          </Stack>

          {/* Monthly Trend Chart */}
          <Card elevation={0} sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
            <CardContent>
              <Typography
                sx={{
                  fontSize: 'var(--type-section-size)',
                  lineHeight: 'var(--type-section-line)',
                  fontWeight: 'var(--type-section-weight)',
                  letterSpacing: 'var(--type-section-tracking)',
                  color: 'var(--text)',
                  mb: 2,
                }}
              >
                月度账单趋势
              </Typography>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={formatChartCurrency}
                    labelStyle={{ color: 'var(--muted)' }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="bill_amount"
                    stroke="#8884d8"
                    name="账单金额"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="paid_amount"
                    stroke="#82ca9d"
                    name="已还金额"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Category Breakdown Chart */}
          {categoryBreakdown.length > 0 && (
            <Card elevation={0} sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
              <CardContent>
                <Typography
                  sx={{
                    fontSize: 'var(--type-section-size)',
                    lineHeight: 'var(--type-section-line)',
                    fontWeight: 'var(--type-section-weight)',
                    letterSpacing: 'var(--type-section-tracking)',
                    color: 'var(--text)',
                    mb: 2,
                  }}
                >
                  消费分类占比
                </Typography>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(props: PieLabelRenderProps) => {
                        const p = props as unknown as { category?: string; percentage?: number }
                        return `${p.category ?? ''} ${Number(p.percentage || 0).toFixed(1)}%`
                      }}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="amount"
                    >
                      {categoryBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={formatChartCurrency} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Category List */}
          <Card elevation={0} sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e1)' }}>
            <CardContent>
              <Typography
                sx={{
                  fontSize: 'var(--type-section-size)',
                  lineHeight: 'var(--type-section-line)',
                  fontWeight: 'var(--type-section-weight)',
                  letterSpacing: 'var(--type-section-tracking)',
                  color: 'var(--text)',
                  mb: 2,
                }}
              >
                分类详情
              </Typography>
              <Stack spacing={1}>
                {categoryBreakdown.map((cat, i) => (
                  <Box
                    key={cat.category}
                    sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: COLORS[i % COLORS.length],
                        }}
                      />
                      <Typography
                        sx={{
                          fontSize: 'var(--type-body-size)',
                          lineHeight: 'var(--type-body-line)',
                          letterSpacing: 'var(--type-body-tracking)',
                          color: 'var(--text)',
                        }}
                      >
                        {cat.category}
                      </Typography>
                    </Box>
                    <Typography
                      className="num-tabular"
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {formatCurrency(cat.amount)}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        holderId={filters.holderId || holderOptions[0]?.id || ''}
        holders={holders}
        cards={cardOptions}
      />
    </Box>
  )
}
