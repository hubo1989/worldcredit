// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationCenterView } from '@/components/mobile/NotificationCenterView'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { DEFAULT_REMINDER_CONFIG } from '@/lib/api/preferences.shared'
import { NOTIFICATION_SWITCH_ITEMS } from '@/lib/notifications.shared'
import type { UserNotificationItem } from '@/lib/types'

const mockPush = vi.fn()
const mockBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}))

const mockGetNotifications = vi.fn()
const mockMarkNotificationRead = vi.fn()
const mockMarkAllNotificationsRead = vi.fn()
const mockDeleteNotification = vi.fn()
const mockDeleteAllNotifications = vi.fn()

vi.mock('@/lib/api/notifications', () => ({
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) => mockMarkAllNotificationsRead(...args),
  deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),
  deleteAllNotifications: (...args: unknown[]) => mockDeleteAllNotifications(...args),
}))

const SAMPLE_ITEMS: UserNotificationItem[] = [
  {
    id: 'n-1',
    user_id: 'u-1',
    notification_key: 'due_today_summary:2026-05-10',
    category: 'bill_due_today',
    title: '今日待还款 ¥1,000（共 2 笔）',
    body: '今天需完成以下 2 笔还款：\n• 招商银行 经典白(8888)：¥600\n• 固定支出·房租：¥400',
    target_url: '/dashboard',
    metadata_json: JSON.stringify({
      kind: 'due_today_summary',
      totals_by_currency: { CNY: 1000 },
      bills: [{ id: 'b-1', subject: '招商银行 经典白(8888)', remaining: 600, currency: 'CNY', due_date: '2026-05-10' }],
      payables: [{ id: 'p-1', name: '房租', category: '房租/按揭', remaining: 400, currency: 'CNY', due_date: '2026-05-10' }],
    }),
    sent_at: '2026-05-10T01:00:00.000Z',
    status: 'sent',
    error: null,
    read_at: null,
    deleted_at: null,
    push_sent_at: '2026-05-10T01:00:00.000Z',
  },
  {
    id: 'n-2',
    user_id: 'u-1',
    notification_key: 'grace_longest:2026-05-10',
    category: 'grace_period_longest',
    title: '今日最长免息期：招商银行 经典白(8888)',
    body: '昨日为账单日，今日刷卡可享 50 天最长免息期。',
    target_url: '/bills',
    metadata_json: JSON.stringify({
      kind: 'grace_period_longest',
      cards: [
        {
          cardId: 'c-1',
          label: '招商银行 经典白(8888)',
          graceDays: 50,
          nextBillingDate: '2026-06-09',
          nextDueDate: '2026-06-29',
        },
      ],
    }),
    sent_at: '2026-05-10T01:05:00.000Z',
    status: 'skipped',
    error: null,
    read_at: '2026-05-10T02:00:00.000Z',
    deleted_at: null,
    push_sent_at: null,
  },
]

