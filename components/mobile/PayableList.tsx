'use client'

import { categoryLabel, type PayableWithStatus } from '@/lib/api/payables'
import { payableNextCycleStatus } from '@/lib/utils'
import { currencySymbol } from '@/lib/fx'
import { ClockIcon, PlusIcon } from '@/components/icons/WcIcon'

interface Props {
  payables: PayableWithStatus[]
  onAdd: () => void
  onEdit: (payable: PayableWithStatus) => void
  onPay: (payable: PayableWithStatus) => void
}

export interface PayableRowProps {
  payable: PayableWithStatus
  onEdit: (payable: PayableWithStatus) => void
  onPay: (payable: PayableWithStatus) => void
}

/** 单条固定支出卡。从 PayableList 拆出：账单页现在把固定支出混进主列表统一排序。 */
export function PayableRow({ payable: p, onEdit, onPay }: PayableRowProps) {
  const paid = p.status === 'paid'
  const overdue = p.status === 'overdue'
  // 已付清后的下期状态（2026-10-21 规则）：距下期还款日 ≥30 天为「待出账」
  //（出账日 = 还款日 − 30），不足 30 天为「待还款」。日期口径统一走
  // payableNextCycleStatus（月末收拢：31 日 → 下月最后一天）。
  const nextCycleLabel = (() => {
    const next = payableNextCycleStatus(p.due_day, p.period)
    const mm = String(next.date.getMonth() + 1).padStart(2, '0')
    const dd = String(next.date.getDate()).padStart(2, '0')
    return next.phase === 'awaiting_statement'
      ? `本期已付清 · 待出账（出账日 ${mm}-${dd}）`
      : `待还款 · 还款日 ${mm}-${dd}`
  })()
  const label = paid
    ? nextCycleLabel
    : overdue
      ? '已逾期 ' + Math.abs(p.days_until_due) + ' 天'
      : p.days_until_due === 0
        ? '今天应付'
        : '距离应付日 ' + p.days_until_due + ' 天'
  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-baseline gap-1.5'>
            <p className='min-w-0 truncate text-[15px] font-semibold leading-5 text-d-text'>
              {p.name}
            </p>
            <span className='shrink-0 whitespace-nowrap text-[12px] text-d-muted'>
              · {categoryLabel(p.category)}
            </span>
          </div>
          <p className='mt-1 block text-[11px] leading-4 text-d-muted'>
            每月 {p.due_day} 日 · 本期应付日 {p.due_date.slice(5)}
          </p>
          {p.bank_account && (
            <button
              type='button'
              onClick={() => { void navigator.clipboard?.writeText(p.bank_account!) }}
              title='点击复制账号'
              className='mt-0.5 block max-w-full truncate text-left text-[11px] leading-4 text-d-muted underline underline-offset-2'
            >
              账号 {p.bank_account}
            </button>
          )}
        </div>
        <button
          type='button'
          aria-label='编辑固定支出'
          onClick={() => onEdit(p)}
          className='shrink-0 text-[11px] font-semibold text-d-muted'
        >
          编辑
        </button>
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
            onClick={() => onPay(p)}
            className='h-11 shrink-0 whitespace-nowrap rounded-xl bg-d-accent px-4 text-xs font-semibold text-white'
          >
            登记付款
          </button>
        )}
      </div>

      <div
        className={
          'mt-3 flex items-center gap-1.5 text-[11px] font-semibold leading-4 ' +
          (paid ? 'text-d-success-ink' : overdue ? 'text-d-danger-ink' : 'text-d-gold')
        }
      >
        <ClockIcon size={14} />
        {label}
      </div>
    </div>
  )
}

/**
 * 固定支出（房租 / 贷款等按月应付）。
 *
 * 与上方卡账分节展示：它们的到期与还款规则不同（没有免息期、没有额度），
 * 混在一张卡里会让两套口径互相污染。
 */
export function PayableList({ payables, onAdd, onEdit, onPay }: Props) {
  return (
    <div>
      <div className='mb-2 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>固定支出</p>
        <button
          type='button'
          onClick={onAdd}
          className='flex items-center gap-1 text-[13px] font-semibold text-d-accent-light'
        >
          <PlusIcon size={15} />
          添加
        </button>
      </div>

      {payables.length === 0 ? (
        <div className='rounded-[14px] border border-d-border bg-d-surface px-4 py-4 text-center'>
          <p className='text-[12px] leading-5 text-d-muted'>
            还没有固定支出。房租、贷款这类每月固定要付的可以加在这里。
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-2.5'>
          {payables.map(p => (
            <PayableRow key={p.id} payable={p} onEdit={onEdit} onPay={onPay} />
          ))}
        </div>
      )}
    </div>
  )
}
