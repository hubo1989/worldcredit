'use client'

import { useState, useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem,
  Divider, useTheme
} from '@mui/material'
import {
  Dashboard as DashboardIcon,
  CreditCard as CardIcon,
  LocalOffer as PromoIcon,
  CardGiftcard as BenefitIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  AccountBalance as BankIcon
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'

const DRAWER_WIDTH = 260

const NAV_ITEMS = [
  { label: '仪表盘', icon: <DashboardIcon />, path: '/admin' },
  { label: '银行管理', icon: <BankIcon />, path: '/admin/banks' },
  { label: '卡产品管理', icon: <CardIcon />, path: '/admin/card-products' },
  { label: '优惠活动', icon: <PromoIcon />, path: '/admin/promos' },
  { label: '权益管理', icon: <BenefitIcon />, path: '/admin/benefits' },
  { label: '系统设置', icon: <SettingsIcon />, path: '/admin/settings' },
]

// 管理员邮箱白名单（与 scripts/create-admin.ts 保持一致）
const ADMIN_EMAILS = ['admin@worldcredit.com']

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(true)

  // 权限校验：未登录或非管理员重定向到 /dashboard
  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!ADMIN_EMAILS.includes(user.email)) {
      router.replace('/dashboard')
    }
  }, [user, loading, router])

  const handleLogout = async () => {
    setAnchorEl(null)
    await signOut()
    window.location.href = '/login'
  }

  const handleNavigate = (path: string) => {
    router.push(path)
  }

  // 加载中或无权限时不渲染管理后台内容
  if (loading || !user || !ADMIN_EMAILS.includes(user.email)) {
    return null
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#0f1117' }}>
      {/* 侧边栏 */}
      <Drawer
        variant="persistent"
        open={drawerOpen}
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          transition: 'width 0.3s ease',
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            bgcolor: '#13151d',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            color: '#c4c7d0',
            boxSizing: 'border-box',
          },
        }}
      >
        {/* Logo 区域 */}
        <Box sx={{
          px: 2.5, py: 2.5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: 2,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 16, color: '#fff',
            }}>
              W
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#e4e6eb', lineHeight: 1.2 }}>
                WorldCredit
              </Typography>
              <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 11 }}>
                管理控制台
              </Typography>
            </Box>
          </Box>
          <IconButton size="small" onClick={() => setDrawerOpen(false)} sx={{ color: '#6b7280' }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mx: 1.5 }} />

        {/* 导航菜单 */}
        <List sx={{ px: 1.5, mt: 1 }}>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.label}
              selected={pathname === item.path}
              onClick={() => handleNavigate(item.path)}
              sx={{
                borderRadius: 2, mb: 0.5, py: 1,
                '&.Mui-selected': {
                  bgcolor: 'rgba(99, 102, 241, 0.15)',
                  color: '#818cf8',
                  '& .MuiListItemIcon-root': { color: '#818cf8' },
                },
                '&:hover': {
                  bgcolor: 'rgba(255,255,255,0.05)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: '#6b7280' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
              />
            </ListItemButton>
          ))}
        </List>

        {/* 底部用户信息 */}
        <Box sx={{ mt: 'auto', p: 2 }}>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 2 }} />
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1.5,
            px: 1, py: 1, borderRadius: 2,
            '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
            cursor: 'pointer',
          }}
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            <Avatar sx={{
              width: 32, height: 32, fontSize: 14,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            }}>
              {user?.email?.[0]?.toUpperCase() || 'A'}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ color: '#e4e6eb', fontSize: 13, fontWeight: 500 }} noWrap>
                {user?.email || '管理员'}
              </Typography>
              <Typography variant="caption" sx={{ color: '#6b7280', fontSize: 11 }}>
                系统管理员
              </Typography>
            </Box>
          </Box>
        </Box>
      </Drawer>

      {/* 主内容区 */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        transition: 'margin-left 0.3s ease',
      }}>
        {/* 顶栏 */}
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: '#0f1117',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Toolbar sx={{ minHeight: '56px !important' }}>
            {!drawerOpen && (
              <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: '#9ca3af', mr: 2 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#e4e6eb', fontSize: 17 }}>
              仪表盘
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ color: '#6b7280' }}>
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </Typography>
          </Toolbar>
        </AppBar>

        {/* 页面内容 */}
        <Box sx={{
          flex: 1, p: 3,
          overflowY: 'auto',
          bgcolor: '#0f1117',
        }}>
          {children}
        </Box>
      </Box>

      {/* 退出菜单 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        PaperProps={{
          sx: {
            bgcolor: '#1e2028',
            color: '#c4c7d0',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }
        }}
      >
        <MenuItem onClick={handleLogout} sx={{ gap: 1.5, fontSize: 14 }}>
          <LogoutIcon fontSize="small" /> 退出登录
        </MenuItem>
      </Menu>
    </Box>
  )
}
