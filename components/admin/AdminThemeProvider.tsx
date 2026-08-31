'use client'

import { ThemeProvider } from '@mui/material'
import { ReactNode } from 'react'
import { adminDarkTheme } from '@/lib/theme'

// 管理后台专用暗色主题，与全局亮色主题（ThemeRegistry）隔离。
// 仅在 app/admin 布局内生效，页面代码应改用主题 token 而非硬编码色值。
export function AdminThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={adminDarkTheme}>{children}</ThemeProvider>
}
