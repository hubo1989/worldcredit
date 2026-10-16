'use client'

// components/opportunities/BenefitLedgerView.tsx — the /benefits ledger list:
// accounts with balances, review hints, record/history actions and the
// account setup entry for catalog benefits that have no ledger account yet.

import { useState } from 'react'
import { BenefitIcon } from '@/components/icons/WcIcon'
import { OpportunityRow } from './OpportunityRow'
import { UsageEditor } from './UsageEditor'
import { UsageHistory } from './UsageHistory'
import { AccountSetupDialog } from './AccountSetupDialog'
import type { OpportunityDto, LedgerRow } from '@/lib/opportunities/queries.server'

export interface CatalogBenefitCard {
  /** Legacy benefit id (display key). */
  id: string
  /** Wrapped definition id for account setup. */
  definition_id: string | null
  name: string
  bank_name: string | null
  card_name: string | null
  hasAccount: boolean
}

export function BenefitLedgerView({
  rows,
  catalogBenefits,
  loading,
  error,
  onReload,
  onFollowToggle,
  onOpenEntry,
}: {
  rows: LedgerRow[]
  catalogBenefits: CatalogBenefitCard[]
  loading: boolean
  error: string | null
  onReload: () => void
  onFollowToggle: (dto: OpportunityDto) => void
  onOpenEntry: (dto: OpportunityDto) => void
}) {
  const [recordTarget, setRecordTarget] = useState<OpportunityDto | null>(null)
  const [historyAccount, setHistoryAccount] = useState<string | null>(null)
  const [setupBenefit, setSetupBenefit] = useState<CatalogBenefitCard | null>(null)

  const unassigned = catalogBenefits.filter((b) => !b.hasAccount)

  return (
    <div className='flex flex-col gap-3'>
      {loading && [1, 2, 3].map((i) => <div key={i} className='wc-skeleton h-32 w-full rounded-2xl' />)}

      {!loading && error && (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center'>
          <p className='break-all px-2 text-[12px] leading-4 text-d-danger-ink'>{error}</p>
          <button
            type='button'
            onClick={onReload}
            className='mx-auto mt-3 flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
          >
            重新加载
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && unassigned.length === 0 && (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <BenefitIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>暂无权益台账</p>
          <p className='mt-1 text-[12px] leading-4 text-d-muted'>
            名下卡片暂无可登记的权益账户；目录由管理员维护。
          </p>
        </div>
      )}

      {!loading &&
        !error &&
        rows.map((row) => (
          <div key={row.account_id} className='flex flex-col gap-2'>
            <OpportunityRow
              dto={row}
              actions={{
                onPrimary: (dto) => setRecordTarget(dto),
                onFollowToggle,
                onOpenEntry,
              }}
            />
            <div className='flex gap-2 px-1'>
              <button
                type='button'
                onClick={() => setHistoryAccount(row.account_id)}
                className='h-9 flex-1 rounded-full border border-d-border text-[12px] font-semibold text-d-muted'
              >
                使用历史 / 更正 / 撤销
              </button>
            </div>
          </div>
        ))}

      {!loading && !error && unassigned.length > 0 && (
        <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
          <p className='text-[13px] font-semibold text-d-text'>目录权益（未建账户）</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            以下目录权益尚未初始化个人账户，建立账户后才能记录使用与余额。
          </p>
          <div className='mt-3 flex flex-col gap-2'>
            {unassigned.map((b) => (
              <button
                key={b.id}
                type='button'
                onClick={() => setSetupBenefit(b)}
                className='flex items-center justify-between rounded-xl bg-d-subtle px-3 py-2 text-left'
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[13px] font-semibold text-d-text'>{b.name}</span>
                  <span className='block truncate text-[11px] text-d-muted'>
                    {[b.bank_name, b.card_name].filter(Boolean).join(' · ') || '未关联卡产品'}
                  </span>
                </span>
                <span className='shrink-0 text-[12px] font-semibold text-d-accent-light'>初始化账户</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <UsageEditor
        dto={recordTarget}
        open={recordTarget !== null}
        onClose={() => setRecordTarget(null)}
        onRecorded={onReload}
      />
      <UsageHistory
        accountId={historyAccount}
        open={historyAccount !== null}
        onClose={() => setHistoryAccount(null)}
        onChanged={onReload}
      />
      <AccountSetupDialog
        benefit={setupBenefit}
        open={setupBenefit !== null}
        onClose={() => setSetupBenefit(null)}
        onCreated={onReload}
      />

    </div>
  )
}
