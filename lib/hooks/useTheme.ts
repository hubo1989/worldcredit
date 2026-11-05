'use client'

import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'worldcredit_theme_mode'

/** 根据当前设定与系统偏好推导最终生效的亮暗主题（去嵌套三元） */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  // mode === 'system'
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** 写入 DOM 属性与类名，保证与 Tailwind / globals.css 契约一致 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolved)
  if (resolved === 'light') {
    document.documentElement.classList.add('theme-light')
    document.documentElement.classList.remove('theme-dark')
  } else {
    document.documentElement.classList.add('theme-dark')
    document.documentElement.classList.remove('theme-light')
  }
}

/** 获取初始 ThemeMode（客户端优先读 localStorage） */
export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved
    }
  } catch {
    // ignore
  }
  return 'system'
}

/** 获取初始 ResolvedTheme（优先读取水合前内联脚本已设置的 DOM 状态，彻底告别硬编码 dark） */
export function getInitialResolvedTheme(): ResolvedTheme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
    if (document.documentElement.classList.contains('theme-light')) return 'light'
    if (document.documentElement.classList.contains('theme-dark')) return 'dark'
  }
  return resolveTheme(getStoredThemeMode())
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredThemeMode)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(getInitialResolvedTheme)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const initialTheme = getStoredThemeMode()
    setThemeState(initialTheme)

    const applyTheme = (mode: ThemeMode) => {
      const resolved = resolveTheme(mode)
      setResolvedTheme(resolved)
      applyResolvedTheme(resolved)
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
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme)
    } catch {
      // ignore
    }
    const resolved = resolveTheme(newTheme)
    setResolvedTheme(resolved)
    applyResolvedTheme(resolved)
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
