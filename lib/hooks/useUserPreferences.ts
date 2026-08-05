'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../auth'
import {
  getUserPreferences,
  updateUserPreferences,
  DEFAULT_DISPLAY_CONFIG,
  DEFAULT_REMINDER_CONFIG
} from '../api/preferences'
import type { UserDisplayConfig, UserReminderConfig, UserPreferences } from '../types'

const PREF_CACHE_KEY = 'worldcredit_user_prefs_cache'

export function useUserPreferences() {
  const { user } = useAuth()
  const [displayConfig, setDisplayConfig] = useState<UserDisplayConfig>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(PREF_CACHE_KEY)
      if (cached) {
        try {
          return JSON.parse(cached).display_config || DEFAULT_DISPLAY_CONFIG
        } catch {}
      }
    }
    return DEFAULT_DISPLAY_CONFIG
  })

  const [reminderConfig, setReminderConfig] = useState<UserReminderConfig>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(PREF_CACHE_KEY)
      if (cached) {
        try {
          return JSON.parse(cached).reminder_config || DEFAULT_REMINDER_CONFIG
        } catch {}
      }
    }
    return DEFAULT_REMINDER_CONFIG
  })

  const [loading, setLoading] = useState(false)

  const loadPreferences = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const prefs = await getUserPreferences(user.id)
      setDisplayConfig(prefs.display_config)
      setReminderConfig(prefs.reminder_config)
      if (typeof window !== 'undefined') {
        localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(prefs))
      }
    } catch (err) {
      console.error('Failed to load user preferences:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  const updateDisplay = async (updates: Partial<UserDisplayConfig>) => {
    const nextDisplay = { ...displayConfig, ...updates }
    setDisplayConfig(nextDisplay)
    
    // Update local cache immediately for snappy UI
    if (typeof window !== 'undefined') {
      const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
      localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, display_config: nextDisplay }))
    }

    if (user?.id) {
      await updateUserPreferences(user.id, { display_config: nextDisplay })
    }
  }

  const updateReminder = async (updates: Partial<UserReminderConfig>) => {
    const nextReminder = { ...reminderConfig, ...updates }
    setReminderConfig(nextReminder)

    if (typeof window !== 'undefined') {
      const currentCache = JSON.parse(localStorage.getItem(PREF_CACHE_KEY) || '{}')
      localStorage.setItem(PREF_CACHE_KEY, JSON.stringify({ ...currentCache, reminder_config: nextReminder }))
    }

    if (user?.id) {
      await updateUserPreferences(user.id, { reminder_config: nextReminder })
    }
  }

  const togglePrivacyMode = () => {
    updateDisplay({ privacy_mode: !displayConfig.privacy_mode })
  }

  return {
    displayConfig,
    reminderConfig,
    loading,
    updateDisplay,
    updateReminder,
    togglePrivacyMode,
    refreshPreferences: loadPreferences
  }
}
