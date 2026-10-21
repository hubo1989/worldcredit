'use client'

// app/(mobile)/benefits/calendar/page.tsx — 权益日历与提醒列表（P1，Task 16）。
// 数据来自 getOpportunityCalendar / getOpportunityReminders；日期与状态由
// 服务端按规则时区计算，页面只做展示与个人状态操作。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon } from '@/components/icons/WcIcon'
import { getOpportunityCalendar, getOpportunityReminders } from '@/lib/api/opportunities'
import { OpportunityCalendarView } from '@/components/opportunities/OpportunityCalendarView'
import { ReminderList, type ReminderStateView } from '@/components/opportunities/ReminderList'
import type { CalendarEventView } from '@/lib/opportunities/notifications.server'

function addDays(date: string, days: number): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
  return next.toISOString().slice(0, 10)
}

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function OpportunityCalendarPage() {
  const [fromOn, setFromOn] = useState(() => addDays(todayLocal(), -7))
  const [toBefore, setToBefore] = useState(() => addDays(todayLocal(), 31))
  const [events, setEvents] = useState<CalendarEventView[]>([])
  const [reminders, setReminders] = useState<ReminderStateView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'calendar' | 'reminders'>('calendar')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [cal, rem] = await Promise.all([
        getOpportunityCalendar({ from_on: fromOn, to_before: toBefore }),
        getOpportunityReminders({ limit: 30 }),
      ])
      setEvents(cal.events)
      setReminders(rem.items as ReminderStateView[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [fromOn, toBefore])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(
    () => Math.round((Date.parse(toBefore) - Date.parse(fromOn)) / 86_400_000),
    [fromOn, toBefore],
  )

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-3 flex items-center gap-2.5'>
        <a
          href='/benefits'
          aria-label='返回权益'
          className='flex h-9 w-9 items-center justify-center rounded-full border border-d-border'
        >
          <ChevronLeftIcon size={16} />
        </a>
        <div className='min-w-0 flex-1'>
          <p className='text-[18px] font-bold leading-6 text-d-text'>权益日历</p>
          <p className='text-[12px] leading-4 text-d-muted'>静态领取/截止/重置日期；未核实来源标待核对</p>
        </div>
      </div>

      <div className='mb-3 flex gap-2'>
        {(['calendar', 'reminders'] as const).map((t) => (
          <button
            key={t}
            type='button'
            onClick={() => setTab(t)}
            className={
              'h-9 rounded-full px-4 text-[13px] font-semibold ' +
              (tab === t ? 'bg-d-accent text-white' : 'bg-d-subtle text-d-muted')
            }
          >
            {t === 'calendar' ? '日历' : `待办提醒${reminders.length ? ` (${reminders.length})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <>
          <div className='mb-3 flex items-center gap-2 text-[12px] text-d-muted'>
            <input
              type='date'
              value={fromOn}
              max={toBefore}
              onChange={(e) => setFromOn(e.target.value)}
              className='h-9 rounded-xl border border-d-border bg-d-bg px-2 text-[13px] text-d-text'
            />
            <span>至</span>
            <input
              type='date'
              value={toBefore}
              min={fromOn}
              onChange={(e) => setToBefore(e.target.value)}
              className='h-9 rounded-xl border border-d-border bg-d-bg px-2 text-[13px] text-d-text'
            />
            {days > 92 && <span className='text-d-danger-ink'>范围超过 92 天</span>}
          </div>
          {loading ? (
            [1, 2, 3].map((i) => <div key={i} className='wc-skeleton mb-3 h-24 w-full rounded-2xl' />)
          ) : error ? (
            <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center'>
              <p className='break-all px-2 text-[12px] text-d-danger-ink'>{error}</p>
              <button
                type='button'
                onClick={() => void load()}
                className='mx-auto mt-3 flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
              >
                重新加载
              </button>
            </div>
          ) : (
            <OpportunityCalendarView events={events} fromOn={fromOn} toBefore={toBefore} />
          )}
        </>
      )}

      {tab === 'reminders' && <ReminderList items={reminders} onReload={() => void load()} />}
    </div>
  )
}
