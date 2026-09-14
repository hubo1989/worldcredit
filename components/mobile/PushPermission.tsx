'use client'

import { useEffect, useState } from 'react'
import { Snackbar, Alert, Button } from '@mui/material'
import BellIcon from '@mui/icons-material/NotificationsActive'
import { subscribePush } from '@/lib/api/push'
import { useAuth } from '@/lib/auth'

// 按钮是可点目标：文案必须整体可见（nowrap），且不参与被压缩（flexShrink: 0）。
// 徽标文字同理，避免「开启提醒」被折成「开启/提醒」。
const ALERT_ACTION_BTN = {
  whiteSpace: 'nowrap' as const,
  flexShrink: 0,
  minWidth: 'auto',
  // 收紧横向内边距：按钮合计从 ~154px 降到 ~137px，留给 message 的宽度
  // 足以让「开启还款提醒，到期前不再遗忘」保持单行。高度仍为 40px 触控目标。
  px: 1.25,
  borderRadius: 'var(--radius-pill)',
  fontSize: 'var(--type-body-size)',
  lineHeight: 'var(--type-body-line)',
  letterSpacing: 'var(--type-body-tracking)',
}

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
        sx={{
          width: '100%',
          alignItems: 'center',
          // 390px 下 message + 两个按钮无法并排：允许换行，空间不足时按钮整行下移，
          // 而不是把 message 压成 3 行、按钮文字拦腰折断。
          flexWrap: 'wrap',
          py: 0.75,
          '& .MuiAlert-message': {
            minWidth: 0,
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-line)',
            letterSpacing: 'var(--type-body-tracking)',
          },
          '& .MuiAlert-action': {
            // 保证按钮文字完整：既不换行也不被压缩
            flexShrink: 0,
            flexWrap: 'nowrap',
            alignItems: 'center',
            gap: 0.75,
            mr: 0,
            pt: 0,
            pb: 0,
            // 换行到下一行时贴右；与 message 同行时保持原间距
            ml: 'auto',
          },
        }}
        action={
          <>
            <Button color="inherit" size="small" onClick={() => setShow(false)} sx={ALERT_ACTION_BTN}>
              稍后
            </Button>
            <Button
              color="primary"
              size="small"
              variant="contained"
              onClick={handleAllow}
              sx={ALERT_ACTION_BTN}
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
