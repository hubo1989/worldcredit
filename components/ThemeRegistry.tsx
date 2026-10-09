'use client'

// 字体注册：真实加载中文网页字体（按 unicode-range 子集按需下载，未覆盖的
// 汉字由系统 CJK 字体兜底）；标题/数字用 Inter Tight（Latin + tabular 数字）。
// 主题职责已由 globals.css 的 ObsidianUI d-* token 接管，不再挂 MUI Provider。
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/inter-tight'
import { ReactNode } from 'react'

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return children
}
