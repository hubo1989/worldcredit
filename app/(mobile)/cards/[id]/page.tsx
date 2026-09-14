'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Container, Box, Typography, Stack, IconButton, Paper } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { format } from 'date-fns'
import { getCardDetail } from '@/lib/api/cards'
import { StatusBadge } from '@/components/mobile/WcBadge'
import { WcSkeleton, WcEmptyState, WcErrorState } from '@/components/mobile/WcStates'
import { ChevronRightIcon, ClockIcon } from '@/components/icons/WcIcon'
import { getEffectiveBillingDay, getEffectiveDueConfig, formatCardTail } from '@/lib/utils'
import type { CreditCard, CardProduct, CardHolder, Bill, Benefit } from '@/lib/types'

type CardDetail = CreditCard & {
  card_product: CardProduct
  card_holders?: CardHolder
}

type BillWithPaid = Bill & { paid_amount: number; computed_status: Bill['status'] }

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [card, setCard] = useState<CardDetail | null>(null)
  const [bills, setBills] = useState<BillWithPaid[]>([])
  const [benefits, setBenefits] = useState<Array<Benefit & { used: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // 卡 + 卡产品 + 持卡人 + 最近账单（含已还聚合）+ 权益使用进度，一次 RPC 返回
      const detail = await getCardDetail(id)
      setCard({
        ...detail.card,
        card_holders: detail.card.card_holder,
      } as unknown as CardDetail)
      setBills(detail.bills as unknown as BillWithPaid[])
      setBenefits(detail.benefits)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载卡片失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="卡片详情" onBack={() => router.back()} />
        <WcSkeleton height={180} count={1} />
        <WcSkeleton height={96} count={2} />
      </Container>
    )
  }

  if (error || !card) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="卡片详情" onBack={() => router.back()} />
        <WcErrorState message={error || '卡片不存在'} onRetry={load} />
      </Container>
    )
  }

  const product = card.card_product
  const bankName = product?.bank_name || '银行卡'
  const cardName = product?.card_name || '信用卡'
  const holderName = card.card_holders?.name
  const last4 = formatCardTail(card.card_number_last4)

  // 已用额度：SUM(bill_amount - paid) WHERE status != paid
  const used = bills
    .filter(b => b.computed_status !== 'paid')
    .reduce((s, b) => s + Math.max(0, Number(b.bill_amount) - b.paid_amount), 0)
  const limit = Number(card.credit_limit) || 0
  const available = Math.max(0, limit - used)

  const billingDay = getEffectiveBillingDay(card)
  const dueConfig = getEffectiveDueConfig(card, product)
  const dueDayOfMonth =
    card.loan_due_day ??
    (dueConfig.type !== 'after_billing' ? dueConfig.value : null)
  const grace = billingDay && dueDayOfMonth ? Math.max(0, dueDayOfMonth - billingDay) : null
  const annualFee = product?.annual_fee != null ? Number(product.annual_fee) : null
  const currency = product?.currency || 'CNY'

  return (
    <Container maxWidth="sm" sx={{ py: 2, pb: 10 }}>
      <HeaderBack title="卡片详情" onBack={() => router.back()} />

      {/* 卡面：深蓝渐变 + 卡种名 + 掩码卡号 + 持卡人 + 金色装饰 */}
      <Box
        sx={{
          position: 'relative',
          background: 'linear-gradient(135deg, var(--navy-800), var(--navy-600))',
          borderRadius: 'var(--radius-depth-3)',
          p: 2.25,
          mb: 1.5,
          color: 'var(--text-on-dark)',
          overflow: 'hidden',
          minHeight: 150,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // 深蓝渐变主卡：品牌暗影，不走中性分层
          boxShadow: 'var(--shadow-dark)',
        }}
      >
        {/* 金色半透明圆形装饰 */}
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: -36, top: -36,
            width: 140, height: 140, borderRadius: '50%',
            // 品牌金装饰：用 color-mix 从 --gold-500 派生透明度，不散落字面色值
            background: 'radial-gradient(circle, color-mix(in srgb, var(--gold-500) 45%, transparent), transparent)',
          }}
        />
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: 18, bottom: -50,
            width: 110, height: 110, borderRadius: '50%',
            border: '1px solid color-mix(in srgb, var(--gold-500) 35%, transparent)',
          }}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ position: 'relative', zIndex: 1 }}>
          <Box>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              {bankName}
            </Typography>
            <Typography
              sx={{
                fontSize: 'var(--type-section-size)',
                lineHeight: 'var(--type-section-line)',
                fontWeight: 'var(--type-section-weight)',
                letterSpacing: 'var(--type-section-tracking)',
                color: 'var(--text-on-dark)',
                mt: 0.25,
              }}
            >
              {cardName}
            </Typography>
          </Box>
          {card.status !== 'active' && (
            <Box
              sx={{
                bgcolor: 'rgba(255,255,255,0.16)',
                px: 1,
                py: 0.25,
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
              }}
            >
              {card.status === 'frozen' ? '已冻结' : '已注销'}
            </Box>
          )}
        </Stack>
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Typography className="num-tabular" sx={{ fontSize: 17, letterSpacing: '0.08em', mb: 0.5 }}>
            ****&nbsp;****&nbsp;****&nbsp;{last4 || '----'}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'rgba(255,255,255,0.82)',
            }}
          >
            {holderName || '—'} · {card.card_type === 'loan' ? '贷款类' : '信用卡'}
          </Typography>
        </Box>
      </Box>

      {/* 额度三格 */}
      <Box
        sx={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5,
          // 无边框：分层阴影表达层级
          bgcolor: 'var(--paper)', border: 0, borderRadius: 'var(--radius-depth-2)',
          boxShadow: 'var(--shadow-e1)',
          p: 1.5, mb: 1.5,
        }}
      >
        <Quota label="总额度" value={limit} color="var(--strong)" />
        <Quota label="已用" value={used} color="var(--gold-700)" />
        <Quota label="可用" value={available} color="var(--success)" />
      </Box>

      {/* 日期与费用 */}
      <Section title="日期与费用">
        <Stack spacing={0.75}>
          <Row label="账单日" value={billingDay ? `每月 ${billingDay} 日` : '—'} />
          <Row label="还款日" value={dueDayOfMonth ? `每月 ${dueDayOfMonth} 日` : (card.loan_due_day ? `每月 ${card.loan_due_day} 日` : '—')} />
          <Row
            label="最长免息"
            value={
              grace != null ? (
                <Box component="span" sx={{ color: 'var(--gold-700)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                  <ClockIcon size={12} /> {grace} 天
                </Box>
              ) : '—'
            }
          />
          <Row label="年费" value={annualFee != null ? `¥${annualFee.toLocaleString()}` : '—'} />
          <Row label="币种" value={currency} />
        </Stack>
      </Section>

      {/* 最近账单 */}
      <Section title="最近账单">
        {bills.length === 0 ? (
          <WcEmptyState title="暂无账单" description="这张卡还没有录入账单" />
        ) : (
          <Stack spacing={1}>
            {bills.map(b => (
              <Box
                key={b.id}
                component="button"
                onClick={() => router.push(`/bills/${b.id}`)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', border: 0, bgcolor: 'var(--paper)',
                  cursor: 'pointer', p: 1.25, borderRadius: 'var(--radius-depth-1)', textAlign: 'left',
                  boxShadow: 'var(--shadow-e1)',
                  transition: 'box-shadow var(--dur-fast) ease',
                  '&:hover': { boxShadow: 'var(--shadow-e2)' },
                  '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: -2 },
                }}
              >
                <Box>
                  <Typography
                    sx={{
                      fontSize: 'var(--type-body-size)',
                      lineHeight: 'var(--type-body-line)',
                      letterSpacing: 'var(--type-body-tracking)',
                      color: 'var(--muted)',
                    }}
                  >
                    {b.bill_month} 账单
                  </Typography>
                  <Typography className="num-tabular" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--strong)', mt: 0.25 }}>
                    ¥{Number(b.bill_amount).toLocaleString()}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 'var(--type-body-size)',
                      lineHeight: 'var(--type-body-line)',
                      letterSpacing: 'var(--type-body-tracking)',
                      color: 'var(--muted)',
                      mt: 0.25,
                    }}
                  >
                    到期 {format(new Date(b.due_date), 'yyyy-MM-dd')}
                  </Typography>
                </Box>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StatusBadge status={b.computed_status} />
                  <ChevronRightIcon size={16} />
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Section>

      {/* 权益进度（如无数据则省略） */}
      {benefits.length > 0 && (
        <Section title="权益进度">
          <Stack spacing={1.25}>
            {benefits.map(b => {
              const pct = b.quota > 0 ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0
              const over = b.used >= b.quota
              return (
                <Box key={b.id}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {b.name}
                    </Typography>
                    <Typography className="num-tabular" sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: over ? 'var(--danger)' : 'var(--muted)', fontWeight: 600 }}>
                      {b.used}/{b.quota}
                    </Typography>
                  </Stack>
                  <Box sx={{ height: 6, borderRadius: 'var(--radius-pill)', bgcolor: 'rgba(10,31,68,0.08)', overflow: 'hidden' }}>
                    {/* 进度填充用 transform 而非 width，避免布局抖动 */}
                    <Box
                      sx={{
                        height: '100%',
                        width: '100%',
                        transform: `scaleX(${Math.min(1, pct / 100)})`,
                        transformOrigin: 'left center',
                        bgcolor: over ? 'var(--danger)' : 'var(--gold-500)',
                        borderRadius: 'var(--radius-pill)',
                        transition: 'transform var(--dur-fast) ease',
                      }}
                    />
                  </Box>
                  {b.description && (
                    <Typography
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        color: 'var(--muted)',
                        mt: 0.25,
                      }}
                    >
                      {b.description}
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Stack>
        </Section>
      )}
    </Container>
  )
}

function HeaderBack({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
      <IconButton
        onClick={onBack}
        aria-label="返回"
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
        <ArrowBackIcon />
      </IconButton>
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
        {title}
      </Typography>
    </Stack>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography
        sx={{
          fontSize: 'var(--type-section-size)',
          lineHeight: 'var(--type-section-line)',
          fontWeight: 'var(--type-section-weight)',
          letterSpacing: 'var(--type-section-tracking)',
          color: 'var(--text)',
          mb: 0.75,
        }}
      >
        {title}
      </Typography>
      <Paper
        elevation={0}
        sx={{ p: 1.5, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e2)' }}
      >
        {children}
      </Paper>
    </Box>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography
        sx={{
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-line)',
          letterSpacing: 'var(--type-body-tracking)',
          color: 'var(--muted)',
        }}
      >
        {label}
      </Typography>
      <Typography className="num-tabular" sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', fontWeight: 600, color: 'var(--text)' }}>
        {value}
      </Typography>
    </Stack>
  )
}

function Quota({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography
        sx={{
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-line)',
          letterSpacing: 'var(--type-body-tracking)',
          color: 'var(--muted)',
          mb: 0.25,
        }}
      >
        {label}
      </Typography>
      <Typography className="num-tabular" sx={{ fontSize: 15, fontWeight: 700, color }}>
        ¥{Number(value).toLocaleString()}
      </Typography>
    </Box>
  )
}
