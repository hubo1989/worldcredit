// components/mobile/BottomNav.tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Receipt as ReceiptIcon,
  LocalOffer as PromoIcon,
} from '@mui/icons-material'

const navItems = [
  { label: '首页', icon: <DashboardIcon />, path: '/' },
  { label: '持卡人', icon: <PeopleIcon />, path: '/holders' },
  { label: '账单', icon: <ReceiptIcon />, path: '/bills' },
  { label: '优惠', icon: <PromoIcon />, path: '/promos' },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const currentIndex = navItems.findIndex(item =>
    pathname === item.path || pathname.startsWith(item.path + '/')
  )

  return (
    <Paper
      sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000 }}
      elevation={3}
    >
      <BottomNavigation
        value={currentIndex === -1 ? 0 : currentIndex}
        onChange={(_, newValue) => router.push(navItems[newValue].path)}
        showLabels
      >
        {navItems.map(item => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
