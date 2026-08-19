'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Container, Box, Typography, Stack, IconButton, Paper } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { format } from 'date-fns'
import { insforge } from '@/lib/insforge'
import { StatusBadge } from '@/components/mobile/WcBadge'
import { WcSkeleton, WcEmptyState, WcErrorState } from '@/components/mobile/WcStates'
import { ChevronRightIcon, ClockIcon } from '@/components/icons/WcIcon'
import { getEffectiveBillingDay, getEffectiveDueConfig } from '@/lib/utils'
import type { CreditCard, CardProduct, CardHolder, Bill, Benefit, BenefitUsage } from '@/lib/types'

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

      // 1. 卡 + 卡产品 + 持卡人
      const { data: rawCard, error: e1 } = await insforge.database
        .from('credit_cards')
        .select('*, card_product:card_products(*), card_holders(*)')
        .eq('id', id)
        .single()
      if (e1) throw e1
      if (!rawCard) throw new Error('卡片不存在')

      const cardData = rawCard as CardDetail

      // 2. 该卡账单（按 due_date desc，limit 3）+ 还款聚合
      const { data: rawBills, error: e2 } = await insforge.database
        .from('bills')
        .select('*, payments(amount)')
        .eq('card_id', id)
        .order('due_date', { ascending: false })
        .limit(3)
      if (e2) throw e2

      const billList: BillWithPaid[] = ((rawBills || []) as any).map((b: any) => {
        const paid = (b.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        const amount = Number(b.bill_amount) || 0
        let status: Bill['status'] = 'unpaid'
        if (amount <= 0 || paid >= amount) status = 'paid'
        else if (paid > 0) status = 'partial'
        else {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const due = new Date(b.due_date); due.setHours(0, 0, 0, 0)
          if (due.getTime() < today.getTime()) status = 'overdue'
        }
        return { ...b, paid_amount: paid, computed_status: status }
      })
      setBills(billList)

      // 3. 权益 + 使用记录
      let benefitList: Array<Benefit & { used: number }> = []
      if (cardData.card_product_id) {
        const { data: rawBenefits } = await insforge.database
          .from('benefits')
          .select('*')
          .eq('card_product_id', cardData.card_product_id)
        const bs = (rawBenefits || []) as Benefit[]
        if (bs.length > 0) {
          const ids = bs.map(b => b.id)
          const { data: usages } = await insforge.database
            .from('benefit_usages')
            .select('benefit_id, used_at')
            .in('benefit_id', ids)
          const allUsages = (usages || []) as BenefitUsage[]
          const now = new Date()
         benefitList = bs.map(b => {
           const periodUsages = allUsages.filter(u => {
             if (u.benefit_id !== b.id) return false
             if (!u.used_at) return false
             if (b.period === 'one_time') return true
             const d = new Date(u.used_at)
             if (b.period === 'monthly') {
               return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
             }
             // yearly
             const resetMonth = b.reset_month || 1
             const startY = now.getMonth() + 1 >= resetMonth ? now.getFullYear() : now.getFullYear() - 1
             const start = new Date(startY, resetMonth - 1, 1)
             return d >= start
           })
           return { ...b, used: periodUsages.length }
         })
        }
      }
      setBenefits(benefitList)

      setCard(cardData)
    } catch (err: any) {
      setError(err?.message || '加载卡片失败')
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
  const last4 = card.card_number_last4

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
          background: 'linear-gradient(135deg, #0A1F44, #1E3A8A)',
          borderRadius: 'var(--radius-card)',
          p: 2.25,
          mb: 1.5,
          color: '#fff',
          overflow: 'hidden',
          minHeight: 150,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxShadow: 'var(--shadow-dark)',
        }}
      >
        {/* 金色半透明圆形装饰 */}
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: -36, top: -36,
            width: 140, height: 140, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201,162,39,0.45), rgba(201,162,39,0))',
          }}
        />
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: 18, bottom: -50,
            width: 110, height: 110, borderRadius: '50%',
            border: '1px solid rgba(201,162,39,0.35)',
          }}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ position: 'relative', zIndex: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 12.5, opacity: 0.78, letterSpacing: '0.02em' }}>{bankName}</Typography>
            <Typography sx={{ fontSize: 19, fontWeight: 700, mt: 0.25 }}>{cardName}</Typography>
          </Box>
          {card.status !== 'active' && (
            <Box sx={{ bgcolor: 'rgba(255,255,255,0.16)', px: 1, py: 0.25, borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600 }}>
              {card.status === 'frozen' ? '已冻结' : '已注销'}
            </Box>
          )}
        </Stack>
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Typography className="num-tabular" sx={{ fontSize: 17, letterSpacing: '0.08em', mb: 0.5 }}>
            ****&nbsp;****&nbsp;****&nbsp;{last4 || '----'}
          </Typography>
          <Typography sx={{ fontSize: 12.5, opacity: 0.85 }}>
            {holderName || '—'} · {card.card_type === 'loan' ? '贷款类' : '信用卡'}
          </Typography>
        </Box>
      </Box>

      {/* 额度三格 */}
      <Box
        sx={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5,
          bgcolor: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
          p: 1.5, mb: 1.5,
        }}
      >
        <Quota label="总额度" value={limit} color="var(--navy-800)" />
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
                  width: '100%', border: '1px solid var(--border)', bgcolor: 'var(--paper)',
                  cursor: 'pointer', p: 1.25, borderRadius: 'var(--radius-card)', textAlign: 'left',
                  transition: 'box-shadow var(--dur-fast) ease',
                  '&:hover': { boxShadow: 'var(--shadow-card)' },
                  '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: -2 },
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {b.bill_month} 账单
                  </Typography>
                  <Typography className="num-tabular" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-800)', mt: 0.25 }}>
                    ¥{Number(b.bill_amount).toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.25 }}>
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
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-800)' }}>{b.name}</Typography>
                    <Typography className="num-tabular" sx={{ fontSize: 12, color: over ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: 600 }}>
                      {b.used}/{b.quota}
                    </Typography>
                  </Stack>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(10,31,68,0.08)', overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: over ? 'var(--danger)' : 'var(--gold-500)', borderRadius: 3, transition: 'width var(--dur-fast) ease' }} />
                  </Box>
                  {b.description && (
                    <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.25 }}>{b.description}</Typography>
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
      <IconButton onClick={onBack} size="small" aria-label="返回">
        <ArrowBackIcon fontSize="small" />
      </IconButton>
      <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-800)' }}>{title}</Typography>
    </Stack>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', mb: 0.5, letterSpacing: '0.02em' }}>
        {title}
      </Typography>
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
        {children}
      </Paper>
    </Box>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography sx={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</Typography>
      <Typography className="num-tabular" sx={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-800)' }}>
        {value}
      </Typography>
    </Stack>
  )
}

function Quota({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mb: 0.25 }}>{label}</Typography>
      <Typography className="num-tabular" sx={{ fontSize: 15, fontWeight: 700, color }}>
        ¥{Number(value).toLocaleString()}
      </Typography>
    </Box>
  )
}
