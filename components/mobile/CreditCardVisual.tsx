'use client'

import { formatAmount, formatCardTail } from '@/lib/utils'
import type { CreditCard, CardProduct } from '@/lib/types'

interface Props {
  card: CreditCard & { card_product?: CardProduct; bank_name?: string; card_name?: string }
  usedAmount?: number
  onClick?: () => void
}

// 银行品牌色表：数据性用色（每个银行一个可识别色），不进设计体系色板
const BANK_COLORS: Record<string, string> = {
  '招商银行': '#e53935',
  '工商银行': '#c62828',
  '建设银行': '#1565c0',
  '中国银行': '#c62828',
  '农业银行': '#2e7d32',
  '交通银行': '#0d47a1',
  '浦发银行': '#1976d2',
  '民生银行': '#00897b',
  '兴业银行': '#00695c',
  '中信银行': '#e65100',
  '光大银行': '#7b1fa2',
  '华夏银行': '#d32f2f',
  '平安银行': '#f57c00',
  '广发银行': '#c62828',
  '汇丰银行': '#c62828',
  '花旗银行': '#0d47a1',
}

export function CreditCardVisual({ card, usedAmount = 0, onClick }: Props) {
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0
  const bankName = card.bank_name ?? card.card_product?.bank_name ?? '银行卡'
  const cardName = card.card_name ?? card.card_product?.card_name ?? '信用卡'
  const bankColor = BANK_COLORS[bankName] || '#1976d2'
  const currency = card.card_product?.currency ?? 'CNY'
  const bar = usagePercent > 80 ? 'bg-d-danger' : usagePercent > 50 ? 'bg-d-warn-ink' : 'bg-d-accent'

  return (
    <button
      type='button'
      onClick={onClick}
      className='mb-3 w-full overflow-hidden rounded-2xl border border-d-border text-left'
    >
      <div className='px-4 pb-3 pt-4 text-white' style={{ background: `linear-gradient(135deg, ${bankColor} 0%, ${bankColor}dd 100%)` }}>
        <div className='flex items-center gap-2'>
          <CardGlyph />
          <span className='text-[17px] font-semibold leading-6'>{bankName}</span>
        </div>
        {/* 卡名省略，尾号不换行：尾号是区分同款卡的关键信息 */}
        <div className='mt-1 flex min-w-0 items-baseline gap-1 text-[13px] leading-5 text-white/80'>
          <span className='min-w-0 truncate'>{cardName}</span>
          {formatCardTail(card.card_number_last4) && (
            <span className='shrink-0 whitespace-nowrap'>•••• {formatCardTail(card.card_number_last4)}</span>
          )}
        </div>
      </div>

      <div className='bg-d-surface px-4 py-3'>
        <div className='mb-1.5 flex justify-between text-[12px] leading-4 text-d-muted'>
          <span>已用 {formatAmount(usedAmount, currency)}</span>
          <span>额度 {formatAmount(card.credit_limit, currency)}</span>
        </div>
        <div className='h-1.5 overflow-hidden rounded-full bg-d-border'>
          <div className={'h-full rounded-full ' + bar} style={{ width: `${Math.min(usagePercent, 100)}%` }} />
        </div>
        <p className='mt-1.5 text-[12px] leading-4 text-d-muted'>可用 {formatAmount(available, currency)}</p>
      </div>
    </button>
  )
}

function CardGlyph() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'>
      <rect x='2' y='5' width='20' height='14' rx='2' />
      <path d='M2 10h20' />
    </svg>
  )
}
