'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { createPayment, updateBillStatus, getBillDetail, getPaymentTotal } from '@/lib/api/bills'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { ChevronLeftIcon, ChevronRightIcon, BankIcon, UserIcon, ClockIcon } from '@/components/icons/WcIcon'
import { getDueDate, getEffectiveBillingDay, getEffectiveDueConfig, getLoanNextDueDate, formatCardTail, getEffectiveCardName } from '@/lib/utils'
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

/** 状态徽章（暗色）：淡底 + ink，与 bills 暗色视图同一口径 */
function StatusBadgeDark({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    paid: { cls: 'bg-d-success-soft text-d-success-ink', label: '已还' },
    partial: { cls: 'bg-d-gold-soft text-d-warn-ink', label: '部分' },
    overdue: { cls: 'bg-d-danger-soft text-d-danger-ink', label: '逾期' },
    unpaid: { cls: 'bg-d-subtle text-d-accent-light', label: '待还' },
  }
  const cfg = map[status] ?? map.unpaid
  return (
    <span className={'shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ' + cfg.cls}>
      {cfg.label}
    </span>
  )
}

/** 来源徽章（暗色） */
function SourceBadgeDark({ source }: { source: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    email: { cls: 'bg-d-subtle text-d-accent-light', label: '邮件' },
    ai: { cls: 'bg-d-gold-soft text-d-warn-ink', label: 'AI' },
    manual: { cls: 'bg-d-subtle text-d-muted', label: '手动' },
  }
  const cfg = map[source] ?? map.manual
  return (
    <span className={'inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ' + cfg.cls}>
      {cfg.label}
    </span>
  )
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
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
        <HeaderBack title='账单详情' onBack={() => router.back()} />
        <div className='wc-skeleton mb-3 h-[120px] w-full rounded-2xl' />
        <div className='wc-skeleton mb-3 h-20 w-full rounded-2xl' />
        <div className='wc-skeleton h-20 w-full rounded-2xl' />
      </div>
    )
  }

  if (error || !bill) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
        <HeaderBack title='账单详情' onBack={() => router.back()} />
        <div className='rounded-2xl bg-d-danger-soft p-4 text-center'>
          <p className='text-[12px] font-semibold text-d-danger-ink'>{error || '账单不存在或已被删除'}</p>
          <button
            type='button'
            onClick={load}
            className='mt-2 h-10 rounded-xl bg-d-danger px-4 text-xs font-semibold text-white'
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  const card = bill.card
  const product = card?.card_product
  const holder = card?.card_holders
  const bankName = product?.bank_name || '未知银行'
  // 修改内容优先：卡级别名称覆盖 > 卡产品默认名称
  const cardName = card ? getEffectiveCardName(card, product) : '信用卡'
  const holderName = holder?.name
  const last4 = formatCardTail(card?.card_number_last4)

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
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
      <HeaderBack title='账单详情' onBack={() => router.back()} />

      {/* 头部：卡名 + 持卡人/银行 + 金额 + 状态徽章 */}
      <div className='mb-2.5 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='mb-1 flex items-start justify-between gap-2.5'>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[15px] font-semibold leading-5 text-d-text'>{cardName}</p>
            <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
              <span className='inline-flex items-center gap-1 rounded-full bg-d-subtle px-2 py-0.5 text-[12px] font-semibold leading-4 text-d-accent-light'>
                <BankIcon size={11} />
                {bankName}
              </span>
              {holderName && (
                <span className='inline-flex items-center gap-1 rounded-full bg-d-subtle px-2 py-0.5 text-[12px] font-semibold leading-4 text-d-accent-light'>
                  <UserIcon size={11} />
                  {holderName}
                </span>
              )}
              {last4 && (
                <span className='rounded-full bg-d-subtle px-2 py-0.5 text-[12px] font-semibold leading-4 text-d-muted'>
                  尾号 {last4}
                </span>
              )}
            </div>
          </div>
          <StatusBadgeDark status={status} />
        </div>
        <p className='num-tabular mt-2 text-[28px] font-bold leading-none text-d-text'>
          ¥{billAmount.toLocaleString()}
        </p>
      </div>

      {/* 金额四格 */}
      <Grid4
        items={[
          { label: '应还', value: billAmount, cls: 'text-d-text' },
          { label: '最低', value: minPayment, cls: 'text-d-text' },
          { label: '已还', value: paid, cls: 'text-d-success-ink' },
          { label: '剩余', value: remaining, cls: 'text-d-danger-ink' },
        ]}
      />

      {/* 账单周期 */}
      <Section title='账单周期'>
        <p className='text-[13px] leading-5 text-d-text'>
          {periodStart && periodEnd ? '账单周期 ' + periodStart + ' – ' + periodEnd : '账单周期 —'}
          {last4 ? ' · 尾号 ' + last4 : ''}
        </p>
      </Section>

      {/* 日期信息 */}
      <Section title='日期信息'>
        <div className='flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] leading-5 text-d-muted'>
          <span>账单日 {billingDay ? '每月 ' + billingDay + ' 日' : '—'}</span>
          <span className='text-d-border'>·</span>
          <span>还款日 {dueDayOfMonth ? '每月 ' + dueDayOfMonth + ' 日' : format(new Date(bill.due_date), 'MM-dd')}</span>
          <span className='text-d-border'>·</span>
          <span className='inline-flex items-center gap-1 font-bold text-d-gold'>
            <ClockIcon size={12} /> 免息 {grace || '—'} 天
          </span>
        </div>
      </Section>

      {/* 来源徽章 */}
      <Section title='数据来源'>
        <SourceBadgeDark source={(bill as { source?: string }).source || 'manual'} />
      </Section>

      {/* 还款记录 */}
      <Section title='还款记录'>
        {bill.payments.length === 0 ? (
          <div className='py-3 text-center'>
            <p className='text-[13px] font-semibold text-d-text'>尚未还款</p>
            <p className='mt-1 text-[12px] text-d-muted'>点击下方「去还款」登记第一笔还款</p>
          </div>
        ) : (
          <div className='flex flex-col'>
            {bill.payments.map((p, i) => (
              <div
                key={p.id}
                className={'flex items-center justify-between py-2' + (i > 0 ? ' border-t border-d-border' : '')}
              >
                <div>
                  <p className='num-tabular text-[15px] font-bold text-d-success-ink'>
                    +¥{Number(p.amount).toLocaleString()}
                  </p>
                  <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
                    {format(new Date(p.paid_at), 'yyyy-MM-dd')}
                    {p.channel ? ' · ' + p.channel : ''}
                  </p>
                </div>
                {p.note && (
                  <p className='max-w-[140px] truncate text-right text-[12px] leading-4 text-d-muted'>
                    {p.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 操作按钮 */}
      <div className='mt-4 flex flex-col gap-2.5'>
        <button
          type='button'
          onClick={() => setPaymentOpen(true)}
          className='h-12 w-full rounded-full bg-d-accent text-[14px] font-semibold text-white'
        >
          去还款
        </button>
        <button
          type='button'
          onClick={() => card && router.push('/cards/' + card.id)}
          className='flex h-12 w-full items-center justify-center gap-1.5 rounded-full border border-d-accent text-[14px] font-semibold text-d-accent-light'
        >
          查看卡片详情
          <ChevronRightIcon size={16} />
        </button>
      </div>

      <PaymentForm
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSubmit={handlePayment}
        totalAmount={remaining || billAmount}
        billMonth={bill.bill_month}
        billId={bill.id}
      />
    </div>
  )
}

function HeaderBack({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className='mb-2.5 flex items-center gap-2.5'>
      <button
        type='button'
        onClick={onBack}
        aria-label='返回'
        className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text'
      >
        <ChevronLeftIcon size={20} />
      </button>
      <p className='text-[15px] font-semibold leading-5 text-d-text'>{title}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='mb-2.5'>
      <p className='mb-1.5 text-[15px] font-semibold leading-5 text-d-text'>{title}</p>
      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>{children}</div>
    </div>
  )
}

function Grid4({ items }: { items: { label: string; value: number | null; cls: string }[] }) {
  return (
    <div className='mb-2.5 grid grid-cols-4 gap-0.5 rounded-2xl border border-d-border bg-d-surface p-2'>
      {items.map(it => (
        <div key={it.label} className='text-center'>
          <p className='mb-0.5 text-[12px] leading-4 text-d-muted'>{it.label}</p>
          <p className={'num-tabular text-[15px] font-bold ' + it.cls}>
            {it.value != null ? '¥' + Number(it.value).toLocaleString() : '—'}
          </p>
        </div>
      ))}
    </div>
  )
}
