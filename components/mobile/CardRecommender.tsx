// components/mobile/CardRecommender.tsx
'use client'

import { useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Alert,
  Skeleton,
  Collapse,
  IconButton,
  LinearProgress,
} from '@mui/material'
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  LocalOffer as PromoIcon,
  CardMembership as BenefitIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { getCardRecommendations, type PurchaseInput, type RecommendationResult } from '@/lib/api/recommendations'
import { usePermission } from '@/lib/hooks/usePermission'
import { getErrorMessage } from '@/lib/permissions'

const SCENARIOS = [
  { value: 'dining' as const, label: '餐饮' },
  { value: 'travel' as const, label: '出行' },
  { value: 'hotel' as const, label: '酒店' },
  { value: 'overseas' as const, label: '境外' },
  { value: 'online' as const, label: '网购' },
  { value: 'grocery' as const, label: '商超' },
] as const

const CURRENCIES = [
  { value: 'CNY', label: 'CNY - 人民币' },
  { value: 'USD', label: 'USD - 美元' },
  { value: 'EUR', label: 'EUR - 欧元' },
  { value: 'JPY', label: 'JPY - 日元' },
  { value: 'HKD', label: 'HKD - 港币' },
]

interface CardRecommenderProps {
  holderId?: string
}

export function CardRecommender({ holderId }: CardRecommenderProps) {
  const { profile } = usePermission()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [scenario, setScenario] = useState<PurchaseInput['scenario'] | undefined>()
  const [merchantKeyword, setMerchantKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<RecommendationResult[]>([])
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const handleSubmit = useCallback(async () => {
    if (!profile) return
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效的消费金额')
      return
    }

    setLoading(true)
    setError(null)
    setResults([])

    try {
      const input: PurchaseInput = {
        amount: parseFloat(amount),
        currency,
        scenario,
        merchantKeyword: merchantKeyword.trim() || undefined,
      }

      const recommendations = await getCardRecommendations(input, profile.id, profile.role, holderId)
      setResults(recommendations)
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [amount, currency, scenario, merchantKeyword, profile, holderId])

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) {
        next.delete(cardId)
      } else {
        next.add(cardId)
      }
      return next
    })
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'success'
    if (score >= 50) return 'warning'
    return 'error'
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        用卡建议
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              fullWidth
              label="消费金额"
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              inputProps={{ min: 0, step: 0.01 }}
              required
            />

            <FormControl fullWidth>
              <InputLabel>币种</InputLabel>
              <Select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                label="币种"
              >
                {CURRENCIES.map(c => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>消费场景</InputLabel>
              <Select
                value={scenario || ''}
                onChange={e => setScenario(e.target.value as PurchaseInput['scenario'] || undefined)}
                label="消费场景"
              >
                <MenuItem value="">无</MenuItem>
                {SCENARIOS.map(s => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="商户关键词（可选）"
              value={merchantKeyword}
              onChange={e => setMerchantKeyword(e.target.value)}
              placeholder="如：星巴克、滴滴、淘宝"
            />

            <Button
              variant="contained"
              fullWidth
              onClick={handleSubmit}
              disabled={loading || !amount}
            >
              {loading ? '分析中...' : '获取建议'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box>
          <Skeleton variant="rounded" height={150} sx={{ mb: 1 }} />
          <Skeleton variant="rounded" height={150} sx={{ mb: 1 }} />
          <Skeleton variant="rounded" height={150} />
        </Box>
      )}

      {!loading && results.length === 0 && amount && (
        <Alert severity="info">
          输入消费信息后点击"获取建议"查看推荐卡片
        </Alert>
      )}

      {!loading && results.length > 0 && (
        <Stack spacing={2}>
          <Alert severity="success">
            找到 {results.length} 张可用卡片
          </Alert>

          {results.map((result, index) => {
            const isExpanded = expandedCards.has(result.cardId)
            const isFirst = index === 0

            return (
              <Card
                key={result.cardId}
                sx={{
                  border: isFirst ? '2px solid' : '1px solid',
                  borderColor: isFirst ? 'primary.main' : 'divider',
                  position: 'relative',
                }}
              >
                {isFirst && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -12,
                      left: 16,
                      bgcolor: 'primary.main',
                      color: 'white',
                      px: 1.5,
                      py: 0.25,
                      borderRadius: 1,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    最佳推荐
                  </Box>
                )}

                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, mt: isFirst ? 1 : 0 }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {result.bankName} - {result.cardName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        评分: {result.score}
                      </Typography>
                    </Box>
                    <IconButton aria-label={isExpanded ? '收起卡片详情' : '展开卡片详情'} size="small" onClick={() => toggleCardExpansion(result.cardId)}>
                      {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Box>

                  <Box sx={{ mb: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, (result.score / 120) * 100)}
                      color={getScoreColor(result.score)}
                      sx={{ height: 8, borderRadius: 1 }}
                    />
                  </Box>

                  {result.reasons.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                      {result.reasons.map((reason, i) => (
                        <Chip key={i} label={reason} size="small" color="success" variant="filled" />
                      ))}
                    </Box>
                  )}

                  <Collapse in={isExpanded}>
                    <Stack spacing={1.5}>
                      {result.matchingPromos.length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            <PromoIcon fontSize="small" color="primary" />
                            匹配优惠 ({result.matchingPromos.length})
                          </Typography>
                          <Stack spacing={0.5}>
                            {result.matchingPromos.map(promo => (
                              <Box
                                key={promo.id}
                                sx={{
                                  p: 0.75,
                                  bgcolor: 'action.hover',
                                  borderRadius: 1,
                                }}
                              >
                                <Typography variant="body2" fontWeight={500}>
                                  {promo.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {promo.reason}
                                  {promo.endDate && ` · 截止 ${promo.endDate}`}
                                </Typography>
                              </Box>
                            ))}
                          </Stack>
                        </Box>
                      )}

                      {result.matchingBenefits.length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            <BenefitIcon fontSize="small" color="primary" />
                            可用权益 ({result.matchingBenefits.length})
                          </Typography>
                          <Stack spacing={0.5}>
                            {result.matchingBenefits.map(benefit => (
                              <Box
                                key={benefit.id}
                                sx={{
                                  p: 0.75,
                                  bgcolor: 'action.hover',
                                  borderRadius: 1,
                                }}
                              >
                                <Typography variant="body2" fontWeight={500}>
                                  {benefit.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {benefit.reason}
                                  {benefit.expiryDate && ` · 截止 ${benefit.expiryDate}`}
                                </Typography>
                              </Box>
                            ))}
                          </Stack>
                        </Box>
                      )}

                      {result.warnings.length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            <WarningIcon fontSize="small" color="warning" />
                            注意事项
                          </Typography>
                          <Stack spacing={0.5}>
                            {result.warnings.map((warning, i) => (
                              <Alert key={i} severity="warning" variant="outlined" sx={{ py: 0.5 }}>
                                <Typography variant="caption">{warning}</Typography>
                              </Alert>
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </Collapse>
                </CardContent>
              </Card>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
