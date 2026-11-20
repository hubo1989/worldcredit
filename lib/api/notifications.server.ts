// lib/api/notifications.server.ts — 通知中心服务端 RPC 实现（bindUser: 0 会话隔离）。

import { getDb } from '../db/client'
import { ensureDailyNotificationsForUser } from '../notifications-engine.server'
import type { NotificationCategory, UserNotificationItem } from '../types'
import { RpcDomainError } from './errors'

export interface GetNotificationsOptions {
  filter?: 'all' | 'unread'
  category?: NotificationCategory
  limit?: number
  offset?: number
  syncToday?: boolean
}

export interface NotificationsPageResult {
  items: UserNotificationItem[]
  unread_count: number
  total_count: number
}

export interface NotificationReadResult {
  updated: boolean
  unread_count: number
}

export interface NotificationBulkReadResult {
  updated_count: number
  unread_count: number
}

export interface NotificationDeleteResult {
  deleted: boolean
  unread_count: number
}

export interface NotificationBulkDeleteResult {
  deleted_count: number
  unread_count: number
}

async function countUnreadForUser(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM notification_history WHERE user_id = ? AND deleted_at IS NULL AND read_at IS NULL'
    )
    .bind(userId)
    .first<{ cnt: number }>()
  return Number(row?.cnt ?? 0)
}

export async function getNotifications(
  userId: string,
  options: GetNotificationsOptions = {}
): Promise<NotificationsPageResult> {
  const db = getDb()
  if (options?.syncToday !== false) {
    await ensureDailyNotificationsForUser(db, userId)
  }

  const filter = options?.filter === 'unread' ? 'unread' : 'all'
  const category = typeof options?.category === 'string' && options.category ? options.category : null
  const limit = Math.min(200, Math.max(1, Number(options?.limit) || 50))
  const offset = Math.max(0, Number(options?.offset) || 0)

  const whereParts = ['user_id = ?', 'deleted_at IS NULL']
  const params: unknown[] = [userId]

  if (filter === 'unread') {
    whereParts.push('read_at IS NULL')
  }
  if (category) {
    whereParts.push('category = ?')
    params.push(category)
  }

  const whereSql = whereParts.join(' AND ')

  const [itemsRes, unreadCount, totalRow] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_id, notification_key, category, title, body, target_url,
                metadata_json, sent_at, status, error, read_at, deleted_at, push_sent_at
         FROM notification_history
         WHERE ${whereSql}
         ORDER BY sent_at DESC, rowid DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all<UserNotificationItem>(),
    countUnreadForUser(db, userId),
    db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM notification_history WHERE user_id = ? AND deleted_at IS NULL'
      )
      .bind(userId)
      .first<{ cnt: number }>(),
  ])

  return {
    items: itemsRes.results || [],
    unread_count: unreadCount,
    total_count: Number(totalRow?.cnt ?? 0),
  }
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const db = getDb()
  await ensureDailyNotificationsForUser(db, userId)
  return countUnreadForUser(db, userId)
}

export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<NotificationReadResult> {
  if (typeof notificationId !== 'string' || !notificationId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的通知 ID')
  }
  const db = getDb()
  const nowIso = new Date().toISOString()
  const res = await db
    .prepare(
      `UPDATE notification_history
       SET read_at = COALESCE(read_at, ?)
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .bind(nowIso, notificationId.trim(), userId)
    .run()

  const unread_count = await countUnreadForUser(db, userId)
  return {
    updated: Number(res.meta?.changes ?? 0) > 0,
    unread_count,
  }
}

export async function markAllNotificationsRead(userId: string): Promise<NotificationBulkReadResult> {
  const db = getDb()
  const nowIso = new Date().toISOString()
  const res = await db
    .prepare(
      `UPDATE notification_history
       SET read_at = COALESCE(read_at, ?)
       WHERE user_id = ? AND deleted_at IS NULL AND read_at IS NULL`
    )
    .bind(nowIso, userId)
    .run()

  const unread_count = await countUnreadForUser(db, userId)
  return {
    updated_count: Number(res.meta?.changes ?? 0),
    unread_count,
  }
}

export async function deleteNotification(
  userId: string,
  notificationId: string
): Promise<NotificationDeleteResult> {
  if (typeof notificationId !== 'string' || !notificationId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的通知 ID')
  }
  const db = getDb()
  const nowIso = new Date().toISOString()
  const res = await db
    .prepare(
      `UPDATE notification_history
       SET deleted_at = COALESCE(deleted_at, ?)
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .bind(nowIso, notificationId.trim(), userId)
    .run()

  const unread_count = await countUnreadForUser(db, userId)
  return {
    deleted: Number(res.meta?.changes ?? 0) > 0,
    unread_count,
  }
}

export async function deleteAllNotifications(userId: string): Promise<NotificationBulkDeleteResult> {
  const db = getDb()
  const nowIso = new Date().toISOString()
  const res = await db
    .prepare(
      `UPDATE notification_history
       SET deleted_at = COALESCE(deleted_at, ?)
       WHERE user_id = ? AND deleted_at IS NULL`
    )
    .bind(nowIso, userId)
    .run()

  const unread_count = await countUnreadForUser(db, userId)
  return {
    deleted_count: Number(res.meta?.changes ?? 0),
    unread_count,
  }
}
