'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Box, CircularProgress } from '@mui/material'

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
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <CircularProgress size={24} sx={{ color: 'var(--navy-600)' }} />
    </Box>
  )
}
