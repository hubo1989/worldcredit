'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../auth'
import {
  getUserPreferences,
  updateUserPreferences,
  DEFAULT_DISPLAY_CONFIG,
  DEFAULT_REMINDER_CONFIG
} from '../api/preferences'
import type { UserDisplayConfig, UserReminderConfig } from '../types'
import { resolveEffectiveChannels } from '@/components/settings/shared'

const PREF_CACHE_KEY = 'worldcredit_user_prefs_cache'

function showToastMessage(message: string) {
  if (typeof document === 'undefined') return
  const id = 'wc-pref-toast-container'
  let container = document.getElementById(id)
  if (!container) {
    container = document.createElement('div')
    container.id = id
    container.className =
      'pointer-events-none fixed inset-x-0 bottom-24 z-[1400] flex justify-center px-4 transition-opacity'
    document.body.appendChild(container)
  }
  const toastEl = document.createElement('div')
  toastEl.setAttribute('role', 'status')
  toastEl.className =
    'pointer-events-auto max-w-sm rounded-xl border border-d-danger-ink/40 bg-d-danger-soft px-4 py-3 text-[13px] font-semibold leading-5 text-d-danger-ink shadow-lg'
  toastEl.textContent = message
  container.innerHTML = ''
  container.appendChild(toastEl)
  setTimeout(() => {
    if (container && container.contains(toastEl)) {
      container.removeChild(toastEl)
    }
  }, 3500)
}

export function useUserPreferences() {
  const { user } = useAuth()
  const [displayConfig, setDisplayConfig] = useState<UserDisplayConfig>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(PREF_CACHE_KEY)
      if (cached) {
        try {
          return JSON.parse(cached).display_config || DEFAULT_DISPLAY_CONFIG
        } catch {
          // ignore malformed cache, fall back to defaults
        }
      }
    }
    return DEFAULT_DISPLAY_CONFIG
  })

  const [reminderConfig, setReminderConfig] = useState<UserReminderConfig>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(PREF_CACHE_KEY)
      if (cached) {
        try {
          const parsed = JSON.parse(cached).reminder_config
          if (parsed) {
            if (parsed.enabled_channels === undefined) {
              return { ...parsed, enabled_channels: resolveEffectiveChannels(parsed) }
            }
            return parsed
          }
        } catch {
          // ignore malformed cache, fall back to defaults
        }
      }
    }
    return DEFAULT_REMINDER_CONFIG
  })

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadPreferences = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setLoadError(null)
    try {
      const prefs = await getUserPreferences(user.id)
      let reminder = prefs.reminder_config

      // 存量迁移：读取偏好时若 enabled_channels 未设置而旧 opportunities.web_push_enabled === false，
      // 则迁移为不含 web_push 的 enabled_channels，并写回一次；绝不让显式关闭过的用户被重新开启。
      if (reminder.enabled_channels === undefined && reminder.opportunities?.web_push_enabled === false) {
        reminder = { ...reminder, enabled_channels: [] }
        try {
          await updateUserPreferences(user.id, { reminder_config: reminder })
        } catch (e) {
          console.warn('Failed to write back migrated reminder preferences:', e)
        }
      }

      setDisplayConfig(prefs.display_config)
      setReminderConfig(reminder)
      if (typeof window !== 'undefined') {
        localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...prefs, reminder_config: reminder }))
      }
    } catch (err) {
      console.error('Failed to load user preferences:', err)
      setLoadError(err instanceof Error ? err.message : '加载偏好设置失败')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  const updateDisplay = async (updates: Partial<UserDisplayConfig>) => {
    const prev = displayConfig
    const nextDisplay = { ...displayConfig, ...updates }
    setDisplayConfig(nextDisplay)

    // Update local cache immediately for snappy UI
    if (typeof window !== 'undefined') {
      const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
      localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, display_config: nextDisplay }))
    }

    if (user?.id) {
      try {
        await updateUserPreferences(user.id, { display_config: nextDisplay })
      } catch (err) {
        // Rollback on write failure
        setDisplayConfig(prev)
        if (typeof window !== 'undefined') {
          const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
          localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, display_config: prev }))
        }
        throw err
      }
    }
  }

  const updateReminder = async (updates: Partial<UserReminderConfig>) => {
    const prev = reminderConfig
    const nextReminder = { ...reminderConfig, ...updates }
    setReminderConfig(nextReminder)

    if (typeof window !== 'undefined') {
      const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
      localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, reminder_config: nextReminder }))
    }

    if (user?.id) {
      try {
        await updateUserPreferences(user.id, { reminder_config: nextReminder })
      } catch (err) {
        // Rollback on write failure
        setReminderConfig(prev)
        if (typeof window !== 'undefined') {
          const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
          localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, reminder_config: prev }))
        }
        throw err
      }
    }
  }

  const togglePrivacyMode = async () => {
    try {
      await updateDisplay({ privacy_mode: !displayConfig.privacy_mode })
    } catch (err) {
      console.error('Failed to toggle privacy mode:', err)
      showToastMessage(err instanceof Error ? err.message : '切换隐私模式失败，已自动回滚')
    }
  }

  return {
    displayConfig,
    reminderConfig,
    loading,
    loadError,
    updateDisplay,
    updateReminder,
    togglePrivacyMode,
    refreshPreferences: loadPreferences,
  }
}
