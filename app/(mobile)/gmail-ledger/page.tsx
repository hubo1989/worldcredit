'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  getGmailLedgerEntries,
  getGmailLedgerSummary,
  type GmailLedgerEntry,
} from '@/lib/api/gmail-ledger'
import { getBillImportDrafts } from '@/lib/api/billDrafts'
import { formatCardTail } from '@/lib/utils'
import { Button } from '@/components/obsidian/controls'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { Toast } from '@/components/obsidian/overlays'
import { ChevronDownIcon, ImportIcon, ChevronRightIcon } from '@/components/icons/WcIcon'
import { formatDraftAmount, migrateLegacyLedgerToDrafts } from '@/components/mobile/omnibusApi'

export default function GmailLedgerPage() {
  const router = useRouter()
  const [draftCount, setDraftCount] = useState<number>(0)
  const [entries, setEntries] = useState<GmailLedgerEntry[]>([])
  const [summary, setSummary] = useState({
    total: 0,
    unpaid: 0,
    partial: 0,
    paid: 0,
    totalAmount: 0,
    unpaidAmount: 0,
    needsAmount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [toast, setToast] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'info' | 'error'
  }>({ open: false, message: '', severity: 'info' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [drafts, entriesData, summaryData] = await Promise.all([
        getBillImportDrafts().catch(() => []),
        getGmailLedgerEntries().catch(() => [] as GmailLedgerEntry[]),
        getGmailLedgerSummary().catch(() => ({
          total: 0,
          unpaid: 0,
          partial: 0,
          paid: 0,
          totalAmount: 0,
          unpaidAmount: 0,
          needsAmount: 0,
        })),
      ])
      setDraftCount(drafts.length)
      setEntries(entriesData)
      setSummary(summaryData)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleMigrateLegacy = async () => {
    setMigrating(true)
    try {
      const res = await migrateLegacyLedgerToDrafts()
      setToast({
        open: true,
        severity: 'success',
        message:
          res.migrated_count > 0
            ? `已将 ${res.migrated_count} 条历史未入账记录转入统一草稿箱`
            : '所有历史有效记录均已收口至草稿箱或主账单',
      })
      await fetchData()
    } catch (err) {
      setToast({
        open: true,
        severity: 'error',
        message: err instanceof Error ? err.message : '迁移检查失败',
      })
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 pb-24 pt-4 text-d-text'>
      <div className='mb-4 flex items-center gap-2.5'>
        <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
          <ImportIcon size={20} />
        </span>
        <div>
          <h1 className='text-[20px] font-bold leading-6 text-d-text'>邮箱账单已升级为单轨草稿箱</h1>
          <p className='text-[12px] text-d-muted'>统一经 bill_import_drafts 核对确认后写入主账单</p>
        </div>
      </div>

      {/* 单轨升级引导主卡片 */}
      <div className='rounded-2xl border border-d-accent/40 bg-d-surface p-4'>
        <Alert severity='info'>
          邮箱账单已收口至统一草稿箱与主账单，不再单独记账或维护双轨还款状态。所有未处理的邮箱账单与历史待补金额条目均已合并至草稿箱。
        </Alert>

        <div className='mt-4 flex flex-col gap-2.5'>
          <Button onClick={() => router.push('/bills?drafts=1')}>
            前往账单草稿箱（{draftCount} 条待办）
            <ChevronRightIcon size={16} />
          </Button>
          <div className='grid grid-cols-2 gap-2'>
            <Button variant='secondary' onClick={() => router.push('/bills')}>
              查看主账单
            </Button>
            <Button
              variant='ghost'
              loading={migrating}
              onClick={() => void handleMigrateLegacy()}
            >
              检查遗留迁出
            </Button>
          </div>
        </div>
      </div>

      {/* 历史流水只读折叠存档 */}
      <div className='mt-4 rounded-2xl border border-d-border bg-d-surface p-4'>
        <button
          type='button'
          onClick={() => setArchiveOpen(v => !v)}
          className='flex w-full items-center justify-between text-left'
        >
          <div>
            <p className='text-[15px] font-semibold text-d-text'>历史邮箱账单只读存档</p>
            <p className='mt-0.5 text-[12px] text-d-muted'>
              共 {summary.total} 条历史流水（只读留档，不支持新建或在此还款）
            </p>
          </div>
          <ChevronDownIcon
            size={18}
            className={'text-d-muted transition-transform ' + (archiveOpen ? 'rotate-180' : '')}
          />
        </button>

        {archiveOpen && (
          <div className='mt-3 border-t border-d-border pt-3'>
            {loading ? (
              <div className='flex justify-center py-6'>
                <Spinner size={20} />
              </div>
            ) : entries.length === 0 ? (
              <p className='py-4 text-center text-[12px] text-d-muted'>暂无历史邮箱流水存档</p>
            ) : (
              <div className='flex flex-col gap-2'>
                {entries.map(entry => (
                  <div
                    key={entry.ledger_id}
                    className='rounded-xl border border-d-border bg-d-bg/60 p-3 text-[12px]'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <p className='font-semibold text-d-text'>
                        {entry.bank}
                        {entry.account_tail ? ` · ${formatCardTail(entry.account_tail)}` : ''}
                      </p>
                      <span className='rounded-full border border-d-border bg-d-surface px-2 py-0.5 text-[10px] text-d-muted'>
                        {entry.payment_status}
                      </span>
                    </div>
                    <p className='mt-1 text-d-muted'>
                      账单金额：
                      {formatDraftAmount(
                        entry.statement_amount,
                        (entry as unknown as { currency?: string }).currency || 'CNY'
                      )}
                      {entry.paid_amount > 0
                        ? ` · 历史已还 ${formatDraftAmount(
                            entry.paid_amount,
                            (entry as unknown as { currency?: string }).currency || 'CNY'
                          )}`
                        : ''}
                      {entry.due_date ? ` · 到期 ${entry.due_date}` : ''}
                    </p>
                    {entry.subject && (
                      <p className='mt-1 truncate text-[11px] text-d-muted'>{entry.subject}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}
