// WorldCredit Service Worker
// Handles Web Push notifications and basic PWA caching
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)
// Drop old precache revisions so a new deploy never serves stale assets.
cleanupOutdatedCaches()

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ── Push event ──────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'WorldCredit 提醒', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'WorldCredit 还款提醒'
  const options = {
    body: data.body || '您有即将到期的账单，请及时还款。',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: data.tag || 'worldcredit-reminder',
    renotify: true,
    data: { url: data.url || '/bills' },
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Notification click ────────────────────────────────────────────────────
// 权益推送（tag 前缀 wc-op:）只允许跳转到站内白名单路径，之后由应用自身
// 鉴权；不向任意入参 URL 导航。
const OPPORTUNITY_ALLOWED_URLS = new Set(['/promos', '/benefits', '/benefits/calendar'])

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  let targetUrl = (event.notification.data && event.notification.data.url) || '/bills'
  const tag = (event.notification.data && event.notification.data.tag) || event.notification.tag || ''
  if (tag.startsWith('wc-op:')) {
    if (!OPPORTUNITY_ALLOWED_URLS.has(targetUrl)) targetUrl = '/benefits'
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
