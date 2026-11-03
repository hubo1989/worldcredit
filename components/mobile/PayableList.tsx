'use client'

import { useState } from 'react'
import {
  categoryLabel,
  PAYABLE_HISTORY_LIMIT,
  type PayableWithStatus,
  type PayablePaymentRecord,
} from '@/lib/api/payables'
import { payableNextCycleStatus } from '@/lib/utils'
import { badgeToneClass, type BillBadgeTone } from '@/lib/bills-view-model'
import { currencySymbol } from '@/lib/fx'
import { ClockIcon } from '@/components/icons/WcIcon'

export interface PayableRowProps {
  payable: PayableWithStatus
  /** 归属持卡人姓名；未指定归属时不显示 */
  holderName?: string
  /** 历史还款记录（按账期倒序）；undefined = 尚未加载 */
  payments?: PayablePaymentRecord[]
  /** 历史加载失败提示；为空表示无错误 */
  historyError?: string
  /** 历史请求在途（含重试）；优先于错误态展示 */
  historyLoading?: boolean
  /** 是否展开历史还款 */
  historyOpen?: boolean
  onToggleHistory?: () => void
  onEdit: (payable: PayableWithStatus) => void
  onPay: (payable: PayableWithStatus) => void
}

/** 展开按钮文案：达到上限时改称「最近 N 笔」，避免误以为已看全。 */
function historyLabel(payments: PayablePaymentRecord[] | undefined): string {
  if (!payments || payments.length === 0) return '历史还款'
  if (payments.length >= PAYABLE_HISTORY_LIMIT) return `最近 ${PAYABLE_HISTORY_LIMIT} 笔还款`
  return `历史还款 ${payments.length} 笔`
}

