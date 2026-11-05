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
    statusBarStyle: 'black-translucent',
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

const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem('worldcredit_theme_mode');var r=(m==='light'||m==='dark')?m:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',r);if(r==='light'){document.documentElement.classList.add('theme-light');document.documentElement.classList.remove('theme-dark');}else{document.documentElement.classList.add('theme-dark');document.documentElement.classList.remove('theme-light');}}catch(e){}})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
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
