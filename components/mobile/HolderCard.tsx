'use client'

import type { CardHolder } from '@/lib/types'

interface Props {
  holder: CardHolder
  cardCount: number
  onClick: () => void
  onEdit?: () => void
}

/** 持卡人卡片（暗色）。仅 holders 页使用。 */
export function HolderCard({ holder, cardCount, onClick, onEdit }: Props) {
  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      className='flex cursor-pointer items-center gap-3 rounded-xl border border-d-border bg-d-surface p-3.5 transition-colors active:bg-d-subtle'
    >
      <span
        className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[20px] font-bold text-white'
        style={{ backgroundColor: holder.avatar_color }}
      >
        {holder.name.charAt(0)}
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-[15px] font-semibold leading-5 text-d-text'>
          {holder.name}
        </span>
        {holder.aliases && holder.aliases.length > 0 && (
          <span className='mt-0.5 block truncate text-[12px] leading-4 text-d-muted'>
            别名: {holder.aliases.join('、')}
          </span>
        )}
        {holder.phone && (
          <span className='block text-[12px] leading-4 text-d-muted'>{holder.phone}</span>
        )}
      </span>
      <span className='shrink-0 whitespace-nowrap rounded-full bg-d-subtle px-2.5 py-0.5 text-[11px] font-semibold text-d-accent-light'>
        {cardCount} 张卡
      </span>
      {onEdit && (
        <button
          type='button'
          aria-label='编辑持卡人'
          onClick={e => { e.stopPropagation(); onEdit() }}
          className='shrink-0 text-[12px] font-semibold text-d-muted'
        >
          编辑
        </button>
      )}
    </div>
  )
}
