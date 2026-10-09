'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getHolder } from '@/lib/api/holders'
import { createCard, getCardsByHolder, updateCard, type CreditCardWithProduct } from '@/lib/api/cards'
import { CardForm } from '@/components/mobile/CardForm'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import { PlusIcon } from '@/components/icons/WcIcon'
import type { CardHolder } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCardWithProduct[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardWithProduct | undefined>(undefined)
  const router = useRouter()

  const loadData = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([getHolder(id), getCardsByHolder(id)])
      setHolder(h)
      setCards(c)
    } catch (err) {
      console.error('Failed to load holder:', err)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (!holder) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4'>
        <div className='wc-skeleton h-[200px] w-full rounded-2xl' />
      </div>
    )
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-4 flex items-center gap-3'>
        <button
          type='button'
          aria-label='返回'
          onClick={() => router.back()}
          className='flex h-11 w-11 items-center justify-center rounded-full border border-d-border bg-d-surface text-d-text'
        >
          <BackIcon />
        </button>
        <span
          className='flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white'
          style={{ background: holder.avatar_color || '#3b6fe0' }}
        >
          {holder.name.charAt(0)}
        </span>
        <div className='min-w-0'>
          <p className='truncate text-[17px] font-semibold leading-6'>{holder.name}</p>
          <p className='text-[12px] leading-4 text-d-muted'>{cards.length} 张卡</p>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-d-border px-6 py-10 text-center'>
          <p className='text-[13px] leading-5 text-d-muted'>暂无信用卡，点击右下角添加</p>
        </div>
      ) : (
        cards.map(card => (
          <CreditCardVisual
            key={card.id}
            card={card}
            usedAmount={0}
            onClick={() => router.push(`/cards/${card.id}`)}
          />
        ))
      )}

      <button
        type='button'
        aria-label='添加信用卡'
        onClick={() => { setEditingCard(undefined); setFormOpen(true) }}
        className='fixed bottom-20 right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-d-accent text-white shadow-lg'
      >
        <PlusIcon size={22} />
      </button>

      <CardForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingCard(undefined) }}
        holderId={id}
        onSubmit={async (data) => {
          if (editingCard) {
            await updateCard(editingCard.id, data)
          } else {
            await createCard(data)
          }
          await loadData()
        }}
        initial={editingCard}
      />
    </div>
  )
}

function BackIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M15 18 9 12l6-6' />
    </svg>
  )
}
