'use client'

// components/opportunities/ReminderStateDialog.tsx — snooze dialog with the
// exact resurface time; the server refuses snoozing past the event deadline
// (the same pure rule the P1 static reminders follow).

import { useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { updateOpportunityReminderState } from '@/lib/api/opportunities'
import type { ReminderStateView } from './ReminderList'

export function ReminderStateDialog({
  target,
  onClose,
  onDone,
}: {
  target: ReminderStateView | null
  onClose: () => void
  onDone: () => void
}) {
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await updateOpportunityReminderState({
        event_key: target.event.event_key,
        action: 'snooze',
        until_at: new Date(`${until}:00Z`).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        deadline_utc: `${target.event.local_date_on}T23:59:59Z`,
      })
      setUntil('')
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
      open={target !== null}
      title='延后提醒'
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
            disabled={busy || !until}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {busy ? '提交中…' : '确认延后'}
          </button>
        </>
      }
    >
      {target && (
        <>
          <p className='text-[12px] leading-4 text-d-muted'>
            「{target.event.title}」将在所选时间重新出现；不能晚于事件截止（{target.event.local_date_on}）。
          </p>
          <label className='mt-3 block'>
            <span className='mb-1 block text-[12px] font-semibold text-d-muted'>延后到（UTC）</span>
            <input
              type='datetime-local'
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
            />
          </label>
          {error && (
            <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
          )}
        </>
      )}
    </ConfirmDialog>
  )
}
