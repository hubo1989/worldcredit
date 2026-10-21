'use client'

// components/opportunities/BookingEditor.tsx — record a booking already made
// with the bank/provider (reserves quota); settlement choices live in
// BookingSettlementDialog when cancelling.

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { recordOpportunityBooking } from '@/lib/api/opportunities'

export function BookingEditor({
  account,
  cycle,
  cardIds,
  onClose,
  onDone,
}: {
  account: { id: string; title: string }
  cycle: { id: string }
  cardIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [cardId, setCardId] = useState(cardIds[0] ?? '')
  const [serviceDate, setServiceDate] = useState('')
  const [serviceTime, setServiceTime] = useState('10:00')
  const [timeZone, setTimeZone] = useState('Asia/Shanghai')
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!keyRef.current) {
        keyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `booking-${crypto.randomUUID()}`
            : `booking-${Date.now()}`
      }
      // Local wall time → offset timestamp (Asia/Shanghai 简化为 +08:00 展示口径)
      const offset = timeZone === 'America/New_York' ? '-04:00' : '+08:00'
      await recordOpportunityBooking({
        account_id: account.id,
        cycle_id: cycle.id,
        card_id: cardId,
        service_at: `${serviceDate}T${serviceTime}:00${offset}`,
        service_time_zone: timeZone,
        quantity: Number.parseInt(quantity, 10) || 1,
        amount_minor: 0,
        note: note.trim() ? note.trim() : null,
        request_key: keyRef.current,
      })
      keyRef.current = null
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title={`记录预约 · ${account.title}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={busy}
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
          >
            取消
          </button>
          <button
            type='button'
            disabled={busy || !serviceDate}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {busy ? '提交中…' : '确认预约'}
          </button>
        </>
      }
    >
      <p className='text-[12px] leading-4 text-d-muted'>
        前提：已在银行或服务商处完成预约；此处记录并预留额度。
      </p>
      <div className='mt-3 flex gap-3'>
        <label className='flex-1'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>服务日期</span>
          <input
            type='date'
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
        <label className='flex-1'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>时间</span>
          <input
            type='time'
            value={serviceTime}
            onChange={(e) => setServiceTime(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
      </div>
      <div className='mt-3 flex gap-3'>
        <label className='flex-1'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>时区</span>
          <select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          >
            <option value='Asia/Shanghai'>Asia/Shanghai</option>
            <option value='America/New_York'>America/New_York</option>
          </select>
        </label>
        <label className='flex-1'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>数量</span>
          <input
            type='number'
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
      </div>
      {cardIds.length > 1 && (
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>使用的卡</span>
          <select
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          >
            {cardIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
      )}
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>备注（选填）</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='例如：周六晚 7 点餐厅'
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {error && (
        <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
      )}
    </ConfirmDialog>
  )
}
