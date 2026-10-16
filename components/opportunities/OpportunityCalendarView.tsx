'use client'

// components/opportunities/OpportunityCalendarView.tsx — the /benefits/calendar
// day list and month grid (P1, product spec §7). Static P1 events only:
// expiry/reset/claim windows; booking and task dates arrive with P2. Snoozed
// and dismissed events stay visible in the calendar with their state marks —
// the calendar is a factual view, hiding happens in the reminder list.

import { useMemo, useState } from 'react'
import type { CalendarEventView } from '@/lib/opportunities/notifications.server'

const KIND_LABELS: Record<string, string> = {
  cycle_expiry: '本期截止',
  cycle_reset: '额度重置',
  claim_window_open: '领取开启',
  claim_window_deadline: '领取截止',
}

function weekdayLabel(dateOn: string): string {
  const [y, m, d] = dateOn.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][jsDay]
}

export function OpportunityCalendarView({
  events,
  fromOn,
  toBefore,
  onOpenEvent,
}: {
  events: CalendarEventView[]
  fromOn: string
  toBefore: string
  onOpenEvent?: (event: CalendarEventView) => void
}) {
  const [mode, setMode] = useState<'list' | 'month'>('list')

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>()
    for (const event of events) {
      const list = map.get(event.local_date_on) ?? []
      list.push(event)
      map.set(event.local_date_on, list)
    }
    return map
  }, [events])

  const monthDays = useMemo(() => {
    const days: { date: string; count: number }[] = []
    const start = new Date(`${fromOn}T00:00:00Z`)
    const end = new Date(`${toBefore}T00:00:00Z`)
    for (let t = start; t < end; t = new Date(t.getTime() + 86_400_000)) {
      const date = t.toISOString().slice(0, 10)
      days.push({ date, count: byDate.get(date)?.length ?? 0 })
    }
    return days
  }, [byDate, fromOn, toBefore])

  return (
    <div>
      <div className='mb-3 flex gap-2'>
        {(['list', 'month'] as const).map((m) => (
          <button
            key={m}
            type='button'
            onClick={() => setMode(m)}
            className={
              'h-8 rounded-full px-3 text-[12px] font-semibold ' +
              (mode === m ? 'bg-d-accent text-white' : 'bg-d-subtle text-d-muted')
            }
          >
            {m === 'list' ? '按日列表' : '月历'}
          </button>
        ))}
      </div>

      {mode === 'list' ? (
        <div className='flex flex-col gap-3'>
          {[...byDate.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, dayEvents]) => (
              <div key={date} className='rounded-2xl border border-d-border bg-d-surface p-4'>
                <p className='text-[13px] font-bold text-d-text'>
                  {date} · {weekdayLabel(date)}
                </p>
                <div className='mt-2 flex flex-col gap-2'>
                  {dayEvents.map((event) => (
                    <button
                      key={event.event_key}
                      type='button'
                      onClick={() => onOpenEvent?.(event)}
                      className='flex items-center justify-between rounded-xl bg-d-subtle px-3 py-2 text-left'
                    >
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[13px] font-semibold text-d-text'>
                          {KIND_LABELS[event.kind] ?? event.kind} · {event.title}
                        </span>
                        <span className='block truncate text-[11px] text-d-muted'>
                          {event.action_hint}
                          {event.needs_review ? ' · 待核对（来源未核实）' : ''}
                          {event.dismissed ? ' · 已忽略' : ''}
                          {event.snoozed_until ? ' · 已延后' : ''}
                        </span>
                      </span>
                      <span className='shrink-0 text-[12px] font-semibold text-d-accent-light'>›</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          {byDate.size === 0 && (
            <p className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center text-[12px] text-d-muted'>
              该区间没有权益事件；机会基于已建账户生成。
            </p>
          )}
        </div>
      ) : (
        <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
          <div className='grid grid-cols-7 gap-1 text-center text-[10px] text-d-muted'>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className='mt-1 grid grid-cols-7 gap-1'>
            {/* 前置空位：第一天是周几 */}
            {Array.from({ length: (new Date(`${fromOn}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {monthDays.map((day) => (
              <div
                key={day.date}
                className={
                  'flex h-10 flex-col items-center justify-center rounded-lg text-[12px] ' +
                  (day.count > 0 ? 'bg-d-accent/15 font-bold text-d-accent-light' : 'text-d-muted')
                }
              >
                <span>{Number(day.date.slice(8))}</span>
                {day.count > 0 && <span className='text-[9px]'>{day.count}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
