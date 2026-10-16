'use client'

// components/opportunities/AccountSetupDialog.tsx — initialize a personal
// ledger account for a catalog benefit: pick holder, its cards and the quota
// scope. Card scope = one card; holder scope = shared quota across the
// holder's linked cards. Server validates product eligibility either way.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { createOpportunityAccount } from '@/lib/api/opportunities'
import { getCardHolders, getAllCardsWithProduct } from '@/lib/api/cards'

interface HolderOption {
  id: string
  name: string
}
interface CardOption {
  id: string
  holder_id: string
  card_name?: string
  bank_name?: string
  card_number_last4?: string | null
  status?: string
  card_type?: string
}

export function AccountSetupDialog({
  benefit,
  open,
  onClose,
  onCreated,
}: {
  benefit: { definition_id: string | null; name: string } | null
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [holders, setHolders] = useState<HolderOption[]>([])
  const [cards, setCards] = useState<CardOption[]>([])
  const [holderId, setHolderId] = useState('')
  const [cardIds, setCardIds] = useState<string[]>([])
  const [scopeKind, setScopeKind] = useState<'card' | 'holder'>('card')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  const loadOptions = useCallback(async () => {
    try {
      const [holderRows, cardRows] = await Promise.all([getCardHolders(), getAllCardsWithProduct()])
      const hs = (holderRows ?? []) as HolderOption[]
      const cs = (cardRows ?? []) as CardOption[]
      setHolders(hs)
      setCards(cs.filter((c) => c.status !== 'frozen' && c.card_type !== 'loan'))
      if (hs.length > 0 && !holderId) setHolderId(hs[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [holderId])

  useEffect(() => {
    if (open) void loadOptions()
  }, [open, loadOptions])

  if (!benefit) return null

  const holderCards = cards.filter((c) => c.holder_id === holderId)
  const toggleCard = (id: string) => {
    setCardIds((prev) => {
      if (scopeKind === 'card') return prev.includes(id) ? [] : [id]
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })
  }

  const submit = async () => {
    if (!benefit.definition_id) return
    setSubmitting(true)
    setError(null)
    try {
      if (!keyRef.current) {
        keyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `setup-${crypto.randomUUID()}`
            : `setup-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      await createOpportunityAccount({
        definition_id: benefit.definition_id,
        holder_id: holderId,
        card_ids: cardIds,
        scope_kind: scopeKind,
        request_key: keyRef.current,
      })
      keyRef.current = null
      setCardIds([])
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    holderId.length > 0 && cardIds.length > 0 && (scopeKind === 'holder' || cardIds.length === 1)

  return (
    <ConfirmDialog
      open={open}
      title={`初始化账户 · ${benefit.name}`}
      onClose={submitting ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={submitting}
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
          >
            取消
          </button>
          <button
            type='button'
            disabled={submitting || !canSubmit || !benefit.definition_id}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {submitting ? '创建中…' : '创建账户'}
          </button>
        </>
      }
    >
      {!benefit.definition_id && (
        <p className='rounded-lg bg-d-gold-soft px-2 py-1 text-[12px] text-d-warn-ink'>
          该目录项尚未完成来源包装，暂不能初始化账户。
        </p>
      )}
      <label className='block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>持卡人</span>
        <select
          value={holderId}
          onChange={(e) => {
            setHolderId(e.target.value)
            setCardIds([])
          }}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        >
          {holders.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>

      <p className='mb-1 mt-3 block text-[12px] font-semibold text-d-muted'>
        关联卡（{scopeKind === 'card' ? '额度按单卡' : '额度在所选卡之间共享'}）
      </p>
      <div className='flex gap-2'>
        {(['card', 'holder'] as const).map((k) => (
          <button
            key={k}
            type='button'
            onClick={() => {
              setScopeKind(k)
              if (k === 'card') setCardIds((prev) => prev.slice(0, 1))
            }}
            className={
              'h-8 rounded-full px-3 text-[12px] font-semibold ' +
              (scopeKind === k ? 'bg-d-accent text-white' : 'bg-d-subtle text-d-muted')
            }
          >
            {k === 'card' ? '单卡额度' : '多卡共享'}
          </button>
        ))}
      </div>
      <div className='mt-2 flex flex-col gap-2'>
        {holderCards.length === 0 && (
          <p className='text-[12px] text-d-muted'>该持卡人名下暂无可用信用卡。</p>
        )}
        {holderCards.map((c) => (
          <button
            key={c.id}
            type='button'
            onClick={() => toggleCard(c.id)}
            className={
              'flex items-center justify-between rounded-xl border px-3 py-2 text-left ' +
              (cardIds.includes(c.id)
                ? 'border-d-accent bg-d-accent/10'
                : 'border-d-border bg-d-bg')
            }
          >
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-[13px] font-semibold text-d-text'>
                {c.bank_name ?? ''} {c.card_name ?? ''}
              </span>
              <span className='block text-[11px] text-d-muted'>
                尾号 {c.card_number_last4 ?? '----'}
              </span>
            </span>
            <span className='shrink-0 text-[12px] font-semibold text-d-accent-light'>
              {cardIds.includes(c.id) ? '已选' : '选择'}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className='mt-3 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] leading-4 text-d-danger-ink'>
          {error}（已保留选择，可直接重试）
        </p>
      )}
    </ConfirmDialog>
  )
}
