'use client'

import { useEffect, useState } from 'react'
import { BellIcon } from '@/components/icons/WcIcon'
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

  // 顶部居中横幅：窄屏放不下时按钮整行下移，文字保持完整（nowrap + 不收缩）
  if (!show) return null

  return (
    <div className='pointer-events-none fixed inset-x-0 top-2 z-[1400] flex justify-center px-4'>
      <div
        role='status'
        className='pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl border border-d-accent/40 bg-d-surface px-3 py-2 text-d-text shadow-2xl'
      >
        <BellIcon size={18} className='shrink-0 text-d-accent-light' />
        <span className='min-w-0 flex-1 text-[14.5px] leading-[18px]'>开启还款提醒，到期前不再遗忘</span>
        <span className='ml-auto flex shrink-0 flex-nowrap items-center gap-1.5'>
          <button
            type='button'
            onClick={() => setShow(false)}
            className='whitespace-nowrap rounded-full px-2 py-1 text-[14.5px] leading-[18px] font-semibold text-d-muted active:text-d-text'
          >
            稍后
          </button>
          <button
            type='button'
            onClick={handleAllow}
            className='whitespace-nowrap rounded-full bg-d-accent px-2 py-1 text-[14.5px] leading-[18px] font-semibold text-white'
          >
            开启提醒
          </button>
        </span>
      </div>
    </div>
  )
}
