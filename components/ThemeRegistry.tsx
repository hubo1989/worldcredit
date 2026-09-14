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
          backgroundColor: '#F5F8FF',
          color: '#333333',
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
          backgroundColor: '#F5F8FF',
          color: '#333333',
          padding: '20px 24px',
          borderRadius: 8,
          border: '1px solid rgba(25, 118, 210, 0.35)',
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
