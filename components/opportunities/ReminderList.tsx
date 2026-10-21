'use client'

// components/opportunities/ReminderList.tsx + ReminderStateDialog.tsx — the
// actionable reminder list (product spec §7): read/dismiss/snooze/restore via
// updateOpportunityReminderState; P1 static claim reminders only support
// ignore/snooze (自动解除在 P2 领取数据落地后接入).

import { useState } from 'react'
import { updateOpportunityReminderState, getOpportunityReminders } from '@/lib/api/opportunities'
import { ReminderStateDialog } from './ReminderStateDialog'

const KIND_LABELS: Record<string, string> = {
  cycle_expiry: '本期截止',
  cycle_reset: '额度重置',
  claim_window_open: '领取开启',
  claim_window_deadline: '领取截止',
}

export interface ReminderStateView {
  event: {
    event_key: string
    kind: string
    title: string
    local_date_on: string
    action_hint: string
  }
  state: { revision: number }
}

export function ReminderList({
  items,
  onReload,
}: {
  items: ReminderStateView[]
  onReload: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snoozeTarget, setSnoozeTarget] = useState<ReminderStateView | null>(null)

  const act = async (input: Parameters<typeof updateOpportunityReminderState>[0]) => {
    setBusy(true)
    setError(null)
    try {
      await updateOpportunityReminderState(input)
      onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && (
        <p className='mb-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
      )}
      <div className='flex flex-col gap-2'>
        {items.map((item) => (
          <div key={item.event.event_key} className='rounded-2xl border border-d-border bg-d-surface p-4'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[14px] font-semibold text-d-text'>
                  {KIND_LABELS[item.event.kind] ?? item.event.kind} · {item.event.title}
                </p>
                <p className='mt-0.5 text-[12px] text-d-muted'>
                  {item.event.local_date_on} · {item.event.action_hint}
                </p>
              </div>
              <div className='flex shrink-0 gap-2'>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => setSnoozeTarget(item)}
                  className='text-[12px] font-semibold text-d-accent-light disabled:opacity-50'
                >
                  延后
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() =>
                    void act({ event_key: item.event.event_key, action: 'dismiss' })
                  }
                  className='text-[12px] font-semibold text-d-muted disabled:opacity-50'
                >
                  忽略
                </button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center text-[12px] text-d-muted'>
            未来 30 天没有待处理的权益提醒。
          </p>
        )}
      </div>

      <ReminderStateDialog
        target={snoozeTarget}
        onClose={() => setSnoozeTarget(null)}
        onDone={onReload}
      />
    </>
  )
}

/** Refresh helper shared by the calendar page and the dashboard strip. */
export async function loadReminders(): Promise<ReminderStateView[]> {
  const page = await getOpportunityReminders({ limit: 30 })
  return page.items as ReminderStateView[]
}
