'use client'

import { useState, useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem,
  Divider, Button
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
  AccountBalance as BankIcon,
  PhoneIphone as PhoneIphoneIcon
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
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* 侧边栏 */}
      <Drawer
        variant="persistent"
        open={drawerOpen}
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            bgcolor: '#030059',
            borderRight: '1px solid #02003d',
            color: '#FFFFFF',
            boxSizing: 'border-box',
            transform: drawerOpen ? 'none' : `translateX(-${DRAWER_WIDTH}px)`,
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
              width: 36, height: 36, borderRadius: '5px',
              backgroundColor: '#A2C6FF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 16, color: '#030059',
            }}>
              W
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2 }}>
                WorldCredit
              </Typography>
              <Typography variant="caption" sx={{ color: '#A2C6FF', fontSize: 11 }}>
                管理控制台
              </Typography>
            </Box>
          </Box>
          <IconButton aria-label="收起侧边栏" size="small" onClick={() => setDrawerOpen(false)} sx={{ color: '#A2C6FF' }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)', mx: 1.5 }} />

        {/* 导航菜单 */}
        <List sx={{ px: 1.5, mt: 1 }}>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.label}
              selected={pathname === item.path}
              onClick={() => handleNavigate(item.path)}
              sx={{
                borderRadius: '3px', mb: 0.5, py: 1,
                color: 'rgba(255, 255, 255, 0.85)',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontWeight: 700,
                  '& .MuiListItemIcon-root': { color: 'inherit' },
                },
                '&:hover': {
                  bgcolor: 'rgba(255,255,255,0.1)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'rgba(255, 255, 255, 0.7)' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontSize: 14 }}
              />
            </ListItemButton>
          ))}
        </List>

        {/* 底部用户信息 */}
        <Box sx={{ mt: 'auto', p: 2 }}>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)', mb: 2 }} />
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1.5,
            px: 1, py: 1, borderRadius: '5px',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
            cursor: 'pointer',
          }}
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            <Avatar sx={{
              width: 32, height: 32, fontSize: 14,
              backgroundColor: '#A2C6FF', color: '#030059', fontWeight: 700
            }}>
              {user?.email?.[0]?.toUpperCase() || 'A'}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ color: '#FFFFFF', fontSize: 13, fontWeight: 500 }} noWrap>
                {user?.email || '管理员'}
              </Typography>
              <Typography variant="caption" sx={{ color: '#A2C6FF', fontSize: 11 }}>
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
      }}>
        {/* 顶栏 */}
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ minHeight: '40px !important' }}>
            {!drawerOpen && (
              <IconButton aria-label="展开侧边栏" onClick={() => setDrawerOpen(true)} sx={{ color: 'text.primary', mr: 2 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h3" sx={{ fontWeight: 600, color: 'text.primary', fontSize: 16 }}>
              控制台
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant="outlined"
              startIcon={<PhoneIphoneIcon fontSize="small" />}
              onClick={() => router.push('/dashboard')}
              sx={{
                color: 'primary.main',
                borderColor: 'primary.main',
                mr: 2,
                fontSize: 12,
                borderRadius: '3px',
                '&:hover': {
                  bgcolor: 'action.hover',
                  borderColor: 'primary.light'
                }
              }}
            >
              返回前台 App
            </Button>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </Typography>
          </Toolbar>
        </AppBar>

        {/* 页面内容 */}
        <Box sx={{
          flex: 1, p: 3,
          overflowY: 'auto',
          bgcolor: 'background.default',
        }}>
          {children}
        </Box>
      </Box>

      {/* 退出菜单 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem onClick={() => { setAnchorEl(null); router.push('/dashboard'); }} sx={{ gap: 1.5, fontSize: 14 }}>
          <PhoneIphoneIcon fontSize="small" /> 返回前台 App
        </MenuItem>
        <MenuItem onClick={handleLogout} sx={{ gap: 1.5, fontSize: 14, color: 'error.main' }}>
          <LogoutIcon fontSize="small" /> 退出登录
        </MenuItem>
      </Menu>
    </Box>
  )
}
