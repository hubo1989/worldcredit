// lib/insforge.ts
import { createClient } from '@insforge/sdk'

export const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
})

// 快捷引用：数据库查询用 db.from('table')
export const db = insforge.database
