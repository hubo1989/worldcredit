'use client'

// app/(mobile)/promos/page.tsx — 我的可用机会（P1，Task 12）。数据来自统一
// getOpportunityPage；筛选/排序/分页由服务端完成，URL 参数固定为 §6.2 的
// holder/card/bank/category/kind/status/q。分类与状态不再靠标题关键词猜测。

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PromoIcon, PlusIcon } from '@/components/icons/WcIcon'
import { ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import { getOpportunityPage, setOpportunityFollowed } from '@/lib/api/opportunities'
import { createUserPromo } from '@/lib/api/promos'
import { OpportunityFilters, type OpportunityFilterValues } from '@/components/opportunities/OpportunityFilters'
import { OpportunityRow } from '@/components/opportunities/OpportunityRow'
import { UsageEditor } from '@/components/opportunities/UsageEditor'
import { filtersToQuery, queryToFilters } from '@/lib/opportunities/view-model'
import { useAuth } from '@/lib/auth'
import type { OpportunityDto } from '@/lib/opportunities/queries.server'

export default function PromosPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<OpportunityDto[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [cursor, setCursor] = useState<string | null>(null)
  const [filters, setFilters] = useState<OpportunityFilterValues & { }>({ kind: null, status: null, q: null })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recordTarget, setRecordTarget] = useState<OpportunityDto | null>(null)
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false, message: '', severity: 'info',
  })

  // 手动登记活动（兼容入口，写入旧目录待复核）
  const [addOpen, setAddOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBank, setNewBank] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 从 URL 恢复筛选（无 useSearchParams，避免构建期 Suspense 边界要求）
  useEffect(() => {
    const parsed = queryToFilters(new URLSearchParams(window.location.search))
    setFilters({ kind: parsed.kind, status: parsed.status, q: parsed.q })
  }, [])

  const loadPage = useCallback(
    async (nextFilters: OpportunityFilterValues, nextCursor: string | null) => {
      try {
        setLoading(true)
        setLoadError(null)
        const page = await getOpportunityPage({
          kind: nextFilters.kind,
          status: nextFilters.status,
          q: nextFilters.q,
          cursor: nextCursor,
          limit: 30,
        })
        setItems((prev) => (nextCursor ? [...prev, ...page.items] : page.items))
        setCounts(page.counts)
        setCursor(page.next_cursor)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadPage(filters, null)
  }, [filters, loadPage])

  const applyFilters = useCallback(
    (next: OpportunityFilterValues) => {
      setFilters(next)
      // 筛选变化从第一页开始；URL 同步固定参数名（§6.2）
      router.replace(`/promos${filtersToQuery({ kind: next.kind, status: next.status, q: next.q })}`)
    },
    [router],
  )

  const reload = useCallback(() => {
    void loadPage(filters, null)
  }, [filters, loadPage])

  const handleFollowToggle = useCallback(
    async (dto: OpportunityDto) => {
      try {
        await setOpportunityFollowed({
          account_id: dto.account_id,
          followed: !dto.followed,
          expected_revision: null,
        })
        reload()
      } catch (err) {
        setToast({ open: true, message: err instanceof Error ? err.message : String(err), severity: 'error' })
      }
    },
    [reload],
  )

  const handleOpenEntry = useCallback((dto: OpportunityDto) => {
    if (dto.entry.website_url) {
      window.open(dto.entry.website_url, '_blank', 'noopener')
      setToast({ open: true, message: '已打开银行入口（未改变关注或领取状态）', severity: 'info' })
    }
  }, [])

  const submitCreatePromo = async () => {
    setSubmitting(true)
    try {
      await createUserPromo({
        bank_name: newBank.trim() || '未命名银行',
        title: newTitle.trim(),
        discount_type: '满减',
        description: newDesc.trim(),
        start_date: new Date().toISOString().slice(0, 10),
        end_date: '2026-12-31',
      })
      setAddOpen(false)
      setNewTitle('')
      setNewDesc('')
      setToast({ open: true, message: '已登记活动，来源待复核后进入目录', severity: 'success' })
    } catch (err) {
      setToast({ open: true, message: err instanceof Error ? err.message : String(err), severity: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-3 flex flex-wrap items-start justify-between gap-x-2.5 gap-y-1.5'>
        <div className='min-w-0 flex-1'>
          <p className='whitespace-nowrap text-[20px] font-bold leading-7 text-d-text'>我的可用机会</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            下一步可做的动作：使用、领取或核对（{user?.name ?? ''}）
          </p>
        </div>
        <button
          type='button'
          onClick={() => setAddOpen(true)}
          className='flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-d-accent px-3.5 text-[12px] font-semibold text-d-accent-light'
        >
          <PlusIcon size={14} />
          登记活动
        </button>
      </div>

      <div className='mb-4'>
        <OpportunityFilters value={filters} counts={counts} onChange={applyFilters} />
      </div>

      {loading && items.length === 0 && [1, 2, 3].map((i) => (
        <div key={i} className='wc-skeleton mb-3 h-32 w-full rounded-2xl' />
      ))}

      {!loading && loadError && (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center'>
          <p className='break-all px-2 text-[12px] leading-4 text-d-danger-ink'>{loadError}</p>
          <button
            type='button'
            onClick={reload}
            className='mx-auto mt-3 flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
          >
            重新加载
          </button>
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <PromoIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>暂无符合条件的可用机会</p>
          <p className='mt-1 text-[12px] leading-4 text-d-muted'>
            机会基于你名下卡片的个人账户生成；先在「我的权益」初始化账户。
          </p>
        </div>
      )}

      <div className='flex flex-col gap-3'>
        {items.map((dto) => (
          <OpportunityRow
            key={dto.account_id}
            dto={dto}
            actions={{
              onPrimary: (d) => {
                if (d.action === 'record_usage' || d.action === 'record_claim') setRecordTarget(d)
                else reload()
              },
              onFollowToggle: (d) => void handleFollowToggle(d),
              onOpenEntry: handleOpenEntry,
            }}
          />
        ))}
      </div>

      {cursor && !loading && (
        <button
          type='button'
          onClick={() => void loadPage(filters, cursor)}
          className='mx-auto mt-4 flex h-10 items-center rounded-full border border-d-border px-5 text-[12px] font-semibold text-d-muted'
        >
          加载更多
        </button>
      )}

      <UsageEditor
        dto={recordTarget}
        open={recordTarget !== null}
        onClose={() => setRecordTarget(null)}
        onRecorded={reload}
      />

      <ConfirmDialog
        open={addOpen}
        title='手动登记银行活动'
        onClose={submitting ? () => {} : () => setAddOpen(false)}
        actions={
          <>
            <button
              type='button'
              disabled={submitting}
              onClick={() => setAddOpen(false)}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              disabled={submitting || newTitle.trim().length === 0}
              onClick={() => void submitCreatePromo()}
              className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              {submitting ? '提交中…' : '登记'}
            </button>
          </>
        }
      >
        <label className='block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>银行名称</span>
          <input
            value={newBank}
            onChange={(e) => setNewBank(e.target.value)}
            placeholder='例如：招商银行'
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>活动名称</span>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder='例如：周六加油满 200 减 30'
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>说明（参与方式）</span>
          <textarea
            rows={3}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          />
        </label>
      </ConfirmDialog>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </div>
  )
}
