'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getHolders, createHolder, updateHolder, getHolderCardCounts } from '@/lib/api/holders'
import { Toast } from '@/components/obsidian/overlays'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { MergeHoldersDialog } from '@/components/mobile/MergeHoldersDialog'
import { useAuth } from '@/lib/auth'
import { PlusIcon } from '@/components/icons/WcIcon'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CardHolder | undefined>(undefined)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [toast, setToast] = useState<{ open: boolean; message: string }>({ open: false, message: '' })
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders(user?.id)
      setHolders(data)

      // 联查每个持卡人的信用卡数量
      if (data.length > 0) {
        const holderIds = data.map(h => h.id)
        setCardCounts(await getHolderCardCounts(holderIds))
      }
    } catch (err) {
      console.error('Failed to load holders:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadHolders()
  }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; email?: string; avatar_color: string }) => {
    if (!user) return
    await createHolder({ ...data, created_by: user.id })
    setFormOpen(false)
    loadHolders()
  }

  const handleUpdate = async (data: { name: string; phone?: string; email?: string; avatar_color: string }) => {
    if (!editing) return
    await updateHolder(editing.id, data)
    setEditing(undefined)
    setFormOpen(false)
    loadHolders()
  }

  const handleMergeSuccess = () => {
    setToast({ open: true, message: '🎉 持卡人已成功归拢合并！名下信用卡已全部转移。' })
    loadHolders()
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-4 flex items-center justify-between'>
        <p className='text-[20px] font-bold leading-7 text-d-text'>持卡人管理</p>
        {holders.length > 1 && (
          <button
            type='button'
            onClick={() => setMergeDialogOpen(true)}
            className='h-10 rounded-full border border-d-accent px-3.5 text-[12px] font-bold text-d-accent-light'
          >
            合并归拢
          </button>
        )}
      </div>

      {loading ? (
        <div className='flex flex-col gap-2.5'>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className='wc-skeleton h-[88px] w-full rounded-xl' />
          ))}
        </div>
      ) : holders.length === 0 ? (
        <div className='mt-10 text-center'>
          <p className='text-[13px] font-semibold leading-5 text-d-text'>还没有持卡人记录</p>
          <p className='mt-1 text-[12px] leading-4 text-d-muted'>
            点击右下角按钮添加您的第一个持卡人
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-2.5'>
          {holders.map(h => (
            <HolderCard
              key={h.id}
              holder={h}
              cardCount={cardCounts[h.id] || 0}
              onClick={() => router.push('/holders/' + h.id)}
              onEdit={() => { setEditing(h); setFormOpen(true) }}
            />
          ))}
        </div>
      )}

      <button
        type='button'
        aria-label='添加持卡人'
        onClick={() => setFormOpen(true)}
        className='fixed bottom-20 right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-d-accent text-white shadow-lg'
      >
        <PlusIcon size={22} />
      </button>

      <HolderForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined) }}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
      />

      <MergeHoldersDialog
        open={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        holders={holders}
        cardCounts={cardCounts}
        onSuccess={handleMergeSuccess}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        autoHideMs={3500}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}
