import type { Metadata, Viewport } from 'next'
import { ThemeRegistry } from '@/components/ThemeRegistry'
import { AuthProvider } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'WorldCredit - 信用卡管理',
  description: '高效、简洁的家庭信用卡账单管理工具',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WorldCredit',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head />
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
