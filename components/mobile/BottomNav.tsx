'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import { HomeIcon, BillsIcon, MineIcon } from '@/components/icons/WcIcon'

const navItems = [
  // §2.1: 3 tab（首页 / 账单 / 我的）；图标统一来自 WcIcon 线性 SVG 库
  { label: '首页', icon: <HomeIcon />, path: '/dashboard' },
  { label: '账单', icon: <BillsIcon />, path: '/bills' },
  { label: '我的', icon: <MineIcon />, path: '/settings' },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  // 计算当前选中的索引（匹配 3 个新 tab 的路径）
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
        // §7.3 / §7.4：白色背景 + 顶部 1px 边框 + 向上阴影
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -2px 8px rgba(10, 31, 68, 0.06)',
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
        // 触控目标 ≥44pt：高度 56px
        sx={{ height: 56, backgroundColor: 'transparent' }}
      >
        {navItems.map((item, idx) => {
          const selected = idx === (currentIndex === -1 ? 0 : currentIndex)
          return (
            <BottomNavigationAction
              key={item.path}
              label={item.label}
              icon={item.icon}
              sx={{
                // 非选中态灰色 / 选中态深蓝（§7.3）
                color: selected ? 'var(--navy-600)' : '#5B6478',
                fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
                padding: 0,
                maxWidth: 'none',
                transition: 'color 150ms ease',
                position: 'relative',
                '& .MuiBottomNavigationAction-label': {
                  fontSize: '12px',
                  fontWeight: selected ? 600 : 400,
                  transition: 'font-weight 150ms ease',
                },
                // 选中态顶部金色短线（§7.3）
                '&::before': selected
                  ? {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 24,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: 'var(--gold-500)',
                    }
                  : {},
                '&.Mui-selected': {
                  color: 'var(--navy-600)',
                  '& .MuiBottomNavigationAction-label': {
                    fontSize: '12px',
                    fontWeight: 600,
                  },
                },
              }}
            />
          )
        })}
      </BottomNavigation>
    </Paper>
  )
}
