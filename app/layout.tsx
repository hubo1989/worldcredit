// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ThemeRegistry } from '@/components/ThemeRegistry'
import { AuthProvider } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'WorldCredit - 信用卡管理',
  description: '家庭信用卡账单、还款、权益管理工具',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WorldCredit',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // cover：内容延伸到状态栏/刘海下，深色背景由 body 填满整屏，
  // 否则系统用默认底色画安全区，顶部出现一条异色带。
  viewportFit: 'cover',
  themeColor: '#0a0f1e',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <ThemeRegistry>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  )
}