/** 历史还款展开区：加载中 / 失败 / 空 / 列表四态，避免嵌套三元。 */
function renderPayableHistory(
  payments: PayablePaymentRecord[] | undefined,
  historyError: string | undefined,
  historyLoading: boolean,
  currency: string
) {
  // 在途优先：重试时不显示上一次的错误
  if (historyLoading) {
    return <p className='mt-1.5 text-[11px] text-d-muted'>加载中…</p>
  }
  if (historyError) {
    return <p className='mt-1.5 text-[11px] text-d-danger-ink'>{historyError}</p>
  }
  if (payments === undefined) {
    return <p className='mt-1.5 text-[11px] text-d-muted'>加载中…</p>
  }
  if (payments.length === 0) {
    return <p className='mt-1.5 text-[11px] text-d-muted'>还没有历史还款记录</p>
  }
  return (
    <ul className='mt-1.5 flex flex-col gap-1'>
      {payments.map(record => (
        <li
          key={record.id}
          className='flex items-baseline justify-between gap-2 rounded-md bg-d-subtle px-2 py-1'
        >
          <span className='shrink-0 text-[11px] text-d-muted'>{record.period}</span>
          <span className='min-w-0 flex-1 truncate text-[11px] text-d-text'>
            {record.paid_at.slice(5)}
            {record.note ? ' · ' + record.note : ''}
          </span>
          <span className='shrink-0 text-[11px] font-semibold text-d-text'>
            {currencySymbol(currency)}
            {Number(record.amount).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 单条固定支出卡。从 PayableList 拆出：账单页现在把固定支出混进主列表统一排序。
 *
 * 整卡可点进编辑（与 BillCard 整卡进详情同交互模型）：固定支出没有单独的
 * 详情页，「编辑表单」就是它的详情视图。内层动作（复制账号/登记付款）阻止冒泡。
 *
 * 状态徽章与信用卡卡片同构（右上角、soft 底 + ink 文字）：
 *   已逾期(danger) / 待还款·今天应付(warn) / 待出账(success)。
 * 滚动模型（服务端 resolveDisplayPeriod）保证任一时刻卡片只呈现一期：
 * 「已登记」只可能出现在待出账态，待还款态一定是可登记付款的未付期。
 */
export function PayableRow({
  payable: p,
  holderName,
  payments,
  historyError,
  historyLoading = false,
  historyOpen = false,
  onToggleHistory,
  onEdit,
  onPay,
}: PayableRowProps) {
  const [copiedAccount, setCopiedAccount] = useState(false)
  const paid = p.status === 'paid'
  const overdue = p.status === 'overdue'

  // 右上角状态徽章（与信用卡账单的待还款/已结清徽章同位置同色系）
  const badge: { text: string; tone: BillBadgeTone } = overdue
    ? { text: `已逾期 ${Math.abs(p.days_until_due)} 天`, tone: 'danger' }
    : paid
      ? { text: '待出账', tone: 'success' }
      : p.days_until_due === 0
        ? { text: '今天应付', tone: 'warn' }
        : { text: '待还款', tone: 'warn' }

  // 底部细节行：待出账给出下期出账日（还款日 − 30），其余给本期应付日
  const detail = (() => {
    const due = p.due_date.slice(5)
    if (paid) {
      const next = payableNextCycleStatus(p.due_day, p.period)
      const mm = String(next.date.getMonth() + 1).padStart(2, '0')
      const dd = String(next.date.getDate()).padStart(2, '0')
      return `本期已付清 · 下期出账日 ${mm}-${dd}`
    }
    if (overdue) return `应付日 ${due}，已逾期 ${Math.abs(p.days_until_due)} 天`
    if (p.days_until_due === 0) return `今天应付（${due}）`
    return `距离应付日 ${p.days_until_due} 天（${due}）`
  })()

  const detailTone = paid
    ? 'text-d-success-ink'
    : overdue
      ? 'text-d-danger-ink'
      : 'text-d-gold'

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-baseline gap-1.5'>
            <button
              type='button'
              aria-label={`编辑固定支出 ${p.name}`}
              onClick={e => { e.stopPropagation(); onEdit(p) }}
              className='min-w-0 truncate text-left text-[15px] font-semibold leading-5 text-d-text'
            >
              {p.name}
            </button>
            <span className='shrink-0 whitespace-nowrap text-[12px] text-d-muted'>
              · {categoryLabel(p.category)}
            </span>
            {holderName && (
              <span className='shrink-0 whitespace-nowrap rounded-md bg-d-subtle px-1.5 py-0.5 text-[10px] font-semibold text-d-muted'>
                {holderName}
              </span>
            )}
          </div>
          <p className='mt-1 block text-[11px] leading-4 text-d-muted'>
            每月 {p.due_day} 日
          </p>
          {p.bank_account && (
            <button
              type='button'
              onClick={async e => {
                e.stopPropagation()
                try {
                  await navigator.clipboard?.writeText(p.bank_account!)
                  setCopiedAccount(true)
                  window.setTimeout(() => setCopiedAccount(false), 1500)
                } catch {
                  // 剪贴板被拒绝（无权限/非安全上下文）：保持原文案，不假装成功
                  setCopiedAccount(false)
                }
              }}
              title='点击复制账号'
              className='mt-0.5 block max-w-full truncate text-left text-[11px] leading-4 text-d-muted underline underline-offset-2'
            >
              {copiedAccount ? '已复制' : `账号 ${p.bank_account}`}
            </button>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            type='button'
            aria-label='编辑固定支出'
            onClick={e => { e.stopPropagation(); onEdit(p) }}
            className='text-[11px] font-semibold text-d-muted'
          >
            编辑
          </button>
          <span
            className={
              'whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold leading-5 ' +
              badgeToneClass(badge.tone)
            }
          >
            {badge.text}
          </span>
        </div>
      </div>

      <div className='mt-2.5 flex items-end justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-[11px] text-d-muted'>{paid ? '本期已付' : '本期应付'}</p>
          <p
            className={
              'mt-0.5 whitespace-nowrap text-[19px] font-bold leading-none ' +
              (paid ? 'text-d-success-ink' : overdue ? 'text-d-danger-ink' : 'text-d-text')
            }
          >
            {currencySymbol(p.currency)}
            {p.amount.toLocaleString()}
          </p>
        </div>
        {paid ? (
          <span className='shrink-0 text-[12px] font-semibold text-d-success-ink'>
            已登记
          </span>
        ) : (
          <button
            type='button'
            onClick={e => { e.stopPropagation(); onPay(p) }}
            className='h-11 shrink-0 whitespace-nowrap rounded-xl bg-d-accent px-4 text-xs font-semibold text-white'
          >
            登记付款
          </button>
        )}
      </div>

      <div
        className={
          'mt-3 flex items-center gap-1.5 text-[11px] font-semibold leading-4 ' + detailTone
        }
      >
        <ClockIcon size={14} />
        {detail}
      </div>

      {onToggleHistory && (
        <div className='mt-2.5 border-t border-d-border pt-2'>
          <button
            type='button'
            aria-expanded={historyOpen}
            onClick={e => { e.stopPropagation(); onToggleHistory() }}
            className='flex w-full items-center justify-between text-[11px] font-semibold text-d-muted'
          >
            <span>{historyLabel(payments)}</span>
            <span className='text-d-accent-light'>{historyOpen ? '收起' : '展开'}</span>
          </button>
          {historyOpen &&
            renderPayableHistory(payments, historyError, historyLoading, p.currency)}
        </div>
      )}
    </div>
  )
}

/**
 * 固定支出（房租 / 贷款等按月应付）。
 *
 * 与上方卡账分节展示：它们的到期与还款规则不同（没有免息期、没有额度），
 * 混在一张卡里会让两套口径互相污染。
 */
