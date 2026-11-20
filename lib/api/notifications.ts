// lib/api/notifications.ts — client-side RPC wrappers (server: notifications.server.ts).
import type * as Server from './notifications.server'
import { callRpc } from './rpc-client'

export type {
  GetNotificationsOptions,
  NotificationsPageResult,
  NotificationReadResult,
  NotificationBulkReadResult,
  NotificationDeleteResult,
  NotificationBulkDeleteResult,
} from './notifications.server'

export function getNotifications(options?: Server.GetNotificationsOptions) {
  return callRpc<typeof Server.getNotifications>('notifications', 'getNotifications', '', options)
}

export function getUnreadNotificationCount(syncToday?: boolean) {
  return syncToday === undefined
    ? callRpc<typeof Server.getUnreadNotificationCount>(
        'notifications',
        'getUnreadNotificationCount',
        ''
      )
    : callRpc<typeof Server.getUnreadNotificationCount>(
        'notifications',
        'getUnreadNotificationCount',
        '',
        syncToday
      )
}

export function markNotificationRead(notificationId: string) {
  return callRpc<typeof Server.markNotificationRead>(
    'notifications',
    'markNotificationRead',
    '',
    notificationId
  )
}

export function markAllNotificationsRead() {
  return callRpc<typeof Server.markAllNotificationsRead>(
    'notifications',
    'markAllNotificationsRead',
    ''
  )
}

export function deleteNotification(notificationId: string) {
  return callRpc<typeof Server.deleteNotification>(
    'notifications',
    'deleteNotification',
    '',
    notificationId
  )
}

export function deleteAllNotifications() {
  return callRpc<typeof Server.deleteAllNotifications>(
    'notifications',
    'deleteAllNotifications',
    ''
  )
}
