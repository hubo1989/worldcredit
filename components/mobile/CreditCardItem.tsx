// components/mobile/CreditCardItem.tsx
'use client'

import type { CreditCard, CardProduct } from '@/lib/types'
import { formatCardTail } from '@/lib/utils'
import { CardIcon, CalendarIcon } from '@/components/icons/WcIcon'

interface Props {
  card: CreditCard & { card_product: CardProduct }
  onClick?: () => void
}

export function CreditCardItem({ card, onClick }: Props) {
  const product = card.card_product

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      className={
        'mb-2 overflow-hidden rounded-2xl p-3 text-white ' +
        // 卡面保留藏青→深青渐变识别度
        'bg-[linear-gradient(135deg,#030059_0%,#004f78_100%)] ' +
        (onClick ? 'cursor-pointer transition-transform active:scale-[0.98]' : '')
      }
    >
      <div className='mb-3 flex items-start justify-between'>
        <div>
          {/* 卡片标题 22/28 · 600 */}
          <p className='text-[22px] font-semibold leading-7 tracking-tight'>{product.bank_name}</p>
          <p className='text-[14.5px] leading-[18px] opacity-80'>{product.card_name}</p>
        </div>
        <CardIcon size={32} className='opacity-50' />
      </div>

      <div className='mb-3'>
        <p className='num-tabular text-[22px] font-semibold leading-7 tracking-[4px]'>
          **** **** **** {formatCardTail(card.card_number_last4) || '****'}
        </p>
      </div>

      {/* 深色渐变卡面上的分隔线：沿用白色低透明语义 */}
      <div className='mb-2 h-px bg-white/10' />

      <div className='flex items-center justify-between'>
        <div>
          <p className='text-[14.5px] leading-[18px] opacity-70'>额度</p>
          <p className='num-tabular text-[19px] font-semibold leading-6'>¥{Number(card.credit_limit).toLocaleString()}</p>
        </div>
        <div className='text-right'>
          <p className='text-[14.5px] leading-[18px] opacity-70'>账单日</p>
          <p className='flex items-center justify-end gap-0.5 text-[19px] font-semibold leading-6'>
            <CalendarIcon size={14} className='opacity-70' />
            {card.billing_day} 日
          </p>
        </div>
      </div>
    </div>
  )
}
