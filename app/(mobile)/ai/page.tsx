'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * AI 助手页已下线：LLM 能力重新定位为表单内嵌的 AI 智能填充（§2.3）。
 * 访问该路由自动重定向回首页。
 */
export default function AiRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard')
  }, [router])

  return (
    <div className='flex min-h-[60vh] items-center justify-center'>
      <span
        role='status'
        aria-label='正在跳转'
        className='h-6 w-6 animate-spin rounded-full border-2 border-d-border border-t-d-accent'
      />
    </div>
  )
}
