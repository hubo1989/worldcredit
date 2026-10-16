'use client'

// components/opportunities/OpportunityFilters.tsx — kind/status chips plus a
// keyword box. The parent owns the URL query (fixed names per §6.2); this
// component only reports user intent, never mutates filters itself.

import { useState } from 'react'

export const STATUS_OPTIONS = [
  { value: null, label: '全部状态' },
  { value: 'available_today', label: '今天可用' },
  { value: 'expiring_soon', label: '即将到期' },
  { value: 'claimable', label: '待领取' },
  { value: 'exhausted', label: '已用尽' },
  { value: 'needs_confirmation', label: '需确认' },
] as const

export const KIND_OPTIONS = [
  { value: null, label: '全部' },
  { value: 'benefit', label: '权益' },
  { value: 'promo', label: '优惠' },
] as const

export interface OpportunityFilterValues {
  kind: string | null
  status: string | null
  q: string | null
}

export function OpportunityFilters({
  value,
  counts,
  onChange,
}: {
  value: OpportunityFilterValues
  counts?: Record<string, number>
  onChange: (next: OpportunityFilterValues) => void
}) {
  const [qDraft, setQDraft] = useState(value.q ?? '')

  const chip = (active: boolean) =>
    'h-8 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition-colors ' +
    (active ? 'bg-d-accent text-white' : 'bg-d-subtle text-d-muted')

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex gap-2 overflow-x-auto pb-0.5'>
        {KIND_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type='button'
            className={chip(value.kind === opt.value)}
            onClick={() => onChange({ ...value, kind: opt.value })}
          >
            {opt.label}
          </button>
        ))}
        <div className='w-px shrink-0 self-stretch bg-d-border' />
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type='button'
            className={chip(value.status === opt.value)}
            onClick={() => onChange({ ...value, status: opt.value })}
          >
            {opt.label}
            {counts && opt.value ? ` ${counts[opt.value] ?? 0}` : ''}
          </button>
        ))}
      </div>
      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault()
          onChange({ ...value, q: qDraft.trim() ? qDraft.trim().slice(0, 64) : null })
        }}
      >
        <input
          value={qDraft}
          maxLength={64}
          placeholder='搜索权益名称'
          onChange={(e) => setQDraft(e.target.value)}
          className='h-10 min-w-0 flex-1 rounded-xl border border-d-border bg-d-bg px-3 text-[14px] text-d-text outline-none placeholder:text-d-muted focus:border-d-accent'
        />
        <button
          type='submit'
          className='h-10 shrink-0 rounded-xl border border-d-border px-3 text-[12px] font-semibold text-d-accent-light'
        >
          搜索
        </button>
      </form>
    </div>
  )
}
