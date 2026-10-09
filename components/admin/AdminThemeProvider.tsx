'use client'

import { ReactNode } from 'react'

// 管理后台外壳：ObsidianUI 暗色作用域（d-* token），
// 与移动端 /admin 之外的表面共用同一套暗色体系，不再走 MUI 主题。
export function AdminThemeProvider({ children }: { children: ReactNode }) {
  return <div className='obsidian-dashboard min-h-dvh bg-d-bg text-d-text'>{children}</div>
}
