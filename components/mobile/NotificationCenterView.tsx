'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications'
import {
  formatCurrencyBuckets,
  NOTIFICATION_CATEGORY_META,
  type NotificationMetadata,
} from '@/lib/notifications.shared'
import type { UserNotificationItem } from '@/lib/types'
import { currencySymbol } from '@/lib/fx'
import {
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  DoneAllIcon,
  SettingsIcon,
  TrashIcon,
} from '@/components/icons/WcIcon'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { BottomSheet, ConfirmDialog, Toast } from '@/components/obsidian/overlays'

const TONE_BADGE_CLASS: Record<'danger' | 'gold' | 'accent' | 'muted', string> = {
  danger: 'bg-d-danger-soft text-d-danger-ink',
  gold: 'bg-d-gold-soft text-d-gold',
  accent: 'bg-d-subtle text-d-accent-light',
  muted: 'bg-d-subtle text-d-muted',
}

function formatSentTime(iso: string, full = false): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: full ? 'numeric' : undefined,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    return full
      ? `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
      : `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

const PAGE_SIZE = 50

function parseMetadata(raw: string | null): NotificationMetadata | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as NotificationMetadata
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function isSafeInternalUrl(url?: string | null): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')
}

function formatSingleAmount(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${(Number(amount) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

export function NotificationCenterView() {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [items, setItems] = useState<UserNotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<UserNotificationItem | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [toast, setToast] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'info' | 'error'
  }>({ open: false, message: '', severity: 'success' })

  const syncedTodayRef = useRef(false)
  const loadSeqRef = useRef(0)

  const loadList = useCallback(
    async (nextFilter: 'all' | 'unread' = filter, forceSync = false) => {
      const seq = ++loadSeqRef.current
      const shouldSync = forceSync || !syncedTodayRef.current
      setLoading(true)
      setError(null)
      try {
        const res = await getNotifications({
          filter: nextFilter,
          limit: PAGE_SIZE,
          offset: 0,
          syncToday: shouldSync,
        })
        if (seq !== loadSeqRef.current) return
        if (shouldSync) syncedTodayRef.current = true
        setItems(res.items)
        setUnreadCount(res.unread_count)
        setTotalCount(res.total_count)
        const expectedTotal = nextFilter === 'unread' ? res.unread_count : res.total_count
        setHasMore(res.items.length >= PAGE_SIZE && res.items.length < expectedTotal)
      } catch (err) {
        if (seq !== loadSeqRef.current) return
        setError(err instanceof Error ? err.message : '加载通知失败，请重试')
      } finally {
        if (seq === loadSeqRef.current) setLoading(false)
      }
    },
    [filter]
  )

  const handleLoadMore = async () => {
    if (loading || loadingMore || !hasMore) return
    const seq = loadSeqRef.current
    setLoadingMore(true)
    try {
      const res = await getNotifications({
        filter,
        limit: PAGE_SIZE,
        offset: items.length,
        syncToday: false,
      })
      if (seq !== loadSeqRef.current) return
      const seen = new Set(items.map(row => row.id))
      const merged = [...items, ...res.items.filter(row => !seen.has(row.id))]
      setItems(merged)
      setUnreadCount(res.unread_count)
      setTotalCount(res.total_count)
      const expectedTotal = filter === 'unread' ? res.unread_count : res.total_count
      setHasMore(res.items.length >= PAGE_SIZE && merged.length < expectedTotal)
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '加载更多失败',
        severity: 'error',
      })
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadList(filter)
  }, [filter, loadList])

  const handleMarkRead = async (item: UserNotificationItem) => {
    if (item.read_at || busy) return
    const nowIso = new Date().toISOString()
    try {
      const res = await markNotificationRead(item.id)
      setUnreadCount(res.unread_count)
      setItems(prev => {
        const updated = prev.map(row => (row.id === item.id ? { ...row, read_at: row.read_at ?? nowIso } : row))
        return filter === 'unread' ? updated.filter(row => !row.read_at) : updated
      })
      setSelected(prev => (prev && prev.id === item.id ? { ...prev, read_at: prev.read_at ?? nowIso } : prev))
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '标记已读失败',
        severity: 'error',
      })
    }
  }

  const handleOpenDetail = async (item: UserNotificationItem) => {
    setSelected(item)
    if (!item.read_at && !busy) {
      await handleMarkRead(item)
    }
  }

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || busy) return
    setBusy(true)
    try {
      const res = await markAllNotificationsRead()
      const nowIso = new Date().toISOString()
      setUnreadCount(res.unread_count)
      setItems(prev =>
        filter === 'unread' ? [] : prev.map(row => ({ ...row, read_at: row.read_at ?? nowIso }))
      )
      if (filter === 'unread') {
        setHasMore(false)
      }
      setSelected(prev => (prev ? { ...prev, read_at: prev.read_at ?? nowIso } : null))
      setToast({ open: true, message: '已全部标为已读', severity: 'success' })
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '全部已读失败',
        severity: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteOne = async (item: UserNotificationItem) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await deleteNotification(item.id)
      setUnreadCount(res.unread_count)
      setTotalCount(prev => Math.max(0, prev - 1))
      setItems(prev => prev.filter(row => row.id !== item.id))
      setSelected(prev => (prev?.id === item.id ? null : prev))
      setToast({ open: true, message: '通知已删除', severity: 'success' })
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '删除失败',
        severity: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      await deleteAllNotifications()
      setConfirmClearOpen(false)
      setSelected(null)
      setItems([])
      setUnreadCount(0)
      setTotalCount(0)
      setHasMore(false)
      setToast({ open: true, message: '已清空全部通知', severity: 'success' })
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : '清空失败',
        severity: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const selectedMeta = selected ? parseMetadata(selected.metadata_json) : null
  const selectedMetaInfo = selected
    ? NOTIFICATION_CATEGORY_META[selected.category] ?? NOTIFICATION_CATEGORY_META.system
    : null

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 pb-24 pt-4 text-d-text sm:px-5'>
      {/* 顶部栏 */}
      <div className='mb-4 flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            aria-label='返回'
            onClick={() => router.back()}
            className='flex h-11 w-11 items-center justify-center rounded-full border border-d-border bg-d-surface text-d-text active:bg-d-subtle'
          >
            <ChevronLeftIcon size={20} />
          </button>
          <div>
            <h1 className='text-[20px] font-bold leading-6 tracking-tight text-d-text'>通知中心</h1>
            <p className='text-[11px] text-d-muted'>
              {unreadCount > 0 ? `${unreadCount} 条未读` : '全部已读'}
            </p>
          </div>
        </div>
        <button
          type='button'
          onClick={() => router.push('/settings?open=reminders')}
          className='inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-d-border bg-d-surface px-3.5 text-[12px] font-semibold text-d-accent-light active:bg-d-subtle'
        >
          <SettingsIcon size={16} />
          <span>通知开关</span>
        </button>
      </div>

      {/* 筛选与批量操作栏 */}
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => setFilter('all')}
            className={
              'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors ' +
              (filter === 'all'
                ? 'bg-d-accent text-white'
                : 'border border-d-border bg-d-surface text-d-muted')
            }
          >
            全部 ({totalCount})
          </button>
          <button
            type='button'
            onClick={() => setFilter('unread')}
            className={
              'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors ' +
              (filter === 'unread'
                ? 'bg-d-accent text-white'
                : 'border border-d-border bg-d-surface text-d-muted')
            }
          >
            未读 ({unreadCount})
          </button>
        </div>

        <div className='flex gap-2'>
          <button
            type='button'
            disabled={unreadCount === 0 || busy}
            onClick={handleMarkAllRead}
            className='inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-d-border bg-d-surface px-3 text-[12px] font-semibold text-d-accent-light disabled:opacity-40 active:bg-d-subtle'
          >
            <DoneAllIcon size={15} />
            <span>全部已读</span>
          </button>
          <button
            type='button'
            disabled={totalCount === 0 || busy}
            onClick={() => setConfirmClearOpen(true)}
            className='inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-d-danger/30 bg-d-danger-soft px-3 text-[12px] font-semibold text-d-danger-ink disabled:opacity-40 active:opacity-80'
          >
            <TrashIcon size={15} />
            <span>全部删除</span>
          </button>
        </div>
      </div>

      {error && (
        <div className='mb-3'>
          <Alert
            severity='error'
            action={
              <button
                type='button'
                onClick={() => void loadList(filter)}
                className='min-h-[36px] rounded-lg border border-d-border bg-d-surface px-3 text-[12px] font-semibold text-d-text'
              >
                重试
              </button>
            }
          >
            {error}
          </Alert>
        </div>
      )}

      {loading && (
        <div className='flex flex-col items-center justify-center gap-3 py-16 text-d-muted'>
          <Spinner size={24} />
          <p className='text-[13px]'>正在加载通知…</p>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className='mt-6 flex flex-col items-center justify-center rounded-2xl border border-d-border bg-d-surface px-6 py-14 text-center'>
          <span className='mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-d-subtle text-d-muted'>
            <BellIcon size={22} />
          </span>
          <p className='text-[15px] font-semibold text-d-text'>
            {filter === 'unread' ? '暂无未读通知' : '暂无通知'}
          </p>
          <p className='mt-1 text-[12px] text-d-muted'>
            当日待还账单、固定支出、最长免息期及权益提醒都会集中展示在这里
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className='flex flex-col gap-3'>
          {items.map(item => {
            const meta = NOTIFICATION_CATEGORY_META[item.category] ?? NOTIFICATION_CATEGORY_META.system
            const isUnread = !item.read_at
            return (
              <div
                key={item.id}
                className={
                  'rounded-2xl border bg-d-surface p-4 transition-colors ' +
                  (isUnread ? 'border-d-accent/50' : 'border-d-border')
                }
              >
                <button
                  type='button'
                  onClick={() => void handleOpenDetail(item)}
                  className='w-full text-left'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <div className='flex items-center gap-2'>
                      {isUnread && (
                        <span
                          aria-label='未读'
                          className='inline-block h-2 w-2 shrink-0 rounded-full bg-d-accent'
                        />
                      )}
                      <span
                        className={
                          'rounded-md px-2 py-0.5 text-[11px] font-semibold ' +
                          TONE_BADGE_CLASS[meta.tone]
                        }
                      >
                        {meta.label}
                      </span>
                    </div>
                    <span className='text-[11px] text-d-muted'>{formatSentTime(item.sent_at)}</span>
                  </div>
                  <p className='mt-2 text-[14px] font-bold leading-5 text-d-text'>{item.title}</p>
                  {item.body && (
                    <p className='mt-1 line-clamp-2 whitespace-pre-line text-[13px] leading-5 text-d-muted'>
                      {item.body}
                    </p>
                  )}
                </button>

                <div className='mt-3 flex items-center justify-between border-t border-d-border/60 pt-2.5'>
                  <button
                    type='button'
                    onClick={() => void handleOpenDetail(item)}
                    className='min-h-[44px] px-1 text-[12px] font-semibold text-d-accent-light'
                  >
                    查看完整内容
                  </button>
                  <div className='flex items-center gap-2'>
                    {isUnread && (
                      <button
                        type='button'
                        disabled={busy}
                        onClick={() => void handleMarkRead(item)}
                        className='inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-d-border bg-d-subtle px-3 text-[12px] font-semibold text-d-text disabled:opacity-40'
                      >
                        <CheckIcon size={14} />
                        <span>已读</span>
                      </button>
                    )}
                    <button
                      type='button'
                      disabled={busy}
                      aria-label={`删除通知 ${item.title}`}
                      onClick={() => void handleDeleteOne(item)}
                      className='inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-d-danger/30 bg-d-danger-soft px-3 text-[12px] font-semibold text-d-danger-ink disabled:opacity-40'
                    >
                      <TrashIcon size={14} />
                      <span>删除</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {hasMore && (
            <button
              type='button'
              disabled={loadingMore}
              onClick={() => void handleLoadMore()}
              className='mt-1 min-h-[44px] w-full rounded-2xl border border-d-border bg-d-surface text-[13px] font-semibold text-d-accent-light disabled:opacity-50 active:bg-d-subtle'
            >
              {loadingMore ? '正在加载更多…' : '加载更多'}
            </button>
          )}
        </div>
      )}

      {/* 完整通知详情抽屉 */}
      <BottomSheet
        open={Boolean(selected)}
        title={selected?.title || '通知详情'}
        onClose={() => setSelected(null)}
        footer={
          selected ? (
            <div className='flex w-full items-center justify-between gap-2'>
              <button
                type='button'
                disabled={busy}
                onClick={() => void handleDeleteOne(selected)}
                className='min-h-[44px] rounded-xl border border-d-danger/40 bg-d-danger-soft px-4 text-[13px] font-semibold text-d-danger-ink disabled:opacity-40'
              >
                删除通知
              </button>
              {isSafeInternalUrl(selected.target_url) ? (
                <button
                  type='button'
                  onClick={() => {
                    const url = selected.target_url
                    if (!isSafeInternalUrl(url)) return
                    setSelected(null)
                    router.push(url)
                  }}
                  className='min-h-[44px] rounded-xl bg-d-accent px-5 text-[13px] font-semibold text-white'
                >
                  前往查看
                </button>
              ) : null}
            </div>
          ) : null
        }
      >
        {selected && (
          <div className='flex flex-col gap-3.5 text-d-text'>
            <div className='flex items-center justify-between gap-2'>
              {selectedMetaInfo && (
                <span
                  className={
                    'rounded-md px-2.5 py-0.5 text-[11px] font-semibold ' +
                    TONE_BADGE_CLASS[selectedMetaInfo.tone]
                  }
                >
                  {selectedMetaInfo.label}
                </span>
              )}
              <span className='text-[12px] text-d-muted'>
                {formatSentTime(selected.sent_at, true)}
              </span>
            </div>

            {selected.body && (
              <div className='rounded-2xl border border-d-border bg-d-subtle/60 p-4'>
                <p className='whitespace-pre-line text-[14px] leading-6 text-d-text'>
                  {selected.body}
                </p>
              </div>
            )}

            {selectedMeta?.kind === 'due_today_summary' && (
              <div className='rounded-2xl border border-d-border bg-d-subtle/40 p-4'>
                <div className='mb-2 flex items-center justify-between'>
                  <span className='text-[13px] font-bold'>当日待还明细</span>
                  {selectedMeta.totals_by_currency && (
                    <span className='text-[13px] font-bold text-d-gold'>
                      {formatCurrencyBuckets(selectedMeta.totals_by_currency)}
                    </span>
                  )}
                </div>
                <div className='flex flex-col gap-2'>
                  {(selectedMeta.bills || []).map(b => (
                    <div
                      key={b.id}
                      className='flex items-center justify-between rounded-xl bg-d-surface px-3 py-2 text-[13px]'
                    >
                      <span className='min-w-0 flex-1 truncate'>信用卡 · {b.subject}</span>
                      <span className='ml-2 shrink-0 font-semibold text-d-gold'>
                        {formatSingleAmount(b.remaining, b.currency)}
                      </span>
                    </div>
                  ))}
                  {(selectedMeta.payables || []).map(p => (
                    <div
                      key={p.id}
                      className='flex items-center justify-between rounded-xl bg-d-surface px-3 py-2 text-[13px]'
                    >
                      <span className='min-w-0 flex-1 truncate'>
                        固定支出（{p.category}）· {p.name}
                      </span>
                      <span className='ml-2 shrink-0 font-semibold text-d-gold'>
                        {formatSingleAmount(p.remaining, p.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedMeta?.kind === 'grace_period_longest' &&
              Array.isArray(selectedMeta.cards) &&
              selectedMeta.cards.length > 0 && (
                <div className='rounded-2xl border border-d-border bg-d-subtle/40 p-4'>
                  <p className='mb-2 text-[13px] font-bold'>今日新进入最长免息期</p>
                  <div className='flex flex-col gap-2'>
                    {selectedMeta.cards.map(c => (
                      <div
                        key={c.cardId}
                        className='rounded-xl bg-d-surface px-3 py-2.5 text-[13px]'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <span className='font-semibold text-d-text'>{c.label}</span>
                          <span className='shrink-0 font-bold text-d-gold'>{c.graceDays} 天</span>
                        </div>
                        <p className='mt-0.5 text-[11px] text-d-muted'>
                          下期账单日 {c.nextBillingDate} · 还款日 {c.nextDueDate}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </BottomSheet>

      {/* 全部删除二次确认 */}
      <ConfirmDialog
        open={confirmClearOpen}
        title='清空全部通知'
        onClose={() => !busy && setConfirmClearOpen(false)}
        actions={
          <>
            <button
              type='button'
              disabled={busy}
              onClick={() => setConfirmClearOpen(false)}
              className='min-h-[44px] rounded-xl border border-d-border bg-d-subtle px-4 text-[13px] font-semibold text-d-muted'
            >
              取消
            </button>
            <button
              type='button'
              disabled={busy}
              onClick={() => void handleDeleteAll()}
              className='min-h-[44px] rounded-xl bg-d-danger px-4 text-[13px] font-semibold text-white disabled:opacity-50'
            >
              {busy ? '清空中…' : '确认全部删除'}
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          确定要删除当前通知中心内的全部 {totalCount} 条通知吗？删除后不会重复弹出已删条目。
        </p>
      </ConfirmDialog>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}
