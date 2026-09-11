'use client'

import { useEffect, useState } from 'react'
import { Snackbar, Alert, Button } from '@mui/material'
import BellIcon from '@mui/icons-material/NotificationsActive'
import { subscribePush } from '@/lib/api/push'
import { useAuth } from '@/lib/auth'

/** Fetch the VAPID public key at runtime so production works without a rebuild. */
async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/public-key')
    if (!res.ok) return null
    const data = (await res.json()) as { publicKey?: string }
    return data.publicKey || null
  } catch {
    return null
  }
}

/** Convert base64url string to Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const arr = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
  return arr.buffer
}

/**
 * Saves a PushSubscription through the dedicated RPC API (upsert on endpoint).
 */
async function savePushSubscription(
  sub: globalThis.PushSubscription
): Promise<void> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('推送订阅缺少必要的密钥')
  }
  await subscribePush({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
}

/**
 * PushPermission:
 * - Shown once per session when Push is supported and configured but not yet granted.
 * - Requests permission → subscribes → saves via RPC.
 */
export function PushPermission() {
  const { user } = useAuth()
  const [show, setShow] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    let cancelled = false
    fetchVapidPublicKey().then(publicKey => {
      if (cancelled || !publicKey) return

      setSupported(true)

      // Already granted → subscribe silently
      if (Notification.permission === 'granted') {
        subscribeSilently(publicKey)
        return
      }

      // Dismissed or denied → don't prompt again this session
      if (Notification.permission === 'denied') return

      // default → show banner after short delay
      const timer = setTimeout(() => setShow(true), 3000)
      return () => clearTimeout(timer)
    })
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const subscribeSilently = async (publicKey: string) => {
    if (!user || subscribed) return
    try {
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
      await savePushSubscription(sub)
      setSubscribed(true)
    } catch (err) {
      console.warn('[PushPermission] silent subscribe failed', err)
    }
  }

  const handleAllow = async () => {
    setShow(false)
    if (!user) return
    try {
      const publicKey = await fetchVapidPublicKey()
      if (!publicKey) return
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await savePushSubscription(sub)
      setSubscribed(true)
    } catch (err) {
      console.warn('[PushPermission] subscribe failed', err)
    }
  }

  if (!supported || subscribed) return null

  return (
    <Snackbar
      open={show}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{ top: { xs: 8, sm: 8 } }}
    >
      <Alert
        icon={<BellIcon fontSize="inherit" />}
        severity="info"
        sx={{ width: '100%', alignItems: 'center' }}
        action={
          <>
            <Button color="inherit" size="small" onClick={() => setShow(false)}>
              稍后
            </Button>
            <Button
              color="primary"
              size="small"
              variant="contained"
              onClick={handleAllow}
              sx={{ ml: 1 }}
            >
              开启提醒
            </Button>
          </>
        }
      >
        开启还款提醒，到期前不再遗忘
      </Alert>
    </Snackbar>
  )
}