describe('NotificationCenterView & ReminderPreferencesCard UI 交互', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockBack.mockReset()
    mockGetNotifications.mockReset().mockImplementation(async (opts?: { filter?: 'all' | 'unread' }) => {
      const items = opts?.filter === 'unread' ? SAMPLE_ITEMS.filter(i => !i.read_at) : SAMPLE_ITEMS
      return {
        items,
        unread_count: SAMPLE_ITEMS.filter(i => !i.read_at).length,
        total_count: SAMPLE_ITEMS.length,
      }
    })
    mockMarkNotificationRead.mockReset().mockResolvedValue({ updated: true, unread_count: 0 })
    mockMarkAllNotificationsRead.mockReset().mockResolvedValue({ updated_count: 1, unread_count: 0 })
    mockDeleteNotification.mockReset().mockResolvedValue({ deleted: true, unread_count: 0 })
    mockDeleteAllNotifications.mockReset().mockResolvedValue({ deleted_count: 2, unread_count: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('支持全部/未读筛选、点击展开完整内容详情并自动标为已读', async () => {
    render(<NotificationCenterView />)

    await waitFor(() => {
      expect(screen.getByText('今日待还款 ¥1,000（共 2 笔）')).toBeTruthy()
      expect(screen.getByText('今日最长免息期：招商银行 经典白(8888)')).toBeTruthy()
    })

    // 切换未读筛选（首屏已同步过今日通知，切换筛选不重复 syncToday，且每页 50 条）
    fireEvent.click(screen.getByRole('button', { name: '未读 (1)' }))
    await waitFor(() => {
      expect(mockGetNotifications).toHaveBeenCalledWith({
        filter: 'unread',
        limit: 50,
        offset: 0,
        syncToday: false,
      })
      expect(screen.queryByText('今日最长免息期：招商银行 经典白(8888)')).toBeNull()
    })

    // 点开未读通知查看详情并触发 markNotificationRead
    fireEvent.click(screen.getAllByRole('button', { name: /今日待还款 ¥1,000/ })[0])
    await waitFor(() => {
      expect(mockMarkNotificationRead).toHaveBeenCalledWith('n-1')
      expect(screen.getByText('固定支出（房租/按揭）· 房租')).toBeTruthy()
      expect(screen.getByText('信用卡 · 招商银行 经典白(8888)')).toBeTruthy()
    })
  })

  it('支持全部已读、单条删除、以及基于 ConfirmDialog 的全部删除（不调用 window.confirm）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<NotificationCenterView />)

    await waitFor(() => {
      expect(screen.getByText('今日待还款 ¥1,000（共 2 笔）')).toBeTruthy()
    })

    // 全部已读
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }))
    await waitFor(() => {
      expect(mockMarkAllNotificationsRead).toHaveBeenCalledTimes(1)
    })

    // 单条删除
    fireEvent.click(screen.getByRole('button', { name: '删除通知 今日待还款 ¥1,000（共 2 笔）' }))
    await waitFor(() => {
      expect(mockDeleteNotification).toHaveBeenCalledWith('n-1')
    })

    // 全部删除弹出 ConfirmDialog
    fireEvent.click(screen.getByRole('button', { name: '全部删除' }))
    await waitFor(() => {
      expect(screen.getByText('清空全部通知')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '确认全部删除' }))
    await waitFor(() => {
      expect(mockDeleteAllNotifications).toHaveBeenCalledTimes(1)
    })
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('ReminderPreferencesCard 展示全部 12 项独立开关并同步写入 items 与 opportunities', () => {
    const onChange = vi.fn()
    render(<ReminderPreferencesCard config={DEFAULT_REMINDER_CONFIG} onChange={onChange} />)

    for (const item of NOTIFICATION_SWITCH_ITEMS) {
      expect(screen.getByText(item.label)).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('switch', { name: '当日待还固定支出' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({ payable_due_today: false }),
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: '今日新增最长免息期账单' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({ grace_period_longest: false }),
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: '权益周期重置提醒' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({ opportunity_reset: false }),
        opportunities: expect.objectContaining({ reset_enabled: false }),
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: '预约服务提醒' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({ opportunity_booking: false }),
        opportunities: expect.objectContaining({ booking_enabled: false }),
      })
    )
  })

  it('支持加载更多分页，并拦截非站内危险 target_url', async () => {
    const firstPage: UserNotificationItem[] = Array.from({ length: 50 }, (_, idx) => ({
      ...SAMPLE_ITEMS[0],
      id: `n-p1-${idx}`,
      notification_key: `key-${idx}`,
      title: `通知条目 ${idx + 1}`,
      target_url: idx === 0 ? 'https://evil.example/phish' : idx === 1 ? '//evil.example' : '/bills/b-1',
    }))
    const secondPage: UserNotificationItem[] = [
      {
        ...SAMPLE_ITEMS[1],
        id: 'n-p2-0',
        notification_key: 'key-50',
        title: '第二页第 51 条通知',
        target_url: '/bills/b-51',
        read_at: null,
      },
    ]
    mockGetNotifications.mockReset().mockImplementation(async (opts?: { offset?: number }) => {
      if ((opts?.offset ?? 0) === 0) {
        return { items: firstPage, unread_count: 51, total_count: 51 }
      }
      return { items: secondPage, unread_count: 51, total_count: 51 }
    })

    render(<NotificationCenterView />)
    await waitFor(() => {
      expect(screen.getByText('通知条目 1')).toBeTruthy()
      expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy()
    })

    // 点击 unsafe https://evil.example 不渲染「前往查看」
    fireEvent.click(screen.getAllByRole('button', { name: /通知条目 1/ })[0])
    await waitFor(() => {
      expect(screen.getByText('删除通知')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '前往查看' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[1])

    // 点击合法站内路径 /bills/b-1 渲染「前往查看」并跳转
    fireEvent.click(screen.getAllByRole('button', { name: /通知条目 3/ })[0])
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '前往查看' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '前往查看' }))
    expect(mockPush).toHaveBeenCalledWith('/bills/b-1')

    // 点击加载更多发起 offset: 50 请求并渲染第 51 条
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() => {
      expect(mockGetNotifications).toHaveBeenCalledWith({
        filter: 'all',
        limit: 50,
        offset: 50,
        syncToday: false,
      })
      expect(screen.getByText('第二页第 51 条通知')).toBeTruthy()
    })
  })
})
