'use client'

// components/opportunities/UsageEditor.tsx — record one usage against a
// specific account/cycle/card. The request_key is minted ONCE per submission
// attempt and reused across failures, so a retried form never double-writes
// and a failed submit never mints a fresh key behind the user's back.

import { useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { recordOpportunityUsage } from '@/lib/api/opportunities'
import type { OpportunityDto } from '@/lib/opportunities/queries.server'

function todayLocal(): string {
  const now = new Date()
  // The server validates against the rule timezone's civil date; the local
  // date box is a convenience default the user can adjust.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function UsageEditor({
  dto,
  open,
  onClose,
  onRecorded,
}: {
  dto: OpportunityDto | null
  open: boolean
  onClose: () => void
  onRecorded: () => void
}) {
  const [usedOn, setUsedOn] = useState(todayLocal())
  const [cardId, setCardId] = useState<string>('')
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stable per attempt: set when the user first submits, kept on failure.
  const requestKeyRef = useRef<string | null>(null)

  const amountAllowed = dto?.amount_limit_minor !== null && dto?.currency !== null
  const defaultCard = useMemo(() => dto?.card_ids[0] ?? '', [dto])
  const effectiveCard = cardId || defaultCard

  if (!dto) return null

  const reset = () => {
    setUsedOn(todayLocal())
    setCardId('')
    setQuantity('1')
    setAmount('')
    setNote('')
    setError(null)
    requestKeyRef.current = null
  }

  const submit = async () => {
    if (!dto.cycle_id) return
    setSubmitting(true)
    setError(null)
    try {
      if (!requestKeyRef.current) {
        requestKeyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `usage-${crypto.randomUUID()}`
            : `usage-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const qty = Number.parseInt(quantity, 10)
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('数量必须是正整数')
      const minor = amount.trim()
        ? Math.round(Number.parseFloat(amount) * 100)
        : 0
      if (!Number.isFinite(minor) || minor < 0) throw new Error('金额不合法')
      await recordOpportunityUsage({
        account_id: dto.account_id,
        cycle_id: dto.cycle_id,
        card_id: effectiveCard,
        used_on: usedOn,
        quantity: qty,
        amount_minor: minor,
        note: note.trim() ? note.trim() : null,
        request_key: requestKeyRef.current,
      })
      reset()
      onRecorded()
      onClose()
    } catch (err) {
      // Inputs and the request key survive the failure (spec §12).
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={`记录使用 · ${dto.title}`}
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
            disabled={submitting || !dto.cycle_id}
            onClick={submit}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {submitting ? '提交中…' : '确认记录'}
          </button>
        </>
      }
    >
      {!dto.cycle_id && (
        <p className='mb-2 rounded-lg bg-d-gold-soft px-2 py-1 text-[12px] text-d-warn-ink'>
          当前没有可记录的周期（{dto.reason}）
        </p>
      )}
      <label className='block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>使用日期</span>
        <input
          type='date'
          value={usedOn}
          max={todayLocal()}
          onChange={(e) => setUsedOn(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {dto.card_ids.length > 1 && (
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>使用的卡（共享额度任选其一）</span>
          <select
            value={effectiveCard}
            onChange={(e) => setCardId(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          >
            {dto.card_ids.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className='mt-3 flex gap-3'>
        <label className='block flex-1'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>数量（{dto.unit_label}）</span>
          <input
            type='number'
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
        {amountAllowed && (
          <label className='block flex-1'>
            <span className='mb-1 block text-[12px] font-semibold text-d-muted'>金额（{dto.currency}）</span>
            <input
              type='number'
              min={0}
              step='0.01'
              value={amount}
              placeholder='选填'
              onChange={(e) => setAmount(e.target.value)}
              className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
            />
          </label>
        )}
      </div>
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>备注（选填）</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {error && (
        <p className='mt-3 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] leading-4 text-d-danger-ink'>
          {error}（已保留输入，可直接重试）
        </p>
      )}
    </ConfirmDialog>
  )
}
