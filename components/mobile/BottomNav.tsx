'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import PeopleIcon from '@mui/icons-material/People'
import ReceiptIcon from '@mui/icons-material/Receipt'
import AiIcon from '@mui/icons-material/AutoAwesome'
import SettingsIcon from '@mui/icons-material/Settings'

const navItems = [
  { label: '首页', icon: <DashboardIcon />, path: '/dashboard' },
  { label: '持卡人', icon: <PeopleIcon />, path: '/holders' },
  { label: '账单', icon: <ReceiptIcon />, path: '/bills' },
  { label: '✨助手', icon: <AiIcon />, path: '/ai' },
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
        borderTop: '1px solid #DDDDDD',
        boxShadow: '0px -2px 8px rgba(0, 0, 0, 0.06)',
        backgroundColor: '#FFFFFF',
      }}
      elevation={0}
    >
      <BottomNavigation
        value={currentIndex === -1 ? 0 : currentIndex}
        onChange={(_, newValue) => {
          router.push(navItems[newValue].path)
        }}
        showLabels
        sx={{ height: 60, backgroundColor: 'transparent' }}
      >
        {navItems.map(item => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            icon={item.icon}
            sx={{
              color: '#636363',
              fontFamily: '"Open Sans", sans-serif',
              '& .MuiBottomNavigationAction-label': {
                fontSize: '12px',
                fontWeight: 400,
              },
              '&.Mui-selected': {
                color: '#030059',
                '& .MuiBottomNavigationAction-label': {
                  fontSize: '12px',
                  fontWeight: 700,
                },
              },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
