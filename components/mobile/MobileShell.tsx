// components/mobile/MobileShell.tsx
'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '@/lib/auth'
import { BottomNav } from './BottomNav'

export function MobileShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) return null

  return (
    <Box sx={{ pb: 7, minHeight: '100vh', bgcolor: 'grey.50' }}>
      {children}
      <BottomNav />
    </Box>
  )
}
