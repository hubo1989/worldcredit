'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Receipt as ReceiptIcon,
  LocalOffer as PromoIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'

const navItems = [
  { label: '首页', icon: <DashboardIcon />, path: '/dashboard' },
  { label: '持卡人', icon: <PeopleIcon />, path: '/holders' },
  { label: '账单', icon: <ReceiptIcon />, path: '/bills' },
  { label: '优惠', icon: <PromoIcon />, path: '/promos' },
  { label: '设置', icon: <SettingsIcon />, path: '/settings' },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  // 计算当前选中的索引
  const currentIndex = navItems.findIndex(item =>
    pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
  )

  return (
    <Paper
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
      elevation={0}
    >
      <BottomNavigation
        value={currentIndex === -1 ? 0 : currentIndex}
        onChange={(_, newValue) => {
          router.push(navItems[newValue].path)
        }}
        showLabels
        sx={{ height: 64 }}
      >
        {navItems.map(item => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            icon={item.icon}
            sx={{
              '&.Mui-selected': {
                color: 'primary.main',
              },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
