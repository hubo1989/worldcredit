'use client'

// 真实加载中文网页字体：按 unicode-range 子集按需下载，未覆盖的汉字由系统 CJK 字体兜底
import '@fontsource-variable/noto-sans-sc'
// Phone 版本的标题/数字用 Inter Tight（Latin + tabular 数字），CJK 仍由栈内系统字体接管
import '@fontsource-variable/inter-tight'
import { ThemeProvider, CssBaseline, GlobalStyles } from '@mui/material'
import { ReactNode } from 'react'
import { lightTheme } from '@/lib/theme'

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <GlobalStyles styles={{
        body: {
          backgroundColor: 'var(--bg)',
          // 正文颜色统一继承 .phone 使用的 CSS token，避免主题间正文色漂移。
          color: 'var(--text-primary)',
          fontFamily: lightTheme.typography.fontFamily,
        },
        h1: { color: '#030059', fontWeight: 600 },
        h2: { color: '#030059', fontWeight: 600 },
        h3: { color: '#030059', fontWeight: 600 },
        '.privacy-blur': {
          filter: 'blur(7px)',
          transition: 'filter 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          userSelect: 'none',
          pointerEvents: 'none',
        },
        '.privacy-clear': {
          filter: 'blur(0px)',
          transition: 'filter 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        '.info-box': {
          backgroundColor: 'color-mix(in srgb, var(--info) 10%, var(--paper))',
          color: 'var(--info-ink)',
          padding: 'var(--sp-5) var(--sp-6)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid color-mix(in srgb, var(--info) 35%, transparent)',
        },
        // 尊重系统减弱动态偏好：状态变化仍即时呈现，仅移除过渡动画
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            transitionDuration: '0.01ms !important',
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            scrollBehavior: 'auto !important',
          },
        },
      }} />
      {children}
    </ThemeProvider>
  )
}
