'use client'

// components/opportunities/OpportunityRow.tsx — one unified opportunity DTO
// rendered as a card. Presentation comes from view-model.ts; actions describe
// their real effect (记录使用 ≠ 领取，关注 ≠ 报名).

import { toRowVm, type OpportunityRowVm } from '@/lib/opportunities/view-model'
import type { OpportunityDto } from '@/lib/opportunities/queries.server'

const STATUS_TONE: Record<string, string> = {
  available_today: 'bg-d-accent/15 text-d-accent-light',
  expiring_soon: 'bg-d-gold-soft text-d-warn-ink',
  claimable: 'bg-d-accent/15 text-d-accent-light',
  exhausted: 'bg-d-subtle text-d-muted',
  needs_confirmation: 'bg-d-gold-soft text-d-warn-ink',
  not_started: 'bg-d-subtle text-d-muted',
  expired: 'bg-d-subtle text-d-muted',
}

export interface OpportunityRowActions {
  onPrimary?: (dto: OpportunityDto) => void
  onFollowToggle?: (dto: OpportunityDto) => void
  onOpenEntry?: (dto: OpportunityDto) => void
}

export function OpportunityRow({
  dto,
  actions = {},
  busy = false,
}: {
  dto: OpportunityDto
  actions?: OpportunityRowActions
  busy?: boolean
}) {
  const vm: OpportunityRowVm = toRowVm(dto)
  const canPrimary = dto.action === 'record_usage' || dto.action === 'record_claim' || dto.action === 'fix_data'

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='flex items-start gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <p className='truncate text-[15px] font-semibold leading-5 text-d-text'>{vm.title}</p>
            <span
              className={
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                (STATUS_TONE[dto.status] ?? STATUS_TONE.expired)
              }
            >
              {vm.statusLabel}
            </span>
          </div>
          <p className='mt-0.5 truncate text-[12px] leading-4 text-d-muted'>{vm.metaLine}</p>
          {vm.sharedText && (
            <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>{vm.sharedText}</p>
          )}
        </div>
        {actions.onFollowToggle && (
          <button
            type='button'
            disabled={busy}
            aria-label={dto.followed ? '取消关注' : '关注'}
            onClick={() => actions.onFollowToggle?.(dto)}
            className={
              'shrink-0 text-[12px] font-semibold disabled:opacity-50 ' +
              (dto.followed ? 'text-d-accent-light' : 'text-d-muted')
            }
          >
            {dto.followed ? '已关注' : '关注'}
          </button>
        )}
      </div>

      <div className='mt-2 flex items-end justify-between gap-2'>
        <div className='min-w-0'>
          <p className='text-[13px] font-semibold leading-5 text-d-accent-light'>{vm.balance.main}</p>
          {vm.balance.sub && (
            <p className='text-[12px] leading-4 text-d-muted'>{vm.balance.sub}</p>
          )}
        </div>
        <p className='shrink-0 text-[12px] leading-4 text-d-muted'>{vm.deadline}</p>
      </div>

      {vm.reviewHint && (
        <p className='mt-2 rounded-lg bg-d-gold-soft px-2 py-1 text-[11px] leading-4 text-d-warn-ink'>
          {vm.reviewHint}
        </p>
      )}

      <p className='mt-1.5 text-[12px] leading-4 text-d-muted'>{vm.reason}</p>

      <div className='mt-3 flex gap-2'>
        {canPrimary ? (
          <button
            type='button'
            disabled={busy}
            onClick={() => actions.onPrimary?.(dto)}
            className='h-10 flex-1 rounded-full bg-d-accent text-[13px] font-semibold text-white disabled:opacity-50'
          >
            {vm.actionLabel}
          </button>
        ) : (
          <div className='h-10 flex-1' />
        )}
        {dto.entry.website_url && actions.onOpenEntry && (
          <button
            type='button'
            onClick={() => actions.onOpenEntry?.(dto)}
            className='h-10 rounded-full border border-d-border px-4 text-[12px] font-semibold text-d-accent-light'
          >
            银行入口
          </button>
        )}
      </div>
    </div>
  )
}
