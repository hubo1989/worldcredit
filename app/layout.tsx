// app/layout.tsx
import type { Metadata } from 'next'
import { ThemeRegistry } from '@/components/ThemeRegistry'
import { AuthProvider } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'WorldCredit - 信用卡管理',
  description: '家庭信用卡账单、还款、权益管理工具',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
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
