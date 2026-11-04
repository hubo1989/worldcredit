'use client'

import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'worldcredit_theme_mode'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
    const initialTheme: ThemeMode = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
    setThemeState(initialTheme)

    const applyTheme = (mode: ThemeMode) => {
      const resolved: 'light' | 'dark' =
        mode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : mode
      setResolvedTheme(resolved)
      document.documentElement.setAttribute('data-theme', resolved)
      if (resolved === 'light') {
        document.documentElement.classList.add('theme-light')
        document.documentElement.classList.remove('theme-dark')
      } else {
        document.documentElement.classList.add('theme-dark')
        document.documentElement.classList.remove('theme-light')
      }
    }

    applyTheme(initialTheme)

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const current = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
      if (!current || current === 'system') {
        applyTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme)
    if (typeof window === 'undefined') return
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)

    const resolved: 'light' | 'dark' =
      newTheme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : newTheme
    setResolvedTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
    if (resolved === 'light') {
      document.documentElement.classList.add('theme-light')
      document.documentElement.classList.remove('theme-dark')
    } else {
      document.documentElement.classList.add('theme-dark')
      document.documentElement.classList.remove('theme-light')
    }
  }, [])

  const cycleTheme = useCallback(() => {
    if (theme === 'dark') setTheme('light')
    else if (theme === 'light') setTheme('system')
    else setTheme('dark')
  }, [theme, setTheme])

  return {
    theme,
    resolvedTheme,
    setTheme,
    cycleTheme,
  }
}
