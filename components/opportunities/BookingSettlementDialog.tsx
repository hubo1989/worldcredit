'use client'

// components/opportunities/BookingSettlementDialog.tsx — cancellation demands
// an EXPLICIT settlement choice; no default branch.

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { cancelOpportunityBooking, completeOpportunityBooking } from '@/lib/api/opportunities'

export interface BookingRecord {
  fulfillment_id: string
  title: string
  status: 'recorded' | 'pending_settlement' | 'used' | 'cancelled' | 'expired'
  revision: number
  quantity: number
  service_at: string | null
}

export function BookingSettlementDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingRecord | null
  onClose: () => void
  onDone: () => void
}) {
  const [settlement, setSettlement] = useState<'returned' | 'charged' | 'unknown' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  if (!booking) return null

  const complete = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!keyRef.current) keyRef.current = `complete-${Date.now()}-${Math.random().toString(36).slice(2)}`
      await completeOpportunityBooking({
        fulfillment_id: booking.fulfillment_id,
        used_on: new Date().toISOString().slice(0, 10),
        expected_revision: booking.revision,
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

  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!settlement) throw new Error('请先选择取消结算结果')
      if (!keyRef.current) keyRef.current = `cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`
      await cancelOpportunityBooking({
        fulfillment_id: booking.fulfillment_id,
        settlement,
        reason,
        expected_revision: booking.revision,
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
      title={`预约处理 · ${booking.title}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={busy || booking.status !== 'recorded'}
            onClick={() => void complete()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-40'
          >
            标记已使用
          </button>
          <button
            type='button'
            disabled={busy || !settlement || reason.trim().length === 0}
            onClick={() => void cancel()}
            className='h-10 rounded-xl border border-d-danger px-5 text-sm font-semibold text-d-danger-ink disabled:opacity-40'
          >
            取消预约
          </button>
        </>
      }
    >
      <p className='text-[12px] leading-4 text-d-muted'>
        服务时间：{booking.service_at ?? '—'} · 数量 {booking.quantity} · 当前状态 {booking.status}。
        取消必须主动选择结算结果：
      </p>
      <div className='mt-2 flex gap-2'>
        {([
          ['returned', '额度已退回'],
          ['charged', '银行已扣除'],
          ['unknown', '结果未知'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type='button'
            onClick={() => setSettlement(value)}
            className={
              'h-9 rounded-full px-3 text-[12px] font-semibold ' +
              (settlement === value ? 'bg-d-accent text-white' : 'bg-d-subtle text-d-muted')
            }
          >
            {label}
          </button>
        ))}
      </div>
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>原因（必填，写入审计）</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {error && (
        <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
      )}
    </ConfirmDialog>
  )
}
