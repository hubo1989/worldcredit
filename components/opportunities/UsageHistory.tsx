'use client'

// components/opportunities/UsageHistory.tsx — usage history with audited
// corrections and voids (A08/A09 surface). Corrections demand a reason and an
// expected_revision; failures keep inputs and reuse the same request key.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { getUsageHistory, correctOpportunityUsage, voidOpportunityUsage } from '@/lib/api/opportunities'
import { formatMinorAmount } from '@/lib/opportunities/view-model'
import { RpcError } from '@/lib/api/rpc-client'
import type { UsageHistoryPage } from '@/lib/opportunities/usages.server'

export function UsageHistory({
  accountId,
  open,
  onClose,
  onChanged,
}: {
  accountId: string | null
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [page, setPage] = useState<UsageHistoryPage>({ items: [], next_cursor: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // correction dialog state
  const [target, setTarget] = useState<UsageHistoryPage['items'][number] | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const correctKeyRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const data = await getUsageHistory({ account_id: accountId, limit: 30 })
      setPage(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const submitCorrect = async () => {
    if (!target) return
    setBusy(true)
    setFormError(null)
    try {
      if (!correctKeyRef.current) {
        correctKeyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `correct-${crypto.randomUUID()}`
            : `correct-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      await correctOpportunityUsage({
        usage_id: target.id,
        used_on: newDate || undefined,
        quantity: newQuantity ? Number.parseInt(newQuantity, 10) : undefined,
        reason,
        expected_revision: target.revision,
        request_key: correctKeyRef.current,
      })
      setTarget(null)
      setReason('')
      correctKeyRef.current = null
      await load()
      onChanged()
    } catch (err) {
      const message =
        err instanceof RpcError ? err.message : err instanceof Error ? err.message : String(err)
      setFormError(`${message}（输入已保留，可直接重试）`)
    } finally {
      setBusy(false)
    }
  }

  const submitVoid = async (usage: UsageHistoryPage['items'][number]) => {
    const reasonInput = window.prompt('撤销原因（必填，写入审计）')
    if (reasonInput === null) return
    setBusy(true)
    setError(null)
    try {
      await voidOpportunityUsage({
        usage_id: usage.id,
        reason: reasonInput.trim() || '撤销使用',
        expected_revision: usage.revision,
        request_key:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `void-${crypto.randomUUID()}`
            : `void-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={open}
        title='使用历史'
        onClose={busy ? () => {} : onClose}
        actions={
          <button
            type='button'
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted'
          >
            关闭
          </button>
        }
      >
        {loading ? (
          <div className='wc-skeleton h-24 w-full rounded-xl' />
        ) : error ? (
          <div className='text-center'>
            <p className='break-all px-2 text-[12px] leading-4 text-d-danger-ink'>{error}</p>
            <button
              type='button'
              onClick={() => void load()}
              className='mt-2 h-9 rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
            >
              重新加载
            </button>
          </div>
        ) : page.items.length === 0 ? (
          <p className='py-4 text-center text-[12px] text-d-muted'>暂无使用记录</p>
        ) : (
          <div className='max-h-[50dvh] overflow-y-auto'>
            {page.items.map((u) => (
              <div
                key={u.id}
                className='flex items-start gap-2 border-b border-d-border py-2 last:border-b-0'
              >
                <div className='min-w-0 flex-1'>
                  <p className='text-[13px] font-semibold leading-5 text-d-text'>
                    {u.used_on} · {u.quantity} 次
                    {u.amount_minor > 0 && ` · ${formatMinorAmount(u.amount_minor, null)}`}
                  </p>
                  <p className='truncate text-[11px] leading-4 text-d-muted'>
                    卡 {u.card_id}
                    {u.note ? ` · ${u.note}` : ''}
                    {u.status === 'voided' ? ' · 已撤销' : ''}
                  </p>
                </div>
                {u.status === 'active' && (
                  <div className='flex shrink-0 gap-2'>
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => {
                        setTarget(u)
                        setNewDate(u.used_on)
                        setNewQuantity(String(u.quantity))
                        setFormError(null)
                        correctKeyRef.current = null
                      }}
                      className='text-[12px] font-semibold text-d-accent-light disabled:opacity-50'
                    >
                      更正
                    </button>
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => void submitVoid(u)}
                      className='text-[12px] font-semibold text-d-danger-ink disabled:opacity-50'
                    >
                      撤销
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={target !== null}
        title='更正使用记录'
        onClose={busy ? () => {} : () => setTarget(null)}
        actions={
          <>
            <button
              type='button'
              disabled={busy}
              onClick={() => setTarget(null)}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              disabled={busy || reason.trim().length === 0}
              onClick={() => void submitCorrect()}
              className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              {busy ? '提交中…' : '确认更正'}
            </button>
          </>
        }
      >
        {target && (
          <>
            <p className='text-[12px] leading-4 text-d-muted'>
              原记录：{target.used_on} · {target.quantity} 次。更正为：
            </p>
            <div className='mt-2 flex gap-3'>
              <label className='block flex-1'>
                <span className='mb-1 block text-[12px] font-semibold text-d-muted'>日期</span>
                <input
                  type='date'
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
                />
              </label>
              <label className='block flex-1'>
                <span className='mb-1 block text-[12px] font-semibold text-d-muted'>数量</span>
                <input
                  type='number'
                  min={1}
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
                />
              </label>
            </div>
            <label className='mt-3 block'>
              <span className='mb-1 block text-[12px] font-semibold text-d-muted'>更正原因（必填）</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder='例如：日期录错一天'
                className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
              />
            </label>
            {formError && (
              <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] leading-4 text-d-danger-ink'>
                {formError}
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </>
  )
}
