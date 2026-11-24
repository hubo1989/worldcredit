'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getHolder, updateHolder } from '@/lib/api/holders'
import { createCard, getCardsByHolder, updateCard, type CreditCardWithProduct } from '@/lib/api/cards'
import { CardForm } from '@/components/mobile/CardForm'
import { CreditCardVisual } from '@/components/mobile/CreditCardVisual'
import { HolderForm } from '@/components/mobile/HolderForm'
import { updateMyHolderAliases } from '@/components/mobile/omnibusApi'
import { Toast } from '@/components/obsidian/overlays'
import { PlusIcon } from '@/components/icons/WcIcon'
import { useAuth } from '@/lib/auth'
import type { CardHolder } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const [cards, setCards] = useState<CreditCardWithProduct[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [holderEditOpen, setHolderEditOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardWithProduct | undefined>(undefined)
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })
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

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSaveHolder = async (data: {
    name: string
    phone?: string
    email?: string
    avatar_color: string
    aliases?: string[]
  }) => {
    if (!holder) return
    try {
      if (user?.role === 'admin') {
        await updateHolder(holder.id, data as Parameters<typeof updateHolder>[1])
      } else {
        await updateMyHolderAliases(holder.id, data.aliases ?? [])
      }
      setToast({ open: true, message: '持卡人信息与账单别名已保存', severity: 'success' })
      await loadData()
    } catch (err) {
      // 成员若触发 admin 限制则退回仅更新别名
      try {
        await updateMyHolderAliases(holder.id, data.aliases ?? [])
        setToast({ open: true, message: '账单匹配别名已保存', severity: 'success' })
        await loadData()
      } catch {
        setToast({
          open: true,
          message: err instanceof Error ? err.message : '保存失败',
          severity: 'error',
        })
      }
    }
  }

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
          className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white'
          style={{ background: holder.avatar_color || '#3b6fe0' }}
        >
          {holder.name.charAt(0)}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-[17px] font-semibold leading-6'>{holder.name}</p>
          <p className='text-[12px] leading-4 text-d-muted'>{cards.length} 张卡</p>
        </div>
        <button
          type='button'
          onClick={() => setHolderEditOpen(true)}
          className='min-h-[38px] shrink-0 rounded-xl border border-d-border bg-d-surface px-3 text-[12px] font-semibold text-d-accent-light'
        >
          编辑与别名
        </button>
      </div>

      {holder.aliases && holder.aliases.length > 0 && (
        <div className='mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-d-border bg-d-surface px-3 py-2.5'>
          <span className='text-[11px] font-semibold text-d-muted'>账单匹配别名：</span>
          {holder.aliases.map(alias => (
            <span
              key={alias}
              className='rounded-full border border-d-border bg-d-subtle px-2 py-0.5 text-[11px] text-d-text'
            >
              {alias}
            </span>
          ))}
        </div>
      )}

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
        onClick={() => {
          setEditingCard(undefined)
          setFormOpen(true)
        }}
        className='fixed bottom-20 right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-d-accent text-white shadow-lg'
      >
        <PlusIcon size={22} />
      </button>

      <CardForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditingCard(undefined)
        }}
        holderId={id}
        onSubmit={async data => {
          if (editingCard) {
            await updateCard(editingCard.id, data)
          } else {
            await createCard(data)
          }
          await loadData()
        }}
        initial={editingCard}
      />

      <HolderForm
        open={holderEditOpen}
        onClose={() => setHolderEditOpen(false)}
        onSubmit={handleSaveHolder}
        initial={holder}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}

function BackIcon() {
  return (
    <svg
      width='18'
      height='18'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M15 18 9 12l6-6' />
    </svg>
  )
}
