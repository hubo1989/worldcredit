'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Container, Box, Typography, Stack, IconButton, Button, Paper } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { format } from 'date-fns'
import { createPayment, updateBillStatus, getBillDetail, getPaymentTotal } from '@/lib/api/bills'
import { StatusBadge, SourceBadge } from '@/components/mobile/WcBadge'
import { WcSkeleton, WcEmptyState, WcErrorState } from '@/components/mobile/WcStates'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { ChevronRightIcon, BankIcon, UserIcon, ClockIcon } from '@/components/icons/WcIcon'
import { getDueDate, getEffectiveBillingDay, getEffectiveDueConfig, getLoanNextDueDate } from '@/lib/utils'
import type { Bill, Payment, CreditCard, CardProduct, CardHolder } from '@/lib/types'

type BillDetail = Bill & {
  card: CreditCard & {
    card_holders?: CardHolder
    card_product: CardProduct
  }
  payments: Payment[]
}

/** 计算已还 / 剩余 / 状态 */
function computeBillProgress(bill: BillDetail) {
  const paid = (bill.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const amount = Number(bill.bill_amount) || 0
  const remaining = Math.max(0, amount - paid)
  let status: Bill['status'] = 'unpaid'
  if (amount <= 0 || paid >= amount) status = 'paid'
  else if (paid > 0) status = 'partial'
  else {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const due = new Date(bill.due_date); due.setHours(0, 0, 0, 0)
    if (due.getTime() < today.getTime()) status = 'overdue'
  }
  return { paid, remaining, status }
}

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [bill, setBill] = useState<BillDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // 账单 + 卡 + 卡产品 + 持卡人 + 还款记录，一次 RPC 返回
      const detail = await getBillDetail(id)
      const card = detail.bill.card
        ? { ...detail.bill.card, card_holders: detail.bill.card.card_holder }
        : undefined
      setBill({ ...(detail.bill as Bill), card, payments: detail.payments } as unknown as BillDetail)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载账单失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const handlePayment = async (data: { amount: number; paid_at: string; note?: string }) => {
    if (!bill) return
    await createPayment({
      bill_id: bill.id,
      amount: data.amount,
      paid_at: data.paid_at,
      channel: '手动还款',
      note: data.note,
    })
    // 重算状态
    const totalPaid = await getPaymentTotal(bill.id)
    const amount = Number(bill.bill_amount)
    let status: Bill['status'] = 'unpaid'
    if (amount <= 0 || totalPaid >= amount) status = 'paid'
    else if (totalPaid > 0) status = 'partial'
    await updateBillStatus(bill.id, status)
    await load()
  }

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="账单详情" onBack={() => router.back()} />
        <WcSkeleton height={120} count={1} />
        <WcSkeleton height={96} count={2} />
      </Container>
    )
  }

  if (error || !bill) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="账单详情" onBack={() => router.back()} />
        <WcErrorState
          message={error || '账单不存在或已被删除'}
          onRetry={load}
        />
      </Container>
    )
  }

  const card = bill.card
  const product = card?.card_product
  const holder = card?.card_holders
  const bankName = product?.bank_name || '未知银行'
  const cardName = product?.card_name || '信用卡'
  const holderName = holder?.name
  const last4 = card?.card_number_last4

  const { paid, remaining, status } = computeBillProgress(bill)
  const minPayment = bill.min_payment != null ? Number(bill.min_payment) : null
  const billAmount = Number(bill.bill_amount) || 0

  // 账单日 / 还款日 / 免息期
  const billingDay = card ? getEffectiveBillingDay(card) : 0
  const dueConfig = card && product ? getEffectiveDueConfig(card, product) : null
  const calculatedDueDate = card?.card_type === 'loan' && card.loan_due_day
    ? getLoanNextDueDate(card.loan_due_day, new Date())
    : card && product
      ? getDueDate(card, product, new Date(bill.statement_end || bill.statement_date || bill.bill_month || bill.due_date))
      : null
  const dueDayOfMonth = calculatedDueDate?.getDate() ??
    (dueConfig && dueConfig.type !== 'after_billing' ? dueConfig.value : 0)
  const grace = calculatedDueDate && (bill.statement_end || bill.statement_date)
    ? Math.max(0, Math.ceil((calculatedDueDate.getTime() - new Date(bill.statement_end || bill.statement_date || bill.due_date).getTime()) / (24 * 60 * 60 * 1000)))
    : 0

  const periodStart = bill.statement_start ? format(new Date(bill.statement_start), 'M/d') : ''
  const periodEnd = bill.statement_end ? format(new Date(bill.statement_end), 'M/d') : ''

  return (
    <Container maxWidth="sm" sx={{ py: 2, pb: 10 }}>
      <HeaderBack title="账单详情" onBack={() => router.back()} />

      {/* 头部：卡名 + 持卡人/银行 + 金额 + 状态徽章 */}
      <Paper elevation={0} sx={{ p: 2, mb: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'var(--navy-800)' }} noWrap>
              {cardName}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Badge chip={<><BankIcon size={11} />&nbsp;{bankName}</>} color="navy" />
              {holderName && (
                <Badge chip={<><UserIcon size={11} />&nbsp;{holderName}</>} color="blue" />
              )}
              {last4 && <Badge chip={`尾号 ${last4}`} color="muted" />}
            </Stack>
          </Box>
          <StatusBadge status={status} size="md" />
        </Stack>
        <Typography className="num-tabular" sx={{ fontSize: 28, fontWeight: 700, color: 'var(--navy-800)', mt: 1 }}>
          ¥{billAmount.toLocaleString()}
        </Typography>
      </Paper>

      {/* 金额四格 */}
      <Grid4
        items={[
          { label: '应还', value: billAmount },
          { label: '最低', value: minPayment },
          { label: '已还', value: paid, color: 'var(--success)' },
          { label: '剩余', value: remaining, color: 'var(--danger)' },
        ]}
      />

      {/* 账单周期 */}
      <Section title="账单周期">
        <Typography sx={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
          {periodStart && periodEnd ? `账单周期 ${periodStart} – ${periodEnd}` : '账单周期 —'}
          {last4 ? ` · 尾号 ${last4}` : ''}
        </Typography>
      </Section>

      {/* 日期信息 */}
      <Section title="日期信息">
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Box component="span">账单日 {billingDay ? `每月 ${billingDay} 日` : '—'}</Box>
          <Dot />
          <Box component="span">还款日 {dueDayOfMonth ? `每月 ${dueDayOfMonth} 日` : format(new Date(bill.due_date), 'MM-dd')}</Box>
          <Dot />
          <Box component="span" sx={{ color: 'var(--gold-700)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <ClockIcon size={12} /> 免息 {grace || '—'} 天
          </Box>
        </Stack>
      </Section>

      {/* 来源徽章 */}
      <Section title="数据来源">
        <SourceBadge source={(bill as { source?: string }).source || 'manual'} size="md" />
      </Section>

      {/* 还款记录 */}
      <Section title="还款记录">
        {bill.payments.length === 0 ? (
          <WcEmptyState title="尚未还款" description="点击下方「去还款」登记第一笔还款" />
        ) : (
          <Stack spacing={1}>
            {bill.payments.map(p => (
              <Box
                key={p.id}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  py: 1, borderBottom: '1px solid var(--divider)',
                }}
              >
                <Box>
                  <Typography className="num-tabular" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>
                    +¥{Number(p.amount).toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)', mt: 0.25 }}>
                    {format(new Date(p.paid_at), 'yyyy-MM-dd')}
                    {p.channel ? ` · ${p.channel}` : ''}
                  </Typography>
                </Box>
                {p.note && (
                  <Typography sx={{ fontSize: 11.5, color: 'var(--text-secondary)', maxWidth: 140, textAlign: 'right' }} noWrap>
                    {p.note}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Section>

      {/* 操作按钮 */}
      <Stack spacing={1} sx={{ mt: 2 }}>
        <Button
          fullWidth
          variant="contained"
          onClick={() => setPaymentOpen(true)}
          sx={{ py: 1.25, borderRadius: 'var(--radius-pill)', textTransform: 'none', fontWeight: 600 }}
        >
          去还款
        </Button>
        <Button
          fullWidth
          variant="outlined"
          onClick={() => card && router.push(`/cards/${card.id}`)}
          endIcon={<ChevronRightIcon size={16} />}
          sx={{ py: 1.25, borderRadius: 'var(--radius-pill)', textTransform: 'none', fontWeight: 600, borderColor: 'var(--navy-600)', color: 'var(--navy-600)' }}
        >
          查看卡片详情
        </Button>
      </Stack>

      <PaymentForm
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSubmit={handlePayment}
        totalAmount={remaining || billAmount}
        billMonth={bill.bill_month}
        billId={bill.id}
      />
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

function Dot() {
  return <Box component="span" sx={{ color: 'var(--border-strong)' }}>·</Box>
}

function Badge({ chip, color }: { chip: React.ReactNode; color: 'navy' | 'blue' | 'muted' }) {
  const map = {
    navy: { bg: 'rgba(30,58,138,0.08)', fg: 'var(--navy-600)' },
    blue: { bg: 'rgba(122,173,255,0.14)', fg: 'var(--navy-600)' },
    muted: { bg: 'rgba(91,100,120,0.10)', fg: 'var(--text-secondary)' },
  }[color]
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center',
        fontSize: 11, fontWeight: 600, color: map.fg, bgcolor: map.bg,
        borderRadius: 'var(--radius-pill)', px: 0.75, py: 0.15,
      }}
    >
      {chip}
    </Box>
  )
}

function Grid4({ items }: { items: { label: string; value: number | null; color?: string }[] }) {
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5,
        bgcolor: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
        p: 1.5, mb: 1.5,
      }}
    >
      {items.map(it => (
        <Box key={it.label} sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mb: 0.25 }}>{it.label}</Typography>
          <Typography className="num-tabular" sx={{ fontSize: 15, fontWeight: 700, color: it.color || 'var(--navy-800)' }}>
            {it.value != null ? `¥${Number(it.value).toLocaleString()}` : '—'}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
